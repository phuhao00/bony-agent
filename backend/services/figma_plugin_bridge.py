"""Bridge to the AI Media Agent Figma plugin.

Supports two transports:
1. WebSocket (legacy/fallback for desktop users): plugin UI opens ws://localhost:36855/figma-plugin
2. HTTP long-polling (recommended for Figma plugin UI): plugin UI polls for commands and POSTs responses

The Figma Plugin API is document-scoped and can only run inside the Figma editor.
Agents call LangChain tools which serialize commands, wait for the plugin response,
and return the result.
"""

from __future__ import annotations

import asyncio
import json
import threading
import time
import uuid
from concurrent.futures import TimeoutError
from dataclasses import dataclass, field
from typing import Any, Dict, Optional

from utils.logger import setup_logger

logger = setup_logger("figma_plugin_bridge")

DEFAULT_WS_HOST = "0.0.0.0"
DEFAULT_WS_PORT = 36855
DEFAULT_COMMAND_TIMEOUT = 30.0
HTTP_SESSION_TIMEOUT = 60.0


class _CommandState:
    def __init__(self) -> None:
        self.event = asyncio.Event()
        self.result: Optional[Dict[str, Any]] = None


@dataclass
class _HttpSession:
    session_id: str
    command_queue: asyncio.Queue[Dict[str, Any]] = field(default_factory=asyncio.Queue)
    last_seen: float = field(default_factory=time.time)
    active: bool = True


