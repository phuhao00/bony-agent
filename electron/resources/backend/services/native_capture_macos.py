"""Multi-monitor aware screen capture for native desktop automation (macOS)."""

from __future__ import annotations

import sys
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from utils.logger import setup_logger

logger = setup_logger("native_capture_macos")

_APP_ALIASES: Dict[str, List[str]] = {
    "lark": ["Feishu", "Lark", "飞书", "Lark Suite"],
    "feishu": ["Feishu", "Lark", "飞书"],
    "飞书": ["飞书", "Feishu", "Lark"],
}


@dataclass
class TargetFrame:
    """Pinned target app window + display — resolved once, no focus stealing."""

    window_id: int = 0
    display_index: int = 1
    origin_x: int = 0
    origin_y: int = 0
    logical_width: int = 0
    logical_height: int = 0
    owner_name: str = ""
    window_title: str = ""
    mode: str = "window"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "window_id": self.window_id,
            "display_index": self.display_index,
            "origin_x": self.origin_x,
            "origin_y": self.origin_y,
            "logical_width": self.logical_width,
            "logical_height": self.logical_height,
            "owner_name": self.owner_name,
            "window_title": self.window_title,
            "mode": self.mode,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "TargetFrame":
        return cls(
            window_id=int(data.get("window_id") or 0),
            display_index=int(data.get("display_index") or 1),
            origin_x=int(data.get("origin_x") or 0),
            origin_y=int(data.get("origin_y") or 0),
            logical_width=int(data.get("logical_width") or 0),
            logical_height=int(data.get("logical_height") or 0),
            owner_name=str(data.get("owner_name") or ""),
            window_title=str(data.get("window_title") or ""),
            mode=str(data.get("mode") or "window"),
        )


@dataclass
class CaptureFrame:
    png_bytes: bytes
    origin_x: int = 0
    origin_y: int = 0
    pixel_width: int = 0
    pixel_height: int = 0
    logical_width: int = 0
    logical_height: int = 0
    scale_factor: float = 1.0
    display_index: int = 1
    mode: str = "window"
    window_title: str = ""
    owner_name: str = ""
    window_id: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "origin_x": self.origin_x,
            "origin_y": self.origin_y,
            "pixel_width": self.pixel_width,
            "pixel_height": self.pixel_height,
            "logical_width": self.logical_width,
            "logical_height": self.logical_height,
            "scale_factor": self.scale_factor,
            "display_index": self.display_index,
            "mode": self.mode,
            "window_title": self.window_title,
            "owner_name": self.owner_name,
            "window_id": self.window_id,
        }


def _alias_names(app_hint: str) -> List[str]:
    key = (app_hint or "").strip().lower()
    if key in _APP_ALIASES:
        return _APP_ALIASES[key]
    if app_hint:
        return [app_hint]
    return []


def _list_displays() -> List[Dict[str, Any]]:
    import Quartz

    max_displays = 16
    _active, display_ids, count = Quartz.CGGetActiveDisplayList(max_displays, None, None)
    displays: List[Dict[str, Any]] = []
    for idx, did in enumerate(display_ids[:count], 1):
        bounds = Quartz.CGDisplayBounds(did)
        displays.append(
            {
                "index": idx,
                "id": int(did),
                "x": int(bounds.origin.x),
                "y": int(bounds.origin.y),
                "width": int(bounds.size.width),
                "height": int(bounds.size.height),
            }
        )
    return displays


def _point_in_display(px: float, py: float, disp: Dict[str, Any]) -> bool:
    return (
        disp["x"] <= px < disp["x"] + disp["width"]
        and disp["y"] <= py < disp["y"] + disp["height"]
    )


def _display_index_for_point(px: float, py: float) -> int:
    for disp in _list_displays():
        if _point_in_display(px, py, disp):
            return int(disp["index"])
    return 1


