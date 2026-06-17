mod backend_client;
mod clipboard;
mod perception;

use backend_client::{backend_post_stream, backend_request_with_fallback, BackendResponse};
use clipboard::{read_clipboard_snapshot, ClipboardState};
use perception::{collect_perception, idle_seconds, local_hour};
use parking_lot::Mutex;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

struct PerceptionLoop {
    running: Arc<AtomicBool>,
}

impl Default for PerceptionLoop {
    fn default() -> Self {
        Self {
            running: Arc::new(AtomicBool::new(false)),
        }
    }
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn hide_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

fn emit_pet_wake(app: &AppHandle, source: &str) {
    show_main_window(app);
    let _ = app.emit("pet-wake", json!({ "source": source }));
}

#[tauri::command]
fn wake_pet(app: AppHandle, source: Option<String>) -> Result<(), String> {
    emit_pet_wake(&app, source.as_deref().unwrap_or("command"));
    Ok(())
}

#[tauri::command]
fn show_pet_window(app: AppHandle) -> Result<(), String> {
    show_main_window(&app);
    Ok(())
}

#[tauri::command]
fn hide_pet_window(app: AppHandle) -> Result<(), String> {
    hide_main_window(&app);
    Ok(())
}

#[tauri::command]
fn quit_pet_app(app: AppHandle) -> Result<(), String> {
    app.exit(0);
    Ok(())
}

#[tauri::command]
fn get_platform() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    }
}

/// 绕过 WebView 限制，Rust 直连本地 FastAPI（macOS / Windows 通用）
#[tauri::command]
async fn check_backend_health(backend_url: Option<String>, timeout_ms: Option<u64>) -> Result<bool, String> {
    let secs = timeout_ms.unwrap_or(2000).max(500).min(8000) / 1000;
    let base = match backend_url {
        Some(url) if !url.trim().is_empty() => backend_client::default_base(Some(url)),
        _ => backend_client::discover_backend_url().await,
    };
    Ok(backend_client::backend_health_timeout(
        &base,
        secs.max(1),
    )
    .await)
}

#[tauri::command]
async fn resolve_service_urls() -> Result<backend_client::ServiceUrls, String> {
    Ok(backend_client::resolve_service_urls().await)
}

/// Open the companion room inside the desktop app window (via the shell).
/// Returns false when the pet is standalone so the UI falls back to a browser.
#[tauri::command]
fn open_app_console(path: Option<String>) -> Result<bool, String> {
    backend_client::request_open_console(path.as_deref().unwrap_or("/companion"))
}

#[tauri::command]
async fn backend_request(
    backend_url: Option<String>,
    method: String,
    path: String,
    body: Option<String>,
    content_type: Option<String>,
    accept: Option<String>,
) -> Result<BackendResponse, String> {
    backend_request_with_fallback(
        &backend_client::default_base(backend_url),
        &method,
        &path,
        body.as_deref(),
        content_type.as_deref(),
        accept.as_deref(),
        45,
    )
    .await
}

#[tauri::command]
async fn backend_post_stream_cmd(
    app: AppHandle,
    backend_url: Option<String>,
    path: String,
    body: String,
) -> Result<(), String> {
    backend_post_stream(
        &app,
        &backend_client::default_base(backend_url),
        &path,
        &body,
    )
    .await
}

#[tauri::command]
fn get_perception_context(
    include_clipboard_preview: bool,
    clipboard: State<'_, Arc<Mutex<ClipboardState>>>,
) -> Result<Value, String> {
    let snap = read_clipboard_snapshot(&clipboard, include_clipboard_preview)?;
    let fg = perception::foreground_app();
    Ok(json!({
        "foreground_app": fg.app_id,
        "foreground_title": fg.title,
        "idle_seconds": idle_seconds(),
        "clipboard_preview": snap.preview,
        "clipboard_hash": snap.hash,
        "clipboard_len": snap.len,
        "local_hour": local_hour(),
    }))
}

#[tauri::command]
async fn start_perception_loop(
    app: AppHandle,
    interval_secs: u64,
    loop_state: State<'_, PerceptionLoop>,
    clipboard: State<'_, Arc<Mutex<ClipboardState>>>,
) -> Result<(), String> {
    if loop_state.running.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    let app_handle = app.clone();
    let clip = clipboard.inner().clone();
    let secs = interval_secs.max(15);
    let running = Arc::clone(&loop_state.running);

    tauri::async_runtime::spawn(async move {
        while running.load(Ordering::SeqCst) {
            let ctx = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                collect_perception(&clip, false)
            }))
            .unwrap_or_else(|_| {
                json!({
                    "foreground_app": null,
                    "foreground_title": null,
                    "idle_seconds": 0,
                    "clipboard_preview": null,
                    "clipboard_hash": null,
                    "clipboard_len": 0,
                    "local_hour": local_hour(),
                })
            });
            let _ = app_handle.emit("perception-tick", ctx);
            tokio::time::sleep(std::time::Duration::from_secs(secs)).await;
        }
    });
    Ok(())
}

#[tauri::command]
fn stop_perception_loop(loop_state: State<'_, PerceptionLoop>) -> Result<(), String> {
    loop_state.running.store(false, Ordering::SeqCst);
    Ok(())
}

fn register_wake_shortcut(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(target_os = "macos")]
    let mods = Modifiers::SUPER | Modifiers::SHIFT;
    #[cfg(not(target_os = "macos"))]
    let mods = Modifiers::ALT | Modifiers::SHIFT;

    let shortcut = Shortcut::new(Some(mods), Code::KeyB);
    app.global_shortcut().register(shortcut)?;
    Ok(())
}

fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let wake_i = MenuItem::with_id(app, "wake", "唤醒波尼", true, None::<&str>)?;
    let show_i = MenuItem::with_id(app, "show", "显示", true, None::<&str>)?;
    let hide_i = MenuItem::with_id(app, "hide", "隐藏", true, None::<&str>)?;
    let quit_i = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&wake_i, &show_i, &hide_i, &quit_i])?;

    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or("missing tray icon")?;

    TrayIconBuilder::new()
        .icon(icon)
        .menu(&menu)
        .tooltip("Boni · 波尼桌宠")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "wake" => emit_pet_wake(app, "tray"),
            "show" => show_main_window(app),
            "hide" => hide_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                emit_pet_wake(tray.app_handle(), "tray-click");
            }
        })
        .build(app)?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        emit_pet_wake(app, "hotkey");
                    }
                })
                .build(),
        )
        .manage(PerceptionLoop::default())
        .manage(Arc::new(Mutex::new(ClipboardState::default())))
        .invoke_handler(tauri::generate_handler![
            get_perception_context,
            start_perception_loop,
            stop_perception_loop,
            wake_pet,
            show_pet_window,
            hide_pet_window,
            quit_pet_app,
            check_backend_health,
            resolve_service_urls,
            open_app_console,
            backend_request,
            backend_post_stream_cmd,
            get_platform,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            if let Err(err) = setup_tray(&handle) {
                eprintln!("tray setup skipped: {err}");
            }
            if let Err(err) = register_wake_shortcut(&handle) {
                eprintln!("global shortcut skipped: {err}");
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
