let backendUrl =
  import.meta.env.VITE_BACKEND_URL?.replace(/\/$/, "") || "http://127.0.0.1:8000";
let consoleUrl =
  import.meta.env.VITE_CONSOLE_URL?.replace(/\/$/, "") || "http://127.0.0.1:3000/companion";

export function getBackendUrl(): string {
  return backendUrl;
}

export function getConsoleUrl(): string {
  return consoleUrl;
}

/** @deprecated use getBackendUrl() — kept for templates that read a stable binding */
export const BACKEND_URL = backendUrl;
/** @deprecated use getConsoleUrl() */
export const CONSOLE_URL = consoleUrl;

export type PetAnimation = "idle" | "thinking" | "talking" | "cheer_up" | "celebrate" | "remind_drink";

export interface CompanionState {
  persona?: { name?: string; traits?: string; tone?: string };
  pet?: { name?: string; species?: string; stage?: string; care_score?: number };
  growth?: { level?: number; total_xp?: number; title?: string };
  mood?: { label?: string; note?: string };
}

export interface PetMediaItem {
  type: "image" | "video";
  url: string;
}

export interface PetChatResponse {
  action: PetAnimation;
  text: string;
  mood: string;
  tool_hint?: string | null;
  media?: PetMediaItem[];
}

/** Resolve a media path/URL to something the pet webview can load from the backend. */
export function resolvePetMediaUrl(url: string): string {
  const u = (url || "").trim();
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;
  const base = getBackendUrl();
  if (u.startsWith("/api/media/")) return `${base}/media/${u.slice("/api/media/".length)}`;
  if (u.startsWith("/media/")) return `${base}${u}`;
  if (u.startsWith("/")) return `${base}${u}`;
  return `${base}/media/${u}`;
}

export interface PetWakePayload extends PetChatResponse {
  source?: string;
  wake_reason?: string;
  companion?: CompanionState;
}

export interface PerceptionContext {
  foreground_app?: string;
  foreground_title?: string;
  idle_seconds?: number;
  clipboard_preview?: string;
  clipboard_hash?: string;
  clipboard_len?: number;
  local_hour?: number;
}

interface BackendProxyResponse {
  status: number;
  body: string;
}

function extractApiDetail(body: string, status: number): string {
  try {
    const data = JSON.parse(body || "{}") as {
      detail?: unknown;
      message?: string;
      error?: string;
    };
    const detail = data.detail;
    if (typeof detail === "string" && detail.trim()) return detail.trim();
    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0] as { msg?: string };
      if (first?.msg) return first.msg;
    }
    if (data.message) return String(data.message);
    if (data.error) return String(data.error);
  } catch {
    /* ignore */
  }
  return `语音识别失败 (${status})`;
}

function fetchTimeout(ms: number): AbortSignal {
  if (typeof AbortSignal !== "undefined" && "timeout" in AbortSignal) {
    return AbortSignal.timeout(ms);
  }
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), ms);
  return ctrl.signal;
}

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<T>(cmd, args ?? {});
  } catch {
    return null;
  }
}

export async function initBackendEndpoints(): Promise<void> {
  const resolved = await tauriInvoke<{ backend_url?: string; console_url?: string }>(
    "resolve_service_urls",
  );
  if (resolved?.backend_url) {
    backendUrl = resolved.backend_url.replace(/\/$/, "");
  }
  if (resolved?.console_url) {
    consoleUrl = resolved.console_url.replace(/\/$/, "");
  }
}

/** Rust 代理请求 — 绕过 macOS / Windows WebView 对 localhost 的限制 */
async function backendProxy(
  method: string,
  path: string,
  body?: string,
  accept?: string,
): Promise<BackendProxyResponse | null> {
  return tauriInvoke<BackendProxyResponse>("backend_request", {
    backendUrl: getBackendUrl(),
    method,
    path,
    body: body ?? null,
    contentType: body ? "application/json" : null,
    accept: accept ?? null,
  });
}

async function webFetch(
  method: string,
  path: string,
  body?: string,
  accept?: string,
  timeoutMs = 8000,
): Promise<BackendProxyResponse | null> {
  const base = getBackendUrl();
  const urls = [
    `${base}${path}`,
    `${base.replace("127.0.0.1", "localhost")}${path}`,
    `${base.replace("localhost", "127.0.0.1")}${path}`,
  ];
  const seen = new Set<string>();

  for (const url of urls) {
    if (seen.has(url)) continue;
    seen.add(url);
    try {
      const res = await fetch(url, {
        method,
        headers: {
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...(accept ? { Accept: accept } : {}),
        },
        body,
        signal: fetchTimeout(timeoutMs),
      });
      return { status: res.status, body: await res.text() };
    } catch {
      /* try next host */
    }
  }
  return null;
}

async function requestBackend(
  method: string,
  path: string,
  body?: string,
  accept?: string,
  timeoutMs = 8000,
): Promise<BackendProxyResponse | null> {
  const viaRust = await backendProxy(method, path, body, accept);
  if (viaRust) return viaRust;
  return webFetch(method, path, body, accept, timeoutMs);
}

