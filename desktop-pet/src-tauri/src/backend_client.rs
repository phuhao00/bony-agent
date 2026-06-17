use futures_util::StreamExt;
use reqwest::Client;
use serde::Serialize;
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

#[derive(Clone, Serialize)]
pub struct BackendResponse {
    pub status: u16,
    pub body: String,
}

#[derive(Clone, Serialize)]
pub struct ServiceUrls {
    pub backend_url: String,
    pub console_url: String,
}

const BACKEND_PORT_CANDIDATES: [u16; 7] = [8000, 8010, 8020, 8030, 8080, 8888, 18000];

pub fn default_base(url: Option<String>) -> String {
    url.unwrap_or_else(resolve_backend_url)
}

fn trim_url(url: &str) -> String {
    url.trim().trim_end_matches('/').to_string()
}

pub fn app_data_dir() -> Option<PathBuf> {
    if let Ok(dir) = std::env::var("AI_MEDIA_AGENT_APP_DATA") {
        let trimmed = dir.trim();
        if !trimmed.is_empty() {
            return Some(PathBuf::from(trimmed));
        }
    }

    #[cfg(target_os = "windows")]
    {
        return std::env::var("APPDATA")
            .ok()
            .map(|p| PathBuf::from(p).join("ai-media-agent"));
    }

    #[cfg(target_os = "macos")]
    {
        return std::env::var("HOME")
            .ok()
            .map(|p| PathBuf::from(p).join("Library/Application Support/ai-media-agent"));
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        return std::env::var("HOME")
            .ok()
            .map(|p| PathBuf::from(p).join(".local/share/ai-media-agent"));
    }
}

fn read_backend_port_file() -> Option<u16> {
    let dir = app_data_dir()?;
    let text = std::fs::read_to_string(dir.join(".backend_port")).ok()?;
    text.trim().parse().ok()
}

fn read_pet_config() -> Option<(String, String)> {
    let dir = app_data_dir()?;
    for config_path in [
        dir.join("desktop-pet").join("config.json"),
        dir.join("desktop-pet-config.json"),
    ] {
        let text = std::fs::read_to_string(&config_path).ok()?;
        let value: serde_json::Value = serde_json::from_str(&text).ok()?;
        let backend = value
            .get("backendUrl")
            .and_then(|v| v.as_str())
            .map(trim_url)?;
        let console = value
            .get("consoleUrl")
            .and_then(|v| v.as_str())
            .map(trim_url)
            .unwrap_or_else(|| "http://127.0.0.1:3000/companion".to_string());
        return Some((backend, console));
    }
    None
}

pub fn resolve_backend_url() -> String {
    for key in ["AI_MEDIA_AGENT_BACKEND_URL", "VITE_BACKEND_URL"] {
        if let Ok(url) = std::env::var(key) {
            let trimmed = trim_url(&url);
            if !trimmed.is_empty() {
                return trimmed;
            }
        }
    }

    if let Some((backend, _)) = read_pet_config() {
        return backend;
    }

    if let Some(port) = read_backend_port_file() {
        return format!("http://127.0.0.1:{port}");
    }

    "http://127.0.0.1:8000".to_string()
}

pub fn resolve_console_url() -> String {
    for key in ["AI_MEDIA_AGENT_CONSOLE_URL", "VITE_CONSOLE_URL"] {
        if let Ok(url) = std::env::var(key) {
            let trimmed = trim_url(&url);
            if !trimmed.is_empty() {
                return trimmed;
            }
        }
    }

    if let Some((_, console)) = read_pet_config() {
        return console;
    }

    "http://127.0.0.1:3000/companion".to_string()
}

pub async fn discover_backend_url() -> String {
    let primary = resolve_backend_url();
    if backend_health_timeout(&primary, 2).await {
        return primary;
    }

    let mut tried = std::collections::HashSet::new();
    tried.insert(primary.clone());

    if let Some(port) = read_backend_port_file() {
        let url = format!("http://127.0.0.1:{port}");
        if !tried.contains(&url) && backend_health_timeout(&url, 1).await {
            return url;
        }
        tried.insert(url);
    }

    for port in BACKEND_PORT_CANDIDATES {
        let url = format!("http://127.0.0.1:{port}");
        if tried.contains(&url) {
            continue;
        }
        if backend_health_timeout(&url, 1).await {
            return url;
        }
        tried.insert(url);
    }

    primary
}

fn pet_managed_by_app() -> bool {
    if std::env::var("AI_MEDIA_AGENT_APP_DATA")
        .map(|v| !v.trim().is_empty())
        .unwrap_or(false)
    {
        return true;
    }
    app_data_dir()
        .map(|dir| dir.join("desktop-pet").join("config.json").exists())
        .unwrap_or(false)
}

