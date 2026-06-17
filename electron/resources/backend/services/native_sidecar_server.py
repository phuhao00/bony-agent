#!/usr/bin/env python3
"""Localhost-only HTTP sidecar for native desktop automation."""

from __future__ import annotations

import argparse
import base64
import json
import secrets
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any, Dict, Optional

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "backend"))

from services.native_bridges.python_native_bridge import PythonNativeBridge  # noqa: E402

TEMP_DIR = PROJECT_ROOT / "storage" / "temp"
PORT_FILE = TEMP_DIR / "sidecar.port"
TOKEN_FILE = TEMP_DIR / "sidecar.token"

_bridge = PythonNativeBridge()


class SidecarHandler(BaseHTTPRequestHandler):
    token: str = ""

    def _auth_ok(self) -> bool:
        return self.headers.get("X-Sidecar-Token", "") == self.token

    def _json(self, code: int, payload: Dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> Dict[str, Any]:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8"))

    def log_message(self, format: str, *args: Any) -> None:
        return

    def do_GET(self) -> None:
        if self.path == "/health":
            self._json(200, {"ok": True, "bridge": _bridge.name})
            return
        if self.path == "/windows":
            if not self._auth_ok():
                self._json(401, {"error": "unauthorized"})
                return
            windows = [w.to_dict() for w in _bridge.list_windows()]
            self._json(200, {"windows": windows})
            return
        if self.path == "/foreground":
            if not self._auth_ok():
                self._json(401, {"error": "unauthorized"})
                return
            self._json(200, {"app": _bridge.foreground_app_name()})
            return
        self._json(404, {"error": "not found"})

    def do_POST(self) -> None:
        if not self._auth_ok():
            self._json(401, {"error": "unauthorized"})
            return
        payload = self._read_json()
        if self.path == "/app/open-locate":
            from services.native_desktop_service import _ensure_app_open_and_locate_impl

            app_hint = str(payload.get("app_hint") or "")
            result = _ensure_app_open_and_locate_impl(
                app_hint,
                launch_wait_s=float(payload.get("launch_wait_s") or 2.5),
                activate_wait_s=float(payload.get("activate_wait_s") or 1.0),
                locate_retries=int(payload.get("locate_retries") or 8),
                locate_wait_s=float(payload.get("locate_wait_s") or 0.6),
            )
            self._json(200, result)
            return
        if self.path == "/focus":
            ok = _bridge.focus_window(
                title_hint=str(payload.get("title_hint") or ""),
                bundle_id=str(payload.get("bundle_id") or ""),
                app_id=str(payload.get("app_id") or ""),
            )
            self._json(200, {"success": ok})
            return
        if self.path == "/capture":
            region = payload.get("region")
            app_hint = str(payload.get("app_hint") or (region or {}).get("app_hint") or "")
            display_index = payload.get("display_index") or (region or {}).get("display_index")
            capture_meta: Dict[str, Any] = {}
            data = b""
            if app_hint:
                try:
                    from services.native_capture_macos import capture_for_automation

                    frame = capture_for_automation(app_hint=app_hint)
                    data = frame.png_bytes
                    capture_meta = frame.to_dict()
                except Exception:
                    data = b""
            if not data and display_index:
                try:
                    from services.native_capture_macos import _capture_display_png, _list_displays, _png_size

                    idx = int(display_index)
                    data = _capture_display_png(idx)
                    displays = _list_displays()
                    disp = next((d for d in displays if d["index"] == idx), None)
                    if disp and data:
                        pw, ph = _png_size(data)
                        lw, lh = int(disp["width"]), int(disp["height"])
                        capture_meta = {
                            "origin_x": int(disp["x"]),
                            "origin_y": int(disp["y"]),
                            "pixel_width": pw,
                            "pixel_height": ph,
                            "logical_width": lw,
                            "logical_height": lh,
                            "scale_factor": (pw / lw) if lw else 1.0,
                            "display_index": idx,
                            "mode": "display",
                        }
                except Exception:
                    data = b""
            if not data:
                data = _bridge.capture_screen(region=region if isinstance(region, dict) else None)
            resp: Dict[str, Any] = {
                "success": bool(data),
                "image_base64": base64.b64encode(data).decode("ascii") if data else "",
            }
            if capture_meta:
                resp["capture_meta"] = capture_meta
            self._json(200, resp)
            return
        if self.path == "/click":
            ok = _bridge.mouse_click(
                int(payload.get("x", 0)),
                int(payload.get("y", 0)),
                button=str(payload.get("button") or "left"),
                double=bool(payload.get("double")),
            )
            self._json(200, {"success": ok})
            return
        if self.path == "/type":
            ok = _bridge.keyboard_type(str(payload.get("text") or ""))
            self._json(200, {"success": ok})
            return
        if self.path == "/hotkey":
            keys = payload.get("keys") or []
            ok = _bridge.keyboard_hotkey([str(k) for k in keys])
            self._json(200, {"success": ok})
            return
        self._json(404, {"error": "not found"})


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=0)
    args = parser.parse_args()

    TEMP_DIR.mkdir(parents=True, exist_ok=True)
    token = secrets.token_urlsafe(24)
    TOKEN_FILE.write_text(token, encoding="utf-8")

    server = HTTPServer(("127.0.0.1", args.port), SidecarHandler)
    SidecarHandler.token = token
    port = server.server_address[1]
    PORT_FILE.write_text(str(port), encoding="utf-8")
    print(json.dumps({"ok": True, "port": port, "token_file": str(TOKEN_FILE)}), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
