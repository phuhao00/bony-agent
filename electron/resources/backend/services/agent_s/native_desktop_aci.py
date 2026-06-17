"""Native PC desktop ACI: semantic actions via Sidecar + Qwen-VL grounding."""

from __future__ import annotations

import time
from typing import Any, Dict, List, Optional

from core.native_desktop_bridge import NativeDesktopBridge
from services.agent_s.qwen_grounding import QwenVLGroundingClient
from services.native_use_executor import resolve_click_coords
from utils.logger import setup_logger

logger = setup_logger("agent_s.native_aci")


class NativeDesktopACI:
    """OS-level desktop ACI (Sidecar). Maps semantic actions to mouse/keyboard."""

    def __init__(
        self,
        bridge: NativeDesktopBridge,
        *,
        grounding: Optional[QwenVLGroundingClient] = None,
        screen_width: int = 1920,
        screen_height: int = 1080,
    ):
        self.bridge = bridge
        self.grounding = grounding or QwenVLGroundingClient()
        self.screen_width = screen_width
        self.screen_height = screen_height
        self._last_png: bytes = b""
        self._capture_origin_x = 0
        self._capture_origin_y = 0
        self._capture_scale = 1.0

    def set_capture_frame(self, *, origin_x: int = 0, origin_y: int = 0, scale_factor: float = 1.0) -> None:
        self._capture_origin_x = int(origin_x)
        self._capture_origin_y = int(origin_y)
        self._capture_scale = float(scale_factor) if scale_factor else 1.0

    def assign_screenshot(self, png_bytes: bytes) -> None:
        self._last_png = png_bytes or b""

    def update_screen_size(self, width: int, height: int) -> None:
        if width > 0:
            self.screen_width = width
        if height > 0:
            self.screen_height = height

    def execute_action(self, action: Dict[str, Any]) -> Dict[str, Any]:
        name = str(action.get("action") or "").lower().strip()
        log: Dict[str, Any] = {
            "action": name,
            "reason": str(action.get("reason") or action.get("summary") or ""),
        }

        try:
            if name == "click":
                return self._click(action, log)
            if name in {"type", "fill"}:
                text = str(action.get("text") or "")
                ok = self.bridge.keyboard_type(text)
                log.update({"ok": ok, "text_len": len(text), "method": "keyboard"})
                return log
            if name == "hotkey":
                keys = [str(k) for k in (action.get("keys") or [])]
                ok = self.bridge.keyboard_hotkey(keys) if keys else False
                log.update({"ok": ok, "keys": keys, "method": "hotkey"})
                if not ok:
                    log["error"] = "快捷键发送失败，请检查辅助功能权限"
                return log
            if name == "wait":
                ms = int(action.get("ms", 1000))
                time.sleep(max(0, ms) / 1000.0)
                log.update({"ok": True, "ms": ms, "method": "wait"})
                return log
            if name == "done":
                log.update({"ok": True, "summary": str(action.get("summary") or ""), "method": "done"})
                return log
            if name == "fail":
                log.update({
                    "ok": False,
                    "error": str(action.get("reason") or action.get("error") or "failed"),
                    "method": "fail",
                })
                return log
            log.update({"ok": False, "error": f"unknown action: {name}"})
            return log
        except Exception as exc:
            logger.warning("NativeDesktopACI execute failed: %s", exc)
            log.update({"ok": False, "error": str(exc)})
            return log

    def _click(self, action: Dict[str, Any], log: Dict[str, Any]) -> Dict[str, Any]:
        target = str(action.get("target") or action.get("description") or "").strip()
        log["target"] = target

        # Direct coordinates from planner (legacy fallback)
        if action.get("x") is not None and action.get("y") is not None:
            x, y = int(action["x"]), int(action["y"])
            px, py, mode = resolve_click_coords(x, y, self.screen_width, self.screen_height)
            gx, gy = self._to_global_click(px, py)
            ok = self.bridge.mouse_click(gx, gy)
            log.update({"ok": ok, "x": gx, "y": gy, "coord_mode": mode, "method": "direct_coord"})
            return log

        if not target:
            log.update({"ok": False, "error": "click 缺少 target 描述"})
            return log

        if not self.grounding.available or not self._last_png:
            log.update({"ok": False, "error": "Grounding 不可用或缺少截图"})
            return log

        coords = self.grounding.ground(
            screenshot_png=self._last_png,
            element_description=target,
            screen_width=self.screen_width,
            screen_height=self.screen_height,
        )
        if not coords:
            log.update({"ok": False, "error": f"无法定位: {target[:60]}", "grounding_miss": True})
            return log

        nx, ny = coords
        px, py, mode = resolve_click_coords(nx, ny, self.screen_width, self.screen_height)
        gx, gy = self._to_global_click(px, py)
        ok = self.bridge.mouse_click(gx, gy)
        log.update({
            "ok": ok,
            "x": gx,
            "y": gy,
            "image_x": px,
            "image_y": py,
            "norm_x": nx,
            "norm_y": ny,
            "coord_mode": mode,
            "method": "qwen_grounding",
            "target": target,
            "capture_origin": [self._capture_origin_x, self._capture_origin_y],
            "capture_scale": self._capture_scale,
        })
        if not ok:
            log["error"] = "鼠标点击失败，请检查辅助功能权限"
        return log

    def _to_global_click(self, image_x: int, image_y: int) -> tuple[int, int]:
        scale = self._capture_scale or 1.0
        gx = int(self._capture_origin_x + image_x / scale)
        gy = int(self._capture_origin_y + image_y / scale)
        return gx, gy