/// Ask the AI Media Agent desktop shell (Electron) to open the companion room
/// in its own window by dropping a signal file the shell watches for.
/// Returns true only when the pet is managed by the shell (so callers know
/// whether to fall back to the system browser).
pub fn request_open_console(path: &str) -> Result<bool, String> {
    if !pet_managed_by_app() {
        return Ok(false);
    }
    let Some(dir) = app_data_dir() else {
        return Ok(false);
    };
    let pet_dir = dir.join("desktop-pet");
    std::fs::create_dir_all(&pet_dir).map_err(|e| e.to_string())?;

    let target = if path.starts_with('/') {
        path.to_string()
    } else {
        format!("/{path}")
    };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let payload = serde_json::json!({ "path": target, "ts": ts });
    std::fs::write(pet_dir.join("open-console.signal"), payload.to_string())
        .map_err(|e| e.to_string())?;
    Ok(true)
}

pub async fn resolve_service_urls() -> ServiceUrls {
    ServiceUrls {
        backend_url: discover_backend_url().await,
        console_url: resolve_console_url(),
    }
}

pub fn candidate_bases(base: &str) -> Vec<String> {
    let trimmed = base.trim_end_matches('/');
    let mut bases = vec![trimmed.to_string()];
    if trimmed.contains("127.0.0.1") {
        bases.push(trimmed.replace("127.0.0.1", "localhost"));
    } else if trimmed.contains("localhost") {
        bases.push(trimmed.replace("localhost", "127.0.0.1"));
    }
    bases.sort();
    bases.dedup();
    bases
}

fn http_client(timeout_secs: u64) -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(timeout_secs))
        .build()
        .map_err(|e| e.to_string())
}

async fn try_request(
    client: &Client,
    method: &str,
    url: &str,
    body: Option<&str>,
    content_type: Option<&str>,
    accept: Option<&str>,
) -> Option<BackendResponse> {
    let mut req = match method.to_uppercase().as_str() {
        "GET" => client.get(url),
        "POST" => client.post(url),
        "PATCH" => client.patch(url),
        "PUT" => client.put(url),
        "DELETE" => client.delete(url),
        _ => return None,
    };

    if let Some(ct) = content_type {
        req = req.header("Content-Type", ct);
    }
    if let Some(a) = accept {
        req = req.header("Accept", a);
    }
    if let Some(b) = body {
        req = req.body(b.to_string());
    }

    let res = req.send().await.ok()?;
    let status = res.status().as_u16();
    let body = res.text().await.unwrap_or_default();
    Some(BackendResponse { status, body })
}

pub async fn backend_request_with_fallback(
    base: &str,
    method: &str,
    path: &str,
    body: Option<&str>,
    content_type: Option<&str>,
    accept: Option<&str>,
    timeout_secs: u64,
) -> Result<BackendResponse, String> {
    let client = http_client(timeout_secs)?;
    let path = if path.starts_with('/') {
        path.to_string()
    } else {
        format!("/{path}")
    };

    for candidate in candidate_bases(base) {
        let url = format!("{candidate}{path}");
        if let Some(resp) = try_request(
            &client,
            method,
            &url,
            body,
            content_type,
            accept,
        )
        .await
        {
            if resp.status > 0 {
                return Ok(resp);
            }
        }
    }

    Err(format!("backend unreachable: {base}{path}"))
}

pub async fn backend_health(base: &str) -> bool {
    backend_health_timeout(base, 2).await
}

pub async fn backend_health_timeout(base: &str, timeout_secs: u64) -> bool {
    let client = match http_client(timeout_secs) {
        Ok(c) => c,
        Err(_) => return false,
    };
    for candidate in candidate_bases(base) {
        let url = format!("{candidate}/health");
        if let Some(resp) = try_request(&client, "GET", &url, None, None, None).await {
            if (200..300).contains(&resp.status) {
                return true;
            }
        }
    }
    false
}

fn parse_sse_payload(block: &str) -> Option<String> {
    for line in block.lines() {
        let trimmed = line.trim();
        if let Some(data) = trimmed.strip_prefix("data:") {
            return Some(data.trim().to_string());
        }
    }
    None
}

pub async fn backend_post_stream(
    app: &AppHandle,
    base: &str,
    path: &str,
    body: &str,
) -> Result<(), String> {
    let client = http_client(120)?;
    let path = if path.starts_with('/') {
        path.to_string()
    } else {
        format!("/{path}")
    };

    let mut last_err = String::from("backend stream unreachable");

    for candidate in candidate_bases(base) {
        let url = format!("{candidate}{path}");
        let response = client
            .post(&url)
            .header("Content-Type", "application/json")
            .header("Accept", "text/event-stream")
            .body(body.to_string())
            .send()
            .await;

        let Ok(res) = response else {
            last_err = format!("stream request failed: {url}");
            continue;
        };

        if !res.status().is_success() {
            last_err = format!("stream status {}: {url}", res.status());
            continue;
        }

        let mut stream = res.bytes_stream();
        let mut buffer = String::new();

        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| e.to_string())?;
            buffer.push_str(&String::from_utf8_lossy(&chunk));

            while let Some(pos) = buffer.find("\n\n") {
                let block = buffer[..pos].to_string();
                buffer = buffer[pos + 2..].to_string();
                if let Some(data) = parse_sse_payload(&block) {
                    let _ = app.emit("backend-sse", data);
                }
            }
        }

        if !buffer.trim().is_empty() {
            if let Some(data) = parse_sse_payload(&buffer) {
                let _ = app.emit("backend-sse", data);
            }
        }

        return Ok(());
    }

    Err(last_err)
}