class FigmaPluginBridge:
    """Singleton bridge to the Figma plugin."""

    _instance: Optional["FigmaPluginBridge"] = None
    _lock = threading.Lock()

    def __new__(cls) -> "FigmaPluginBridge":
        with cls._lock:
            if cls._instance is None:
                cls._instance = super().__new__(cls)
                cls._instance._initialized = False
            return cls._instance

    def __init__(self) -> None:
        if self._initialized:
            return
        self._initialized = True
        self.host = DEFAULT_WS_HOST
        self.port = DEFAULT_WS_PORT
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._thread: Optional[threading.Thread] = None
        self._server: Optional[Any] = None
        self._websocket: Optional[Any] = None
        self._pending: Dict[str, _CommandState] = {}
        self._websocket_connected = False
        self._websocket_last_seen: float = 0.0
        self._start_lock = threading.Lock()
        self._http_sessions: Dict[str, _HttpSession] = {}
        self._http_sessions_lock = threading.Lock()
        self._http_cleanup_task: Optional[asyncio.Task] = None

    # ─── public status ─────────────────────────────────────────────────────────

    @property
    def connected(self) -> bool:
        with self._http_sessions_lock:
            return self._websocket_connected or any(s.active for s in self._http_sessions.values())

    def status(self) -> Dict[str, Any]:
        with self._http_sessions_lock:
            http_session_count = len(self._http_sessions)
            http_last_seen = max((s.last_seen for s in self._http_sessions.values()), default=0.0)
        return {
            "connected": self.connected,
            "websocket_connected": self._websocket_connected,
            "http_sessions": http_session_count,
            "bridge_url": "ws://localhost:36855/figma-plugin",
            "poll_url": "http://localhost:8000/figma-plugin/poll/{session_id}",
            "last_seen": max(self._websocket_last_seen, http_last_seen),
            "pending_commands": len(self._pending),
        }

    # ─── lifecycle ─────────────────────────────────────────────────────────────

    def ensure_started(self) -> None:
        """Start the WebSocket server on a background thread if not running."""
        with self._start_lock:
            if self._thread is not None and self._thread.is_alive():
                return
            self._thread = threading.Thread(target=self._run_loop, daemon=True)
            self._thread.start()
            deadline = time.time() + 3.0
            while time.time() < deadline and self._server is None:
                time.sleep(0.05)

    def stop(self) -> None:
        if self._loop is None:
            return
        try:
            asyncio.run_coroutine_threadsafe(self._shutdown(), self._loop).result(timeout=5.0)
        except Exception as exc:
            logger.warning("Figma bridge stop error: %s", exc)

    def _run_loop(self) -> None:
        self._loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self._loop)
        try:
            self._loop.run_until_complete(self._serve())
        except Exception as exc:
            logger.exception("Figma bridge event loop failed: %s", exc)
        finally:
            self._loop.close()
            self._loop = None
            self._server = None

    async def _serve(self) -> None:
        try:
            import websockets
        except ImportError as exc:  # pragma: no cover
            logger.error("websockets package is required for the Figma plugin bridge: %s", exc)
            return

        async def handler(websocket):  # type: ignore[no-untyped-def]
            logger.info("Figma plugin connected via WebSocket from %s", websocket.remote_address)
            self._websocket = websocket
            self._websocket_connected = True
            self._websocket_last_seen = time.time()
            try:
                async for message in websocket:
                    self._websocket_last_seen = time.time()
                    await self._on_websocket_message(message)
            except websockets.exceptions.ConnectionClosed as exc:
                logger.info("Figma plugin WebSocket disconnected: %s", exc)
            finally:
                self._websocket = None
                self._websocket_connected = False
                self._fail_pending("Plugin WebSocket disconnected")

        self._http_cleanup_task = asyncio.create_task(self._http_session_cleanup_loop())
        self._server = await websockets.serve(handler, self.host, self.port, subprotocols=None)
        logger.info("Figma plugin bridge listening on ws://%s:%s/figma-plugin", self.host, self.port)
        await self._server.wait_closed()

    async def _shutdown(self) -> None:
        if self._http_cleanup_task is not None:
            self._http_cleanup_task.cancel()
            try:
                await self._http_cleanup_task
            except asyncio.CancelledError:
                pass
        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()
        self._server = None

    async def _http_session_cleanup_loop(self) -> None:
        while True:
            await asyncio.sleep(10.0)
            now = time.time()
            with self._http_sessions_lock:
                stale = [
                    sid
                    for sid, session in self._http_sessions.items()
                    if session.active and now - session.last_seen > HTTP_SESSION_TIMEOUT
                ]
                for sid in stale:
                    logger.info("Figma HTTP session expired: %s", sid)
                    session = self._http_sessions.get(sid)
                    if session:
                        session.active = False

    # ─── WebSocket message handling ────────────────────────────────────────────

    async def _on_websocket_message(self, raw: str) -> None:
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as exc:
            logger.warning("Invalid JSON from Figma plugin: %s", exc)
            return

        self._websocket_last_seen = time.time()

        if isinstance(data, dict) and data.get("type") == "ping":
            try:
                await self._websocket.send(json.dumps({"type": "pong"}))
            except Exception:
                pass
            return

        if isinstance(data, dict) and data.get("type") == "response" and isinstance(data.get("payload"), dict):
            data = data["payload"]

        command_id = data.get("id")
        if not command_id:
            logger.debug("Figma plugin message without id: %s", data)
            return
        self._resolve_command(command_id, data)

    # ─── HTTP session API ──────────────────────────────────────────────────────

    def register_http_session(self) -> str:
        """Create a new HTTP polling session and return its id."""
        self.ensure_started()
        if self._loop is None:
            raise RuntimeError("Figma plugin bridge is not running")
        future = asyncio.run_coroutine_threadsafe(self._register_http_session_async(), self._loop)
        return future.result(timeout=5.0)

    async def _register_http_session_async(self) -> str:
        session_id = str(uuid.uuid4())
        session = _HttpSession(session_id=session_id)
        with self._http_sessions_lock:
            self._http_sessions[session_id] = session
        logger.info("Figma HTTP session registered: %s", session_id)
        return session_id

    async def poll_http_command(self, session_id: str, timeout: float = 25.0) -> Optional[Dict[str, Any]]:
        """Long-poll for the next command directed at this session."""
        with self._http_sessions_lock:
            session = self._http_sessions.get(session_id)
        if not session:
            return None
        session.last_seen = time.time()
        session.active = True
        try:
            command = await asyncio.wait_for(session.command_queue.get(), timeout=timeout)
            return command
        except asyncio.TimeoutError:
            return None

    async def submit_http_response(self, session_id: str, data: Dict[str, Any]) -> bool:
        """Submit a plugin response via HTTP."""
        with self._http_sessions_lock:
            session = self._http_sessions.get(session_id)
        if not session:
            return False
        session.last_seen = time.time()
        session.active = True
        command_id = data.get("id")
        if not command_id:
            return False
        self._resolve_command(command_id, data)
        return True

    def _resolve_command(self, command_id: str, data: Dict[str, Any]) -> None:
        state = self._pending.pop(command_id, None)
        if state is None:
            logger.debug("No pending command for id %s", command_id)
            return
        state.result = data
        state.event.set()

    def _fail_pending(self, reason: str) -> None:
        for state in list(self._pending.values()):
            state.result = {"ok": False, "error": reason}
            state.event.set()

    # ─── command API ───────────────────────────────────────────────────────────

    def send_command(
        self,
        method: str,
        params: Optional[Dict[str, Any]] = None,
        timeout: float = DEFAULT_COMMAND_TIMEOUT,
    ) -> Dict[str, Any]:
        """Send a command to the plugin and wait for a response."""
        self.ensure_started()
        if self._loop is None:
            return {"ok": False, "error": "Figma plugin bridge is not running"}

        command_id = str(uuid.uuid4())
        payload = {
            "id": command_id,
            "method": method,
            "params": params or {},
        }

        state = _CommandState()
        self._pending[command_id] = state
        try:
            future = asyncio.run_coroutine_threadsafe(
                self._deliver_and_wait(payload, state, timeout), self._loop
            )
            return future.result(timeout=timeout + 5.0)
        except TimeoutError:
            self._pending.pop(command_id, None)
            return {"ok": False, "error": f"Command {method} timed out after {timeout}s"}
        except Exception as exc:
            self._pending.pop(command_id, None)
            logger.exception("Figma plugin command failed: %s", exc)
            return {"ok": False, "error": str(exc)}

    async def _deliver_and_wait(
        self,
        payload: Dict[str, Any],
        state: _CommandState,
        timeout: float,
    ) -> Dict[str, Any]:
        envelope = {"type": "command", "payload": payload}

        # Prefer WebSocket if connected.
        if self._websocket_connected and self._websocket is not None:
            try:
                await self._websocket.send(json.dumps(envelope))
            except Exception as exc:
                return {"ok": False, "error": f"Failed to send command: {exc}"}
        else:
            # Otherwise push to the most recently active HTTP session.
            with self._http_sessions_lock:
                active_sessions = [s for s in self._http_sessions.values() if s.active]
            if not active_sessions:
                return {"ok": False, "error": "Figma plugin is not connected"}
            active_sessions.sort(key=lambda s: s.last_seen, reverse=True)
            await active_sessions[0].command_queue.put(payload)

        try:
            await asyncio.wait_for(state.event.wait(), timeout=timeout)
        except asyncio.TimeoutError:
            return {"ok": False, "error": f"Command {payload.get('method')} timed out after {timeout}s"}

        return state.result or {"ok": False, "error": "Empty response"}


# Global singleton accessor
_bridge: Optional[FigmaPluginBridge] = None


def get_figma_plugin_bridge() -> FigmaPluginBridge:
    global _bridge
    if _bridge is None:
        _bridge = FigmaPluginBridge()
    return _bridge
