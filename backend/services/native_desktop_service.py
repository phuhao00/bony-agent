"""Select and expose native desktop bridge."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from core.native_desktop_bridge import NativeDesktopBridge, WindowInfo
from services.native_bridges.python_native_bridge import PythonNativeBridge
from services.native_bridges.sidecar_native_bridge import SidecarNativeBridge
from utils.logger import setup_logger

logger = setup_logger("native_desktop_service")

_sidecar = SidecarNativeBridge()
_python = PythonNativeBridge()


def get_bridge() -> NativeDesktopBridge:
    if _sidecar.is_available():
        return _sidecar
    return _python


def bridge_status() -> Dict[str, Any]:
    return {
        "sidecar": _sidecar.is_available(),
        "python": _python.is_available(),
        "active": get_bridge().name,
    }


def list_windows() -> List[Dict[str, Any]]:
    return [w.to_dict() for w in get_bridge().list_windows()]


def focus_app(*, title_hint: str = "", bundle_id: str = "", app_id: str = "") -> Dict[str, Any]:
    bridge = get_bridge()
    ok = bridge.focus_window(title_hint=title_hint, bundle_id=bundle_id, app_id=app_id)
    return {"success": ok, "bridge": bridge.name}


def foreground_app() -> str:
    try:
        bridge = get_bridge()
        if hasattr(bridge, "foreground_app_name"):
            name = str(bridge.foreground_app_name() or "")
            if name:
                return name
    except Exception as exc:
        logger.debug("foreground_app bridge failed: %s", exc)
    try:
        return str(_python.foreground_app_name() or "")
    except Exception as exc:
        logger.debug("foreground_app python fallback failed: %s", exc)
    return ""


def app_is_running(app_hint: str) -> bool:
    try:
        bridge = get_bridge()
        if hasattr(bridge, "app_is_running"):
            return bool(bridge.app_is_running(app_hint))
    except Exception as exc:
        logger.debug("app_is_running bridge failed: %s", exc)
    return _python.app_is_running(app_hint)


def app_hint_matches_foreground(app_hint: str, foreground: str) -> bool:
    hint = (app_hint or "").strip().lower()
    fg = (foreground or "").strip().lower()
    if not hint or not fg:
        return True
    aliases = {
        "lark": ("lark", "feishu", "飞书"),
        "feishu": ("lark", "feishu", "飞书"),
        "飞书": ("lark", "feishu", "飞书"),
    }
    tokens = aliases.get(hint, (hint,))
    return any(t in fg or fg in t for t in tokens)


def focus_app_and_verify(app_hint: str, *, retries: int = 3, wait_s: float = 1.0) -> Dict[str, Any]:
    """Focus target app with retries and verify it is frontmost."""
    import time

    last_fg = ""
    for attempt in range(max(1, retries)):
        focus = focus_app(app_id=app_hint)
        time.sleep(wait_s)
        last_fg = foreground_app()
        if app_hint_matches_foreground(app_hint, last_fg):
            return {
                "success": True,
                "foreground": last_fg,
                "attempt": attempt + 1,
                "bridge": get_bridge().name,
            }
        logger.warning(
            "Focus attempt %s: wanted %s, got foreground=%s",
            attempt + 1,
            app_hint,
            last_fg,
        )
    return {
        "success": False,
        "foreground": last_fg,
        "attempt": retries,
        "bridge": get_bridge().name,
        "error": f"无法将 {app_hint} 切到前台，当前前台应用: {last_fg or '未知'}",
    }


def launch_app(app_hint: str) -> Dict[str, Any]:
    """Launch target app if installed (`open -a`)."""
    ok, name = _python.launch_app(app_hint)
    return {"success": ok, "app_name": name, "bridge": get_bridge().name}


def ensure_app_open_and_locate(
    app_hint: str,
    *,
    launch_wait_s: float = 2.5,
    activate_wait_s: float = 1.0,
    locate_retries: int = 8,
    locate_wait_s: float = 0.6,
) -> Dict[str, Any]:
    """Prefer Sidecar (has permissions); fallback to in-process implementation."""
    if _sidecar.is_available():
        try:
            from services.native_bridges import sidecar_client

            payload = sidecar_client.sidecar_request(
                "POST",
                "/app/open-locate",
                {
                    "app_hint": app_hint,
                    "launch_wait_s": launch_wait_s,
                    "activate_wait_s": activate_wait_s,
                    "locate_retries": locate_retries,
                    "locate_wait_s": locate_wait_s,
                },
            )
            if payload.get("success") or payload.get("target_frame"):
                return payload
            if payload.get("error"):
                logger.warning("sidecar open-locate: %s", payload.get("error"))
        except Exception as exc:
            logger.warning("sidecar open-locate failed, using local: %s", exc)

    return _ensure_app_open_and_locate_impl(
        app_hint,
        launch_wait_s=launch_wait_s,
        activate_wait_s=activate_wait_s,
        locate_retries=locate_retries,
        locate_wait_s=locate_wait_s,
    )


def _ensure_app_open_and_locate_impl(
    app_hint: str,
    *,
    launch_wait_s: float = 2.5,
    activate_wait_s: float = 1.0,
    locate_retries: int = 8,
    locate_wait_s: float = 0.6,
) -> Dict[str, Any]:
    """
    1. 若未运行则启动应用
    2. show_app：activate + 取消最小化 + 置前
    3. 轮询定位窗口（Quartz / AppleScript 双通道）
    """
    import time

    result: Dict[str, Any] = {
        "app_hint": app_hint,
        "was_running": False,
        "launched": False,
        "activated": False,
        "target_frame": None,
        "success": False,
    }
    if not app_hint:
        result["error"] = "app_hint is required"
        return result

    was_running = app_is_running(app_hint)
    result["was_running"] = was_running

    if not was_running:
        launch = launch_app(app_hint)
        result["launched"] = bool(launch.get("success"))
        result["launch_name"] = launch.get("app_name") or ""
        if not result["launched"]:
            result["error"] = f"无法启动 {app_hint}，请确认已安装（本机应用名可能是 Feishu/飞书）"
            return result
        time.sleep(max(0.5, launch_wait_s))

    shown, show_name = _python.show_app(app_hint)
    result["activated"] = shown
    result["show_name"] = show_name
    time.sleep(max(0.5, activate_wait_s))

    for attempt in range(max(1, locate_retries)):
        frame = locate_app_target(app_hint)
        if frame:
            result["target_frame"] = frame
            result["success"] = True
            result["locate_attempt"] = attempt + 1
            result["locate_via"] = frame.get("locate_via", "quartz")
            result["foreground"] = foreground_app()
            logger.info(
                "ensure_app_open_and_locate: %s on D%s (attempt %s)",
                frame.get("owner_name"),
                frame.get("display_index"),
                attempt + 1,
            )
            return result
        # retry show on early attempts
        if attempt in {0, 2, 4}:
            _python.show_app(app_hint)
            time.sleep(activate_wait_s)
        time.sleep(locate_wait_s)

    result["error"] = (
        f"已尝试打开 {app_hint}（显示名 {show_name or 'Feishu/飞书'}），但仍未检测到窗口。"
        "请为运行后端的 Terminal/Cursor/Electron 授予「辅助功能」和「屏幕录制」权限，"
        "并确认飞书未完全退出（Dock 中应有点点）"
    )
    return result


def locate_app_target(app_hint: str) -> Optional[Dict[str, Any]]:
    """Locate target app window + display (Quartz, then AppleScript fallback)."""
    import sys

    if not app_hint or sys.platform != "darwin":
        return None
    try:
        from services.native_capture_macos import find_target_window, resolve_target_frame

        window = find_target_window(app_hint=app_hint, prefer_frontmost=False)
        if window and not window.get("id"):
            frame = resolve_target_frame(app_hint)
            if frame:
                data = frame.to_dict()
                data["locate_via"] = "applescript+quartz"
                return data
        frame = resolve_target_frame(app_hint)
        if frame:
            data = frame.to_dict()
            data["locate_via"] = "quartz" if window else "mixed"
            return data
    except Exception as exc:
        logger.warning("locate_app_target failed: %s", exc)
    return None


def capture_screen(
    region: Optional[Dict[str, int]] = None,
    *,
    app_hint: str = "",
    target_frame: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    import base64
    import sys

    capture_meta: Dict[str, Any] = {}
    data = b""

    if sys.platform == "darwin" and app_hint and not region:
        try:
            from services.native_capture_macos import TargetFrame, capture_for_automation

            target = TargetFrame.from_dict(target_frame) if target_frame else None
            frame = capture_for_automation(app_hint=app_hint, target=target)
            data = frame.png_bytes
            capture_meta = frame.to_dict()
        except Exception as exc:
            logger.warning("multi-monitor capture failed, fallback to bridge: %s", exc)

    if not data:
        data = get_bridge().capture_screen(region=region)
        if sys.platform == "darwin" and app_hint and not capture_meta:
            try:
                from services.native_capture_macos import capture_for_automation

                frame = capture_for_automation(app_hint=app_hint)
                if frame.png_bytes:
                    data = frame.png_bytes
                    capture_meta = frame.to_dict()
            except Exception as exc:
                logger.debug("capture_for_automation fallback skipped: %s", exc)

    return {
        "success": bool(data),
        "bridge": get_bridge().name,
        "image_base64": base64.b64encode(data).decode("ascii") if data else "",
        "bytes": len(data),
        "capture_meta": capture_meta,
    }


def semi_auto_playbook(goal: str, app_hint: str = "") -> Dict[str, Any]:
    return {
        "success": False,
        "status": "semi_auto",
        "playbook": [
            f"1. 手动打开应用：{app_hint or '目标应用'}",
            f"2. 目标：{goal}",
            "3. 本机未启用原生桥或缺少权限；请在系统设置中授予辅助功能/屏幕录制",
            "4. 或在 Electron 桌面包中启动 Sidecar",
        ],
        "computer_use_hint": "若目标有 Web 版，可改用 Computer Use 浏览器自动化",
    }
