"""Python-native desktop bridge (dev mode)."""

from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional

from core.native_desktop_bridge import NativeDesktopBridge, WindowInfo
from utils.logger import setup_logger

logger = setup_logger("python_native_bridge")

PROJECT_ROOT = Path(__file__).resolve().parents[3]
TEMP_DIR = PROJECT_ROOT / "storage" / "temp"

_APP_FOCUS_ALIASES: Dict[str, List[str]] = {
    "lark": ["Lark", "Feishu", "飞书"],
    "feishu": ["Feishu", "Lark", "飞书"],
    "飞书": ["飞书", "Lark", "Feishu"],
}


def _focus_name_candidates(target: str) -> List[str]:
    key = (target or "").strip().lower()
    names: List[str] = []
    if key in _APP_FOCUS_ALIASES:
        names.extend(_APP_FOCUS_ALIASES[key])
    if target and target not in names:
        names.append(target)
    # preserve order, dedupe
    seen: set[str] = set()
    out: List[str] = []
    for n in names:
        if n and n not in seen:
            seen.add(n)
            out.append(n)
    return out


class PythonNativeBridge:
    name = "python"

    def is_available(self) -> bool:
        return sys.platform in {"darwin", "win32", "linux"}

    def list_windows(self) -> List[WindowInfo]:
        if sys.platform == "darwin":
            return self._list_windows_macos()
        return []

    def _list_windows_macos(self) -> List[WindowInfo]:
        script = """
        tell application "System Events"
            set out to ""
            repeat with p in (every process whose background only is false)
                try
                    set out to out & name of p & linefeed
                end try
            end repeat
            return out
        end tell
        """
        try:
            completed = subprocess.run(
                ["osascript", "-e", script],
                capture_output=True,
                text=True,
                timeout=10,
                check=False,
            )
            windows: List[WindowInfo] = []
            for idx, line in enumerate((completed.stdout or "").splitlines()):
                name = line.strip()
                if name:
                    windows.append(WindowInfo(id=str(idx), title=name, app_id=name))
            return windows
        except (subprocess.TimeoutExpired, OSError) as exc:
            logger.warning("list_windows failed: %s", exc)
            return []

    def launch_app(self, app_id: str) -> tuple[bool, str]:
        """Launch macOS app via `open -a` (does not steal focus repeatedly)."""
        target = (app_id or "").strip()
        if not target or sys.platform != "darwin":
            return False, ""
        for candidate in _focus_name_candidates(target):
            try:
                completed = subprocess.run(
                    ["open", "-a", candidate],
                    capture_output=True,
                    text=True,
                    timeout=15,
                    check=False,
                )
                if completed.returncode == 0:
                    logger.info("launch_app: opened %s", candidate)
                    return True, candidate
            except (subprocess.TimeoutExpired, OSError) as exc:
                logger.debug("launch_app %s failed: %s", candidate, exc)
        return False, ""

    def show_app(self, app_id: str) -> tuple[bool, str]:
        """Activate app, bring to front, and un-minimize all windows."""
        target = (app_id or "").strip()
        if not target or sys.platform != "darwin":
            return False, ""
        for candidate in _focus_name_candidates(target):
            script = f'''
tell application "{candidate}" to activate
delay 0.4
tell application "System Events"
  if exists process "{candidate}" then
    tell process "{candidate}"
      set frontmost to true
      repeat with w in windows
        try
          set value of attribute "AXMinimized" of w to false
        end try
      end repeat
      return "ok"
    end tell
  end if
end tell
return "missing"
'''
            try:
                completed = subprocess.run(
                    ["osascript", "-e", script],
                    capture_output=True,
                    text=True,
                    timeout=20,
                    check=False,
                )
                if "ok" in (completed.stdout or ""):
                    logger.info("show_app: raised %s", candidate)
                    return True, candidate
            except (subprocess.TimeoutExpired, OSError) as exc:
                logger.debug("show_app %s failed: %s", candidate, exc)
        for candidate in _focus_name_candidates(target):
            if self.focus_window(app_id=candidate):
                return True, candidate
        return False, ""

    def focus_window(self, *, title_hint: str = "", bundle_id: str = "", app_id: str = "") -> bool:
        target = app_id or title_hint or bundle_id
        if not target:
            return False
        if sys.platform == "darwin":
            for candidate in _focus_name_candidates(target):
                script = f'tell application "{candidate}" to activate'
                try:
                    completed = subprocess.run(
                        ["osascript", "-e", script],
                        capture_output=True,
                        text=True,
                        timeout=10,
                        check=False,
                    )
                    if completed.returncode == 0:
                        return True
                except (subprocess.TimeoutExpired, OSError):
                    continue
            return False
        return False

    def foreground_app_name(self) -> str:
        if sys.platform != "darwin":
            return ""
        name = self._foreground_via_osascript()
        if name:
            return name
        return self._foreground_via_lsappinfo()

    @staticmethod
    def _foreground_via_osascript() -> str:
        script = (
            'tell application "System Events" to get name of '
            "first application process whose frontmost is true"
        )
        try:
            completed = subprocess.run(
                ["osascript", "-e", script],
                capture_output=True,
                text=True,
                timeout=5,
                check=False,
            )
            if completed.returncode == 0:
                return (completed.stdout or "").strip()
        except (subprocess.TimeoutExpired, OSError):
            pass
        return ""

    @staticmethod
    def _foreground_via_lsappinfo() -> str:
        """Launch Services frontmost app — works when System Events lacks Accessibility."""
        try:
            front = subprocess.run(
                ["lsappinfo", "front"],
                capture_output=True,
                text=True,
                timeout=3,
                check=False,
            )
            asn = (front.stdout or "").strip().splitlines()[0].strip()
            if not asn.startswith("ASN:"):
                return ""
            info = subprocess.run(
                ["lsappinfo", "info", "-only", "name", asn],
                capture_output=True,
                text=True,
                timeout=3,
                check=False,
            )
            for line in (info.stdout or "").splitlines():
                line = line.strip()
                if line.startswith('"LSDisplayName"='):
                    return line.split("=", 1)[1].strip().strip('"')
        except (subprocess.TimeoutExpired, OSError, FileNotFoundError):
            pass
        return ""

    def app_is_running(self, app_hint: str) -> bool:
        """Best-effort check that target app has a running process."""
        hint = (app_hint or "").strip().lower()
        if not hint:
            return False
        aliases = _APP_FOCUS_ALIASES.get(hint, [app_hint])
        tokens = {hint, *[a.lower() for a in aliases if a]}
        for win in self.list_windows():
            title = (win.title or "").lower()
            if any(t in title or title in t for t in tokens if t):
                return True
        if sys.platform == "darwin":
            try:
                for token in tokens:
                    if not token:
                        continue
                    completed = subprocess.run(
                        ["pgrep", "-i", token],
                        capture_output=True,
                        text=True,
                        timeout=3,
                        check=False,
                    )
                    if completed.returncode == 0 and (completed.stdout or "").strip():
                        return True
            except (subprocess.TimeoutExpired, OSError):
                pass
        return False

    def capture_screen(self, *, region: Optional[Dict[str, int]] = None) -> bytes:
        TEMP_DIR.mkdir(parents=True, exist_ok=True)
        out_path = TEMP_DIR / "native_capture.png"
        if sys.platform == "darwin":
            cmd = ["screencapture", "-x", str(out_path)]
            if region:
                x = region.get("x", 0)
                y = region.get("y", 0)
                w = region.get("width", 0)
                h = region.get("height", 0)
                cmd = ["screencapture", "-x", "-R", f"{x},{y},{w},{h}", str(out_path)]
            try:
                subprocess.run(cmd, capture_output=True, timeout=15, check=False)
                if out_path.is_file():
                    return out_path.read_bytes()
            except (subprocess.TimeoutExpired, OSError) as exc:
                logger.warning("capture_screen failed: %s", exc)
        return b""

    def mouse_click(self, x: int, y: int, button: str = "left", double: bool = False) -> bool:
        try:
            import pyautogui  # type: ignore

            pyautogui.click(x=x, y=y, button=button, clicks=2 if double else 1)
            return True
        except Exception as exc:
            logger.debug("mouse_click unavailable: %s", exc)
            if sys.platform == "darwin":
                return self._cliclick(f"c:{x},{y}")
            return False

    def keyboard_type(self, text: str) -> bool:
        try:
            import pyautogui  # type: ignore

            pyautogui.write(text, interval=0.02)
            return True
        except Exception as exc:
            logger.debug("keyboard_type unavailable: %s", exc)
            return False

    def keyboard_hotkey(self, keys: List[str]) -> bool:
        if not keys:
            return False
        try:
            import pyautogui  # type: ignore

            pyautogui.hotkey(*keys)
            return True
        except Exception as exc:
            logger.debug("keyboard_hotkey pyautogui unavailable: %s", exc)
        if sys.platform == "darwin":
            return self._hotkey_macos(keys)
        return False

    @staticmethod
    def _hotkey_macos(keys: List[str]) -> bool:
        modifiers: List[str] = []
        key_char: Optional[str] = None
        for raw in keys:
            token = str(raw or "").lower().strip()
            if token in {"command", "cmd", "meta"}:
                modifiers.append("command down")
            elif token == "shift":
                modifiers.append("shift down")
            elif token in {"control", "ctrl"}:
                modifiers.append("control down")
            elif token in {"option", "alt"}:
                modifiers.append("option down")
            elif len(token) == 1:
                key_char = token
            elif token in {"enter", "return"}:
                key_char = "\r"
            elif token == "tab":
                key_char = "\t"
            elif token == "escape":
                key_char = "\u001b"
        if not key_char:
            return False
        mod_clause = ""
        if modifiers:
            mod_clause = f" using {{{', '.join(modifiers)}}}"
        script = f'tell application "System Events" to keystroke "{key_char}"{mod_clause}'
        try:
            completed = subprocess.run(
                ["osascript", "-e", script],
                capture_output=True,
                text=True,
                timeout=10,
                check=False,
            )
            if completed.returncode == 0:
                return True
            err = (completed.stderr or completed.stdout or "").strip()
            if err:
                logger.warning("keyboard_hotkey osascript failed: %s", err[:200])
        except (subprocess.TimeoutExpired, OSError) as exc:
            logger.warning("keyboard_hotkey osascript error: %s", exc)
        return False

    @staticmethod
    def _cliclick(action: str) -> bool:
        try:
            completed = subprocess.run(
                ["cliclick", action],
                capture_output=True,
                timeout=10,
                check=False,
            )
            return completed.returncode == 0
        except (subprocess.TimeoutExpired, OSError, FileNotFoundError):
            return False
