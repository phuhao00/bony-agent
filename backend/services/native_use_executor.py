"""Execute native desktop GUI actions via Sidecar / Python bridge."""

from __future__ import annotations

import hashlib
import io
import time
from typing import Any, Dict, List, Optional, Tuple

from core.native_desktop_bridge import NativeDesktopBridge
from utils.logger import setup_logger

logger = setup_logger("native_use_executor")


def png_dimensions(png_bytes: bytes) -> Tuple[int, int]:
    if not png_bytes:
        return 1920, 1080
    try:
        from PIL import Image

        with Image.open(io.BytesIO(png_bytes)) as img:
            return img.size
    except Exception:
        return 1920, 1080


def _scale_xy(x: int, y: int, width: int, height: int) -> Tuple[int, int]:
    sx = max(0, min(int(x * width / 1000), width - 1))
    sy = max(0, min(int(y * height / 1000), height - 1))
    return sx, sy


def resolve_click_coords(
    x: int,
    y: int,
    width: int,
    height: int,
) -> Tuple[int, int, str]:
    """
    Qwen-VL 常返回像素坐标；系统 prompt 要求 0-1000 归一化。
    自动判断：若坐标超出 1000 且在屏幕范围内，视为像素坐标直接使用。
    """
    xi, yi = int(x), int(y)
    if xi > 1000 or yi > 1000:
        if xi <= width and yi <= height:
            return max(0, min(xi, width - 1)), max(0, min(yi, height - 1)), "pixel"
    px, py = _scale_xy(xi, yi, width, height)
    return px, py, "normalized"


def screenshots_similar(before: bytes, after: bytes, *, threshold: float = 0.98) -> bool:
    """Rough perceptual similarity — True if screens barely changed."""
    if not before or not after:
        return False
    if before == after:
        return True
    try:
        from PIL import Image

        with Image.open(io.BytesIO(before)) as im1, Image.open(io.BytesIO(after)) as im2:
            im1 = im1.convert("L").resize((160, 90))
            im2 = im2.convert("L").resize((160, 90))
            p1 = list(im1.getdata())
            p2 = list(im2.getdata())
            if len(p1) != len(p2):
                return False
            diff = sum(abs(a - b) for a, b in zip(p1, p2)) / (255 * len(p1))
            return diff < (1.0 - threshold)
    except Exception:
        h1 = hashlib.sha256(before).hexdigest()
        h2 = hashlib.sha256(after).hexdigest()
        return h1 == h2


def execute_native_action(
    action: Dict[str, Any],
    bridge: NativeDesktopBridge,
    *,
    screen_width: int,
    screen_height: int,
) -> Dict[str, Any]:
    name = str(action.get("action") or "").lower().strip()
    log: Dict[str, Any] = {
        "action": name,
        "reason": str(action.get("reason") or action.get("summary") or ""),
    }

    try:
        if name == "click":
            x = int(action.get("x", 500))
            y = int(action.get("y", 500))
            px, py, coord_mode = resolve_click_coords(x, y, screen_width, screen_height)
            ok = bridge.mouse_click(px, py)
            log.update({"ok": ok, "x": px, "y": py, "coord_mode": coord_mode, "raw_x": x, "raw_y": y})
            return log
        if name in {"type", "fill"}:
            text = str(action.get("text") or "")
            ok = bridge.keyboard_type(text)
            log.update({"ok": ok, "text_len": len(text)})
            return log
        if name == "hotkey":
            keys = [str(k) for k in (action.get("keys") or [])]
            ok = bridge.keyboard_hotkey(keys) if keys else False
            log.update({"ok": ok, "keys": keys})
            if not ok:
                log["error"] = (
                    "快捷键发送失败，请在系统设置 → 隐私与安全性 → 辅助功能中"
                    "授权本应用或 Sidecar 进程"
                )
            return log
        if name == "wait":
            ms = int(action.get("ms", 1000))
            time.sleep(max(0, ms) / 1000.0)
            log.update({"ok": True, "ms": ms})
            return log
        if name == "done":
            log.update({"ok": True, "summary": str(action.get("summary") or "")})
            return log
        if name == "fail":
            log.update({"ok": False, "error": str(action.get("reason") or action.get("error") or "failed")})
            return log
        log.update({"ok": False, "error": f"unknown action: {name}"})
        return log
    except Exception as exc:
        logger.warning("execute_native_action failed: %s", exc)
        log.update({"ok": False, "error": str(exc)})
        return log