function okStatus(status: number): boolean {
  return status >= 200 && status < 300;
}

export async function getPlatform(): Promise<"windows" | "macos" | "linux" | "web"> {
  const platform = await tauriInvoke<string>("get_platform");
  if (platform === "windows" || platform === "macos" || platform === "linux") {
    return platform;
  }
  return "web";
}

export async function checkHealth(timeoutMs = 2500): Promise<boolean> {
  const rustOk = await tauriInvoke<boolean>("check_backend_health", {
    timeoutMs,
  });
  if (rustOk === true) return true;

  const res = await requestBackend("GET", "/health", undefined, undefined, timeoutMs);
  return res ? okStatus(res.status) : false;
}

export async function fetchCompanionState(): Promise<CompanionState | null> {
  const res = await requestBackend("GET", "/companion/state", undefined, undefined, 5000);
  if (!res || !okStatus(res.status)) return null;
  try {
    return JSON.parse(res.body) as CompanionState;
  } catch {
    return null;
  }
}

export async function fetchDreamDigest(): Promise<{ greeting?: string; summary?: string } | null> {
  const res = await requestBackend("GET", "/evolution/dream/digest", undefined, undefined, 5000);
  if (!res || !okStatus(res.status)) return null;
  try {
    return JSON.parse(res.body) as { greeting?: string; summary?: string };
  } catch {
    return null;
  }
}

export interface PetBootstrapPayload {
  companion?: CompanionState;
  wake?: PetWakePayload;
}

export async function fetchPetBootstrap(
  source = "startup",
  fast = true,
): Promise<PetBootstrapPayload | null> {
  const q = new URLSearchParams({ source, fast: fast ? "1" : "0" });
  const res = await requestBackend(
    "GET",
    `/companion/pet/bootstrap?${q}`,
    undefined,
    undefined,
    5000,
  );
  if (!res || !okStatus(res.status)) return null;
  try {
    return JSON.parse(res.body) as PetBootstrapPayload;
  } catch {
    return null;
  }
}

export async function fetchPetWake(source = "manual"): Promise<PetWakePayload | null> {
  const res = await requestBackend(
    "POST",
    "/companion/pet/wake",
    JSON.stringify({ source }),
    undefined,
    8000,
  );
  if (!res || !okStatus(res.status)) return null;
  try {
    return JSON.parse(res.body) as PetWakePayload;
  } catch {
    return null;
  }
}

export async function postPerception(ctx: PerceptionContext): Promise<void> {
  await requestBackend(
    "POST",
    "/companion/pet/context",
    JSON.stringify({ ...ctx, local_hour: new Date().getHours() }),
  );
}

export async function transcribePetAudio(
  blob: Blob,
  mimeType: string,
  language = "zh",
): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  const audioBase64 = btoa(binary);
  const payload = JSON.stringify({
    audio_base64: audioBase64,
    mime_type: mimeType,
    language: language.split("-")[0] || "zh",
  });

  const res = await requestBackend(
    "POST",
    "/companion/pet/transcribe",
    payload,
    "application/json",
    45000,
  );
  if (!res) {
    throw new Error("无法连接后端，请确认 AI Media Agent 已启动");
  }

  let data: { ok?: boolean; text?: string } = {};
  try {
    data = JSON.parse(res.body || "{}") as { ok?: boolean; text?: string };
  } catch {
    /* ignore */
  }

  if (res.status >= 400 || !data.ok) {
    throw new Error(extractApiDetail(res.body, res.status));
  }
  return (data.text || "").trim();
}

export async function streamPetChat(
  input: string,
  messages: { role: string; content: string }[],
  perception: PerceptionContext | undefined,
  onEvent: (event: Record<string, unknown>) => void,
): Promise<void> {
  const payload = JSON.stringify({ input, messages, perception });

  const platform = await tauriInvoke<string>("get_platform");
  if (platform) {
    const { listen } = await import("@tauri-apps/api/event");
    const unlisten = await listen<string>("backend-sse", (ev) => {
      try {
        onEvent(JSON.parse(ev.payload));
      } catch {
        /* ignore malformed chunk */
      }
    });
    try {
      const streamOk = await tauriInvoke<void>("backend_post_stream_cmd", {
        backendUrl: getBackendUrl(),
        path: "/companion/pet/chat/stream",
        body: payload,
      });
      if (streamOk !== null) {
        return;
      }
    } finally {
      unlisten();
    }
  }

  const res = await fetch(`${getBackendUrl()}/companion/pet/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: payload,
  });

  if (!res.ok || !res.body) {
    throw new Error(`Pet chat failed: ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() || "";
    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith("data:")) continue;
      try {
        onEvent(JSON.parse(line.slice(5).trim()));
      } catch {
        /* ignore malformed chunk */
      }
    }
  }
}