def _list_all_windows() -> List[Dict[str, Any]]:
    """All window layers (includes minimized / occluded) for matching."""
    import Quartz

    opts = Quartz.kCGWindowListOptionAll | Quartz.kCGWindowListExcludeDesktopElements
    raw = Quartz.CGWindowListCopyWindowInfo(opts, Quartz.kCGNullWindowID) or []
    windows: List[Dict[str, Any]] = []
    for item in raw:
        bounds = item.get("kCGWindowBounds") or {}
        width = float(bounds.get("Width") or 0)
        height = float(bounds.get("Height") or 0)
        if width < 80 or height < 80:
            continue
        if int(item.get("kCGWindowLayer") or 0) != 0:
            continue
        windows.append(
            {
                "id": int(item.get("kCGWindowNumber") or 0),
                "owner": str(item.get("kCGWindowOwnerName") or ""),
                "title": str(item.get("kCGWindowName") or ""),
                "x": int(bounds.get("X") or 0),
                "y": int(bounds.get("Y") or 0),
                "width": int(width),
                "height": int(height),
                "area": int(width * height),
                "on_screen": bool(item.get("kCGWindowIsOnscreen", 0)),
            }
        )
    return windows


def _list_onscreen_windows() -> List[Dict[str, Any]]:
    return [w for w in _list_all_windows() if w.get("on_screen")]


def _find_window_via_applescript(app_hint: str) -> Optional[Dict[str, Any]]:
    """Fallback when Quartz list is empty (missing Screen Recording permission)."""
    import subprocess

    names = _alias_names(app_hint)
    if not names:
        return None
    names_literal = "{" + ", ".join(f'"{n}"' for n in names) + "}"
    script = f'''
set appNames to {names_literal}
tell application "System Events"
  repeat with procName in appNames
    if exists process procName then
      tell process procName
        if (count of windows) > 0 then
          set w to front window
          set p to position of w
          set s to size of w
          set t to name of w
          return procName & "|" & (item 1 of p as text) & "," & (item 2 of p as text) & "|" & (item 1 of s as text) & "," & (item 2 of s as text) & "|" & t
        end if
      end tell
    end if
  end repeat
end tell
return ""
'''
    try:
        completed = subprocess.run(
            ["osascript", "-e", script],
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )
        raw = (completed.stdout or "").strip()
        if not raw or "|" not in raw:
            return None
        parts = raw.split("|")
        owner = parts[0]
        px, py = [int(v) for v in parts[1].split(",")]
        ww, wh = [int(v) for v in parts[2].split(",")]
        title = parts[3] if len(parts) > 3 else ""
        window: Dict[str, Any] = {
            "id": 0,
            "owner": owner,
            "title": title,
            "x": px,
            "y": py,
            "width": ww,
            "height": wh,
            "area": ww * wh,
            "on_screen": True,
        }
        return _attach_quartz_window_id(window)
    except (subprocess.TimeoutExpired, OSError, ValueError) as exc:
        logger.debug("applescript window lookup failed: %s", exc)
        return None


def _attach_quartz_window_id(window: Dict[str, Any]) -> Dict[str, Any]:
    """Try to bind CGWindowID by owner + position."""
    owner = window.get("owner") or ""
    for w in _list_all_windows():
        if w["owner"] != owner:
            continue
        if abs(w["x"] - window["x"]) <= 8 and abs(w["y"] - window["y"]) <= 8:
            window["id"] = w["id"]
            window["on_screen"] = w.get("on_screen", True)
            return window
    for w in _list_all_windows():
        if _match_owner(w["owner"], _alias_names(owner)) and w.get("on_screen"):
            window["id"] = w["id"]
            window.update({k: w[k] for k in ("x", "y", "width", "height", "area", "title") if w.get(k)})
            return window
    return window


def _match_owner(owner: str, names: List[str]) -> bool:
    owner_l = owner.lower()
    for name in names:
        token = name.lower()
        if token in owner_l or owner_l in token:
            return True
    return False


