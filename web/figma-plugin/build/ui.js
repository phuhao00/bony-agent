"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __defProps = Object.defineProperties;
  var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
  var __getOwnPropSymbols = Object.getOwnPropertySymbols;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __propIsEnum = Object.prototype.propertyIsEnumerable;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __spreadValues = (a, b) => {
    for (var prop in b || (b = {}))
      if (__hasOwnProp.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    if (__getOwnPropSymbols)
      for (var prop of __getOwnPropSymbols(b)) {
        if (__propIsEnum.call(b, prop))
          __defNormalProp(a, prop, b[prop]);
      }
    return a;
  };
  var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));

  // src/ui.ts
  var BUILD_ID = "2026-06-14-safe";
  var API_BASES = [
    { label: "127.0.0.1", url: "http://127.0.0.1:8000" },
    { label: "localhost", url: "http://localhost:8000" }
  ];
  var WS_URLS = [
    { label: "127.0.0.1", url: "ws://127.0.0.1:36855/figma-plugin" },
    { label: "localhost", url: "ws://localhost:36855/figma-plugin" }
  ];
  var RECONNECT_DELAY_MS = 2e3;
  var CONNECT_TIMEOUT_MS = 5e3;
  var HEARTBEAT_INTERVAL_MS = 15e3;
  var sessionId = "";
  var useWebSocket = false;
  var ws = null;
  var reconnectTimer = null;
  var reconnectDelay = RECONNECT_DELAY_MS;
  var intentionalClose = false;
  var wsUrlIndex = 0;
  var heartbeatTimer = null;
  var running = true;
  var currentApiBase = null;
  function el(id) {
    return document.getElementById(id);
  }
  function log(message) {
    try {
      const time = (/* @__PURE__ */ new Date()).toLocaleTimeString();
      const line = `[${time}] ${message}`;
      if (typeof console !== "undefined" && console.log) {
        console.log(line);
      }
      const logEl = el("log");
      if (logEl) {
        logEl.textContent += (logEl.textContent ? "\n" : "") + line;
        logEl.scrollTop = logEl.scrollHeight;
      }
    } catch (e) {
    }
  }
  function setStatus(text, type = "info") {
    try {
      const statusEl = el("status");
      if (!statusEl) return;
      statusEl.textContent = text;
      statusEl.className = `status status-${type}`;
    } catch (e) {
    }
  }
  function setError(text) {
    try {
      const errorEl = el("error");
      if (!errorEl) return;
      errorEl.textContent = text;
      errorEl.style.display = text ? "block" : "none";
    } catch (e) {
    }
  }
  function setConnectedBadge(connected) {
    try {
      const badgeEl = el("badge");
      if (!badgeEl) return;
      badgeEl.className = `badge ${connected ? "connected" : "disconnected"}`;
      badgeEl.textContent = connected ? "\u5DF2\u8FDE\u63A5" : "\u672A\u8FDE\u63A5";
    } catch (e) {
    }
  }
  function showReconnectButton(show) {
    try {
      const btn = el("reconnect");
      if (!btn) return;
      btn.style.display = show ? "inline-flex" : "none";
    } catch (e) {
    }
  }
  function sendToPlugin(payload) {
    try {
      if (typeof parent !== "undefined" && parent.postMessage) {
        parent.postMessage({ pluginMessage: payload }, "*");
      }
    } catch (err) {
      log(`postMessage err: ${err}`);
    }
  }
  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }
  async function apiFetch(baseUrl, path, options = {}) {
    const url = `${baseUrl}${path}`;
    try {
      log(`fetch ${url}`);
      const res = await fetch(url, __spreadProps(__spreadValues({}, options), { mode: "cors" }));
      const text = await res.text();
      let data = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch (e) {
        data = { raw: text };
      }
      log(`fetch ${url} -> ${res.status}`);
      return { ok: res.ok, status: res.status, data, error: "" };
    } catch (err) {
      log(`fetch ${url} ERR: ${err}`);
      return { ok: false, status: 0, data: {}, error: String(err) };
    }
  }
  async function diagnoseHttp() {
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
  async function registerSession(base) {
    const res = await apiFetch(base.url, "/figma-plugin/register", { method: "POST" });
    if (res.ok && res.data && res.data.session_id) {
      sessionId = String(res.data.session_id);
      log(`registered session ${sessionId} via ${base.label}`);
      return true;
    }
    log(`register failed via ${base.label}: ${res.status} ${res.error}`);
    return false;
  }
  async function pollLoop() {
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
          mode: "cors"
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
  async function submitResponse(response) {
    if (!sessionId) return;
    const base = currentApiBase || await diagnoseHttp();
    if (!base) {
      log("no base for response");
      return;
    }
    currentApiBase = base;
    const res = await apiFetch(base.url, `/figma-plugin/response/${sessionId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(response)
    });
    log(`response submitted: ${res.ok}`);
  }
  function tryConnectWebSocket(entry) {
    log(`=== WS ${entry.label}: ${entry.url} ===`);
    setStatus(`WS ${entry.label} \u8FDE\u63A5\u4E2D\u2026`, "info");
    setConnectedBadge(false);
    showReconnectButton(false);
    let socket;
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
        } catch (e) {
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
      setStatus("\u5DF2\u8FDE\u63A5 (WebSocket)", "success");
      setError("");
      setConnectedBadge(true);
      showReconnectButton(false);
      startHeartbeat();
      sendToPlugin({ type: "status", text: "connected" });
    };
    socket.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(String(event.data));
      } catch (e) {
        log("WS invalid JSON");
        return;
      }
      if (msg.type === "command" && msg.payload) {
        log(`WS command: ${msg.payload.method}`);
        sendToPlugin(msg.payload);
      }
    };
    socket.onclose = (event) => {
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
      setStatus("WebSocket \u65AD\u5F00\uFF0C\u5C1D\u8BD5 HTTP \u8F6E\u8BE2", "error");
      useWebSocket = false;
      startHttpTransport();
    };
    socket.onerror = () => {
      log("WS onerror");
    };
  }
  function tryNextWsOrHttp() {
    wsUrlIndex += 1;
    if (wsUrlIndex < WS_URLS.length) {
      log("try next WS");
      tryConnectWebSocket(WS_URLS[wsUrlIndex]);
    } else {
      log("all WS failed, switch to HTTP polling");
      startHttpTransport();
    }
  }
  function startHeartbeat() {
    if (heartbeatTimer) window.clearInterval(heartbeatTimer);
    heartbeatTimer = window.setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "ping" }));
      }
    }, HEARTBEAT_INTERVAL_MS);
  }
  function stopHeartbeat() {
    if (heartbeatTimer) {
      window.clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }
  async function startHttpTransport() {
    if (useWebSocket || !running) return;
    log("=== start HTTP transport ===");
    setStatus("HTTP \u8F6E\u8BE2\u8FDE\u63A5\u4E2D\u2026", "info");
    setConnectedBadge(false);
    const base = await diagnoseHttp();
    if (!base) {
      setStatus("\u65E0\u6CD5\u8FDE\u63A5\u540E\u7AEF", "error");
      setError(`\u6240\u6709\u672C\u5730\u5730\u5740\u90FD\u8FDE\u4E0D\u4E0A\u3002\u6700\u5E38\u89C1\u539F\u56E0\uFF1A
1. \u540E\u7AEF\u6CA1\u542F\u52A8
2. \u7CFB\u7EDF\u4EE3\u7406\u62E6\u622A\u4E86 127.0.0.1/localhost
3. Figma \u6D4F\u89C8\u5668\u7248\u9650\u5236\u672C\u5730\u8FDE\u63A5

\u8BF7\u628A\u65E5\u5FD7\u590D\u5236\u7ED9\u6211\u3002`);
      showReconnectButton(true);
      return;
    }
    currentApiBase = base;
    if (!sessionId) {
      const ok = await registerSession(base);
      if (!ok) {
        setStatus("\u6CE8\u518C\u4F1A\u8BDD\u5931\u8D25", "error");
        setError("\u65E0\u6CD5\u521B\u5EFA HTTP \u8F6E\u8BE2\u4F1A\u8BDD\u3002");
        showReconnectButton(true);
        return;
      }
    }
    setStatus("\u5DF2\u8FDE\u63A5 (HTTP \u8F6E\u8BE2)", "success");
    setError("");
    setConnectedBadge(true);
    showReconnectButton(false);
    sendToPlugin({ type: "status", text: "connected" });
    pollLoop();
  }
  function initTransport() {
    log(`=== boot build=${BUILD_ID} ===`);
    log(`ua=${navigator.userAgent}`);
    log(`fetch=${typeof fetch}, ws=${typeof WebSocket}, clipboard=${typeof navigator !== "undefined" && navigator.clipboard ? "yes" : "no"}`);
    wsUrlIndex = 0;
    tryConnectWebSocket(WS_URLS[0]);
  }
  function reconnect() {
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
      } catch (e) {
      }
      ws = null;
    }
    if (reconnectTimer) window.clearTimeout(reconnectTimer);
    initTransport();
  }
  function copyLogs() {
    try {
      const logEl = el("log");
      if (!logEl) return;
      const text = logEl.textContent || "";
      if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
          const btn = el("copyLog");
          if (btn) {
            btn.textContent = "\u5DF2\u590D\u5236";
            window.setTimeout(() => btn.textContent = "\u590D\u5236\u65E5\u5FD7", 1500);
          }
        });
      } else {
        const range = document.createRange();
        range.selectNodeContents(logEl);
        const sel = window.getSelection();
        if (sel) {
          sel.removeAllRanges();
          sel.addRange(range);
          document.execCommand("copy");
          sel.removeAllRanges();
        }
        const btn = el("copyLog");
        if (btn) {
          btn.textContent = "\u5DF2\u590D\u5236";
          window.setTimeout(() => btn.textContent = "\u590D\u5236\u65E5\u5FD7", 1500);
        }
      }
    } catch (err) {
      log(`copy err: ${err}`);
    }
  }
  function main() {
    try {
      const reconnectBtn = el("reconnect");
      if (reconnectBtn) {
        reconnectBtn.addEventListener("click", reconnect);
      }
      const copyLogBtn = el("copyLog");
      if (copyLogBtn) {
        copyLogBtn.addEventListener("click", copyLogs);
      }
      setStatus("\u521D\u59CB\u5316\u2026", "info");
      initTransport();
    } catch (err) {
      setStatus("\u542F\u52A8\u5931\u8D25", "error");
      setError(`\u811A\u672C\u542F\u52A8\u5F02\u5E38: ${err}`);
      log(`MAIN ERROR: ${err}`);
    }
  }
  window.onmessage = (event) => {
    try {
      const pluginMessage = event.data && event.data.pluginMessage;
      if (!pluginMessage) return;
      const response = pluginMessage;
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
})();
