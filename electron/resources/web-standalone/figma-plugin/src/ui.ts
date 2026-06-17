/// <reference types="@figma/plugin-typings" />

import type { BridgeMessage, PluginCommand, PluginResponse } from "./types";

const BUILD_ID = "2026-06-14-safe";

interface ApiBase {
  label: string;
  url: string;
}

interface WsEntry {
  label: string;
  url: string;
}

const API_BASES: ApiBase[] = [
  { label: "127.0.0.1", url: "http://127.0.0.1:8000" },
  { label: "localhost", url: "http://localhost:8000" },
];

const WS_URLS: WsEntry[] = [
  { label: "127.0.0.1", url: "ws://127.0.0.1:36855/figma-plugin" },
  { label: "localhost", url: "ws://localhost:36855/figma-plugin" },
];

const RECONNECT_DELAY_MS = 2000;
const CONNECT_TIMEOUT_MS = 5000;
const HEARTBEAT_INTERVAL_MS = 15000;

let sessionId = "";
let useWebSocket = false;
let ws: WebSocket | null = null;
let reconnectTimer: number | null = null;
let reconnectDelay = RECONNECT_DELAY_MS;
let intentionalClose = false;
let wsUrlIndex = 0;
let heartbeatTimer: number | null = null;
let running = true;
let currentApiBase: ApiBase | null = null;

function el(id: string): HTMLElement | null {
  return document.getElementById(id);
}

function log(message: string): void {
  try {
    const time = new Date().toLocaleTimeString();
    const line = `[${time}] ${message}`;
    if (typeof console !== "undefined" && console.log) {
      console.log(line);
    }
    const logEl = el("log");
    if (logEl) {
      logEl.textContent += (logEl.textContent ? "\n" : "") + line;
      logEl.scrollTop = logEl.scrollHeight;
    }
  } catch {
    // ignore logging errors
  }
}

function setStatus(text: string, type: "info" | "success" | "error" = "info"): void {
  try {
    const statusEl = el("status");
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.className = `status status-${type}`;
  } catch {
    // ignore
  }
}

function setError(text: string): void {
  try {
    const errorEl = el("error") as HTMLElement | null;
    if (!errorEl) return;
    errorEl.textContent = text;
    errorEl.style.display = text ? "block" : "none";
  } catch {
    // ignore
  }
}

function setConnectedBadge(connected: boolean): void {
  try {
    const badgeEl = el("badge");
    if (!badgeEl) return;
    badgeEl.className = `badge ${connected ? "connected" : "disconnected"}`;
    badgeEl.textContent = connected ? "已连接" : "未连接";
  } catch {
    // ignore
  }
}

function showReconnectButton(show: boolean): void {
  try {
    const btn = el("reconnect") as HTMLButtonElement | null;
    if (!btn) return;
    btn.style.display = show ? "inline-flex" : "none";
  } catch {
    // ignore
  }
}