def find_target_window(*, app_hint: str = "", prefer_frontmost: bool = False) -> Optional[Dict[str, Any]]:
    """Find target app window (Quartz + AppleScript fallback)."""
    names = _alias_names(app_hint)

    if names:
        on_screen = _list_onscreen_windows()
        candidates = [w for w in on_screen if _match_owner(w["owner"], names)]
        if candidates:
            candidates.sort(key=lambda w: w["area"], reverse=True)
            return candidates[0]

        all_windows = _list_all_windows()
        candidates = [w for w in all_windows if _match_owner(w["owner"], names)]
        if candidates:
            candidates.sort(key=lambda w: (w.get("on_screen", False), w["area"]), reverse=True)
            return candidates[0]

        via_as = _find_window_via_applescript(app_hint)
        if via_as:
            logger.info("find_target_window via AppleScript: %s", via_as.get("owner"))
            return via_as

    windows = _list_onscreen_windows()
    if not windows and app_hint:
        via_as = _find_window_via_applescript(app_hint)
        if via_as:
            return via_as
        return None

    if prefer_frontmost and windows:
        import subprocess

        try:
            completed = subprocess.run(
                [
                    "osascript",
                    "-e",
                    'tell application "System Events" to get name of '
                    "first application process whose frontmost is true",
                ],
                capture_output=True,
                text=True,
                timeout=5,
                check=False,
            )
            fg = (completed.stdout or "").strip()
            if fg:
                for w in windows:
                    if w["owner"] == fg:
                        return w
        except (subprocess.TimeoutExpired, OSError):
            pass

    return None


def resolve_target_frame(app_hint: str) -> Optional[TargetFrame]:
    """
    Locate which screen/window the target app is on — once per session.
    Passive only: no activate, no focus steal.
    """
    if not app_hint or sys.platform != "darwin":
        return None

    window = find_target_window(app_hint=app_hint, prefer_frontmost=False)
    if not window:
        logger.warning("resolve_target_frame: no on-screen window for %s", app_hint)
        return None

    cx = window["x"] + window["width"] / 2
    cy = window["y"] + window["height"] / 2
    display_index = _display_index_for_point(cx, cy)

    frame = TargetFrame(
        window_id=int(window["id"]),
        display_index=display_index,
        origin_x=int(window["x"]),
        origin_y=int(window["y"]),
        logical_width=int(window["width"]),
        logical_height=int(window["height"]),
        owner_name=str(window.get("owner") or ""),
        window_title=str(window.get("title") or ""),
        mode="window",
    )
    logger.info(
        "Pinned target %s window_id=%s display=D%s bounds=%s,%s %sx%s",
        app_hint,
        frame.window_id,
        frame.display_index,
        frame.origin_x,
        frame.origin_y,
        frame.logical_width,
        frame.logical_height,
    )
    return frame


def refresh_target_frame(frame: TargetFrame, app_hint: str) -> TargetFrame:
    """Re-read window bounds if the window moved/resized — still no focus steal."""
    if sys.platform != "darwin":
        return frame

    window = find_target_window(app_hint=app_hint, prefer_frontmost=False)
    if not window:
        return frame
    if frame.window_id and window["id"] != frame.window_id:
        # Same app but different window — prefer original id if still visible
        for w in _list_onscreen_windows():
            if w["id"] == frame.window_id:
                window = w
                break

    cx = window["x"] + window["width"] / 2
    cy = window["y"] + window["height"] / 2
    frame.window_id = int(window["id"])
    frame.display_index = _display_index_for_point(cx, cy)
    frame.origin_x = int(window["x"])
    frame.origin_y = int(window["y"])
    frame.logical_width = int(window["width"])
    frame.logical_height = int(window["height"])
    frame.owner_name = str(window.get("owner") or "")
    frame.window_title = str(window.get("title") or "")
    return frame


def _capture_display_png(display_index: int) -> bytes:
    import subprocess
    from pathlib import Path

    from services.native_bridges.python_native_bridge import TEMP_DIR

    TEMP_DIR.mkdir(parents=True, exist_ok=True)
    out_path = TEMP_DIR / f"native_capture_d{display_index}.png"
    try:
        subprocess.run(
            ["screencapture", "-x", f"-D{display_index}", str(out_path)],
            capture_output=True,
            timeout=15,
            check=False,
        )
        if out_path.is_file():
            return out_path.read_bytes()
    except (subprocess.TimeoutExpired, OSError) as exc:
        logger.warning("display capture failed D%s: %s", display_index, exc)
    return b""


