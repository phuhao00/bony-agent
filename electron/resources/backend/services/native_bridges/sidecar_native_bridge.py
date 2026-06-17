"""Sidecar HTTP adapter for native desktop automation."""

from __future__ import annotations

import base64
from typing import Any, Dict, List, Optional

from core.native_desktop_bridge import NativeDesktopBridge, WindowInfo
from services.native_bridges import sidecar_client


class SidecarNativeBridge:
    name = "sidecar"

    def is_available(self) -> bool:
        return bool(sidecar_client.sidecar_health().get("ok"))

    def list_windows(self) -> List[WindowInfo]:
        data = sidecar_client.sidecar_request("GET", "/windows")
        return [
            WindowInfo(
                id=str(item.get("id", idx)),
                title=str(item.get("title", "")),
                app_id=item.get("app_id"),
                bundle_id=item.get("bundle_id"),
            )
            for idx, item in enumerate(data.get("windows") or [])
        ]

    def focus_window(self, *, title_hint: str = "", bundle_id: str = "", app_id: str = "") -> bool:
        data = sidecar_client.sidecar_request(
            "POST",
            "/focus",
            {"title_hint": title_hint, "bundle_id": bundle_id, "app_id": app_id},
        )
        return bool(data.get("success"))

    def foreground_app_name(self) -> str:
        if sidecar_client.sidecar_has_foreground():
            data = sidecar_client.sidecar_request("GET", "/foreground", fail_open=True)
            app = str(data.get("app") or "")
            if app:
                return app
        # Legacy Sidecar (404 /foreground) or empty — use in-process osascript/lsappinfo
        from services.native_bridges.python_native_bridge import PythonNativeBridge

        return PythonNativeBridge().foreground_app_name()

    def capture_screen(self, *, region: Optional[Dict[str, int]] = None) -> bytes:
        payload: Dict[str, Any] = {}
        if region:
            payload["region"] = region
            if region.get("app_hint"):
                payload["app_hint"] = str(region.get("app_hint"))
            if region.get("display_index"):
                payload["display_index"] = int(region.get("display_index"))
        elif region is None:
            pass
        data = sidecar_client.sidecar_request("POST", "/capture", payload or None)
        b64 = data.get("image_base64") or ""
        if not b64:
            return b""
        return base64.b64decode(b64)

    def mouse_click(self, x: int, y: int, button: str = "left", double: bool = False) -> bool:
        data = sidecar_client.sidecar_request(
            "POST",
            "/click",
            {"x": x, "y": y, "button": button, "double": double},
        )
        return bool(data.get("success"))

    def keyboard_type(self, text: str) -> bool:
        data = sidecar_client.sidecar_request("POST", "/type", {"text": text})
        return bool(data.get("success"))

    def keyboard_hotkey(self, keys: List[str]) -> bool:
        data = sidecar_client.sidecar_request("POST", "/hotkey", {"keys": keys})
        return bool(data.get("success"))