function sendToPlugin(payload: unknown): void {
  try {
    if (typeof parent !== "undefined" && parent.postMessage) {
      parent.postMessage({ pluginMessage: payload }, "*");
    }
  } catch (err) {
    log(`postMessage err: ${err}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function apiFetch(baseUrl: string, path: string, options: RequestInit = {}): Promise<{ ok: boolean; status: number; data: any; error: string }> {
  const url = `${baseUrl}${path}`;
  try {
    log(`fetch ${url}`);
    const res = await fetch(url, { ...options, mode: "cors" });
    const text = await res.text();
    let data: any = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }
    log(`fetch ${url} -> ${res.status}`);
    return { ok: res.ok, status: res.status, data, error: "" };
  } catch (err) {
    log(`fetch ${url} ERR: ${err}`);
    return { ok: false, status: 0, data: {}, error: String(err) };
  }
}

async function diagnoseHttp(): Promise<ApiBase | null> {
  log("=== diagnose HTTP ===");
  for (const base of API_BASES) {
    const res = await apiFetch(base.url, "/figma-plugin/status");
    if (res.ok) {
      log(`HTTP OK via ${base.label}`);
      return base;
    }
  }
  log("HTTP failed on all bases");
  return null;
}

async function registerSession(base: ApiBase): Promise<boolean> {
  const res = await apiFetch(base.url, "/figma-plugin/register", { method: "POST" });
  if (res.ok && res.data && res.data.session_id) {
    sessionId = String(res.data.session_id);
    log(`registered session ${sessionId} via ${base.label}`);
    return true;
  }
  log(`register failed via ${base.label}: ${res.status} ${res.error}`);
  return false;
}

async function pollLoop(): Promise<void> {
  while (running && sessionId && !useWebSocket) {
    if (!currentApiBase) {
      const base = await diagnoseHttp();
      if (!base) {
        await sleep(RECONNECT_DELAY_MS);
        continue;
      }
      currentApiBase = base;
    }

    try {
      log(`poll ${currentApiBase.label}`);
      const res = await fetch(`${currentApiBase.url}/figma-plugin/poll/${sessionId}?timeout=25`, {
        method: "GET",
        mode: "cors",
      });
      if (!running) break;
      if (res.status === 404) {
        log("session 404, re-register");
        sessionId = "";
        currentApiBase = null;
        continue;
      }
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (data.command) {
        log(`poll command: ${data.command.method}`);
        sendToPlugin(data.command);
      } else {
        log("poll empty");
      }
    } catch (err) {
      if (!running) break;
      log(`poll ERR: ${err}`);
      currentApiBase = null;
      await sleep(RECONNECT_DELAY_MS);
    }
  }
}

async function submitResponse(response: PluginResponse): Promise<void> {
  if (!sessionId) return;
  const base = currentApiBase || (await diagnoseHttp());
  if (!base) {
    log("no base for response");
    return;
  }
  currentApiBase = base;
  const res = await apiFetch(base.url, `/figma-plugin/response/${sessionId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(response),
  });
  log(`response submitted: ${res.ok}`);
}

function tryConnectWebSocket(entry: WsEntry): void {
  log(`=== WS ${entry.label}: ${entry.url} ===`);
  setStatus(`WS ${entry.label} 连接中…`, "info");
  setConnectedBadge(false);
  showReconnectButton(false);

  let socket: WebSocket;
  try {
    socket = new WebSocket(entry.url);
    ws = socket;
  } catch (err) {
    log(`new WebSocket ERR: ${err}`);
    tryNextWsOrHttp();
    return;
  }

  let opened = false;
  let connectTimeout = window.setTimeout(() => {
    if (!opened && ws === socket) {
      log("WS connect timeout");
      intentionalClose = true;
      try {
        socket.close();
      } catch {
        // ignore
      }
      ws = null;
      useWebSocket = false;
      tryNextWsOrHttp();
    }
  }, CONNECT_TIMEOUT_MS);

  socket.onopen = () => {
    opened = true;
    window.clearTimeout(connectTimeout);
    useWebSocket = true;
    reconnectDelay = RECONNECT_DELAY_MS;
    log("WS OPEN");
    setStatus("已连接 (WebSocket)", "success");
    setError("");
    setConnectedBadge(true);
    showReconnectButton(false);
    startHeartbeat();
    sendToPlugin({ type: "status", text: "connected" });
  };

  socket.onmessage = (event: MessageEvent) => {
    let msg: BridgeMessage;
    try {
      msg = JSON.parse(String(event.data));
    } catch {
      log("WS invalid JSON");
      return;
    }
    if (msg.type === "command" && msg.payload) {
      log(`WS command: ${(msg.payload as PluginCommand).method}`);
      sendToPlugin(msg.payload);
    }
  };

  socket.onclose = (event: CloseEvent) => {
    window.clearTimeout(connectTimeout);
    if (ws === socket) {
      ws = null;
    }
    stopHeartbeat();
    setConnectedBadge(false);
    if (intentionalClose) {
      log(`WS closed intentionally code=${event.code}`);
      intentionalClose = false;
      return;
    }
    log(`WS CLOSED code=${event.code} clean=${event.wasClean}`);
    if (!opened) {
      useWebSocket = false;
      tryNextWsOrHttp();
      return;
    }
    setStatus("WebSocket 断开，尝试 HTTP 轮询", "error");
    useWebSocket = false;
    startHttpTransport();
  };

  socket.onerror = () => {
    log("WS onerror");
  };
}

function tryNextWsOrHttp(): void {
  wsUrlIndex += 1;
  if (wsUrlIndex < WS_URLS.length) {
    log("try next WS");
    tryConnectWebSocket(WS_URLS[wsUrlIndex]);
  } else {
    log("all WS failed, switch to HTTP polling");
    startHttpTransport();
  }
}

function startHeartbeat(): void {
  if (heartbeatTimer) window.clearInterval(heartbeatTimer);
  heartbeatTimer = window.setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "ping" }));
    }
  }, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat(): void {
  if (heartbeatTimer) {
    window.clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

async function startHttpTransport(): Promise<void> {
  if (useWebSocket || !running) return;
  log("=== start HTTP transport ===");
  setStatus("HTTP 轮询连接中…", "info");
  setConnectedBadge(false);

  const base = await diagnoseHttp();
  if (!base) {
    setStatus("无法连接后端", "error");
    setError(`所有本地地址都连不上。最常见原因：\n1. 后端没启动\n2. 系统代理拦截了 127.0.0.1/localhost\n3. Figma 浏览器版限制本地连接\n\n请把日志复制给我。`);
    showReconnectButton(true);
    return;
  }

  currentApiBase = base;

  if (!sessionId) {
    const ok = await registerSession(base);
    if (!ok) {
      setStatus("注册会话失败", "error");
      setError("无法创建 HTTP 轮询会话。");
      showReconnectButton(true);
      return;
    }
  }

  setStatus("已连接 (HTTP 轮询)", "success");
  setError("");
  setConnectedBadge(true);
  showReconnectButton(false);
  sendToPlugin({ type: "status", text: "connected" });
  pollLoop();
}

function initTransport(): void {
  log(`=== boot build=${BUILD_ID} ===`);
  log(`ua=${navigator.userAgent}`);
  log(`fetch=${typeof fetch}, ws=${typeof WebSocket}, clipboard=${typeof navigator !== "undefined" && navigator.clipboard ? "yes" : "no"}`);
  wsUrlIndex = 0;
  tryConnectWebSocket(WS_URLS[0]);
}

function reconnect(): void {
  log("=== reconnect ===");
  reconnectDelay = RECONNECT_DELAY_MS;
  wsUrlIndex = 0;
  sessionId = "";
  currentApiBase = null;
  useWebSocket = false;
  if (ws) {
    intentionalClose = true;
    try {
      ws.close();
    } catch {
      // ignore
    }
    ws = null;
  }
  if (reconnectTimer) window.clearTimeout(reconnectTimer);
  initTransport();
}

function copyLogs(): void {
  try {
    const logEl = el("log");
    if (!logEl) return;
    const text = logEl.textContent || "";
    if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        const btn = el("copyLog") as HTMLButtonElement | null;
        if (btn) {
          btn.textContent = "已复制";
          window.setTimeout(() => (btn.textContent = "复制日志"), 1500);
        }
      });
    } else {
      // Fallback: select text manually
      const range = document.createRange();
      range.selectNodeContents(logEl);
      const sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand("copy");
        sel.removeAllRanges();
      }
      const btn = el("copyLog") as HTMLButtonElement | null;
      if (btn) {
        btn.textContent = "已复制";
        window.setTimeout(() => (btn.textContent = "复制日志"), 1500);
      }
    }
  } catch (err) {
    log(`copy err: ${err}`);
  }
}

function main(): void {
  try {
    const reconnectBtn = el("reconnect");
    if (reconnectBtn) {
      reconnectBtn.addEventListener("click", reconnect);
    }
    const copyLogBtn = el("copyLog");
    if (copyLogBtn) {
      copyLogBtn.addEventListener("click", copyLogs);
    }
    setStatus("初始化…", "info");
    initTransport();
  } catch (err) {
    setStatus("启动失败", "error");
    setError(`脚本启动异常: ${err}`);
    log(`MAIN ERROR: ${err}`);
  }
}

window.onmessage = (event: MessageEvent) => {
  try {
    const pluginMessage = event.data && event.data.pluginMessage;
    if (!pluginMessage) return;
    const response = pluginMessage as PluginResponse;
    log(`plugin response: ${response.id}`);

    if (useWebSocket && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "response", payload: response }));
    } else if (sessionId) {
      submitResponse(response);
    } else {
      log("no transport for response");
    }
  } catch (err) {
    log(`onmessage err: ${err}`);
  }
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", main);
} else {
  main();
}