def _capture_window_png(window_id: int) -> bytes:
    import subprocess
    from pathlib import Path

    from services.native_bridges.python_native_bridge import TEMP_DIR

    if not window_id:
        return b""
    TEMP_DIR.mkdir(parents=True, exist_ok=True)
    out_path = TEMP_DIR / f"native_capture_w{window_id}.png"
    try:
        subprocess.run(
            ["screencapture", "-x", "-o", "-l", str(window_id), str(out_path)],
            capture_output=True,
            timeout=15,
            check=False,
        )
        if out_path.is_file():
            return out_path.read_bytes()
    except (subprocess.TimeoutExpired, OSError) as exc:
        logger.warning("window capture failed id=%s: %s", window_id, exc)
    return b""


def _png_size(png_bytes: bytes) -> Tuple[int, int]:
    if not png_bytes:
        return 0, 0
    try:
        import io

        from PIL import Image

        with Image.open(io.BytesIO(png_bytes)) as img:
            return img.size
    except Exception:
        return 0, 0


def capture_target_frame(target: TargetFrame) -> CaptureFrame:
    """Capture pinned target — window first (no focus needed), then its display."""
    displays = _list_displays()
    disp = next((d for d in displays if d["index"] == target.display_index), displays[0])

    png = b""
    mode = "window"
    origin_x = target.origin_x
    origin_y = target.origin_y
    logical_w = target.logical_width or int(disp["width"])
    logical_h = target.logical_height or int(disp["height"])

    if target.window_id:
        png = _capture_window_png(target.window_id)
    if not png:
        mode = "display"
        png = _capture_display_png(target.display_index)
        origin_x = int(disp["x"])
        origin_y = int(disp["y"])
        logical_w = int(disp["width"])
        logical_h = int(disp["height"])

    pixel_w, pixel_h = _png_size(png)
    scale = (pixel_w / logical_w) if logical_w else 1.0

    logger.info(
        "Captured %s D%s window_id=%s (%sx%s scale=%.2f)",
        mode,
        target.display_index,
        target.window_id,
        pixel_w,
        pixel_h,
        scale,
    )
    return CaptureFrame(
        png_bytes=png,
        origin_x=origin_x,
        origin_y=origin_y,
        pixel_width=pixel_w,
        pixel_height=pixel_h,
        logical_width=logical_w,
        logical_height=logical_h,
        scale_factor=scale,
        display_index=target.display_index,
        mode=mode,
        window_title=target.window_title,
        owner_name=target.owner_name,
        window_id=target.window_id,
    )


def capture_for_automation(*, app_hint: str = "", target: Optional[TargetFrame] = None) -> CaptureFrame:
    """Capture using pinned target frame, or resolve app location passively."""
    if sys.platform != "darwin":
        return CaptureFrame(png_bytes=b"")

    if target is not None:
        return capture_target_frame(refresh_target_frame(target, app_hint))

    resolved = resolve_target_frame(app_hint) if app_hint else None
    if resolved:
        return capture_target_frame(resolved)

    window = find_target_window(app_hint=app_hint, prefer_frontmost=True)
    displays = _list_displays()
    display_index = 1
    if window:
        cx = window["x"] + window["width"] / 2
        cy = window["y"] + window["height"] / 2
        display_index = _display_index_for_point(cx, cy)

    disp = next((d for d in displays if d["index"] == display_index), displays[0])
    png = _capture_display_png(display_index)
    pixel_w, pixel_h = _png_size(png)
    logical_w, logical_h = int(disp["width"]), int(disp["height"])
    scale = (pixel_w / logical_w) if logical_w else 1.0
    return CaptureFrame(
        png_bytes=png,
        origin_x=int(disp["x"]),
        origin_y=int(disp["y"]),
        pixel_width=pixel_w,
        pixel_height=pixel_h,
        logical_width=logical_w,
        logical_height=logical_h,
        scale_factor=scale,
        display_index=display_index,
        mode="display_fallback",
        owner_name=window.get("owner") if window else "",
    )


def global_click_coords(image_x: int, image_y: int, frame: CaptureFrame) -> Tuple[int, int]:
    scale = frame.scale_factor or 1.0
    gx = int(frame.origin_x + image_x / scale)
    gy = int(frame.origin_y + image_y / scale)
    return gx, gy
