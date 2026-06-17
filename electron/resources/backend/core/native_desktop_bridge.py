"""Abstract interface for native desktop automation bridges."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Protocol


@dataclass
class WindowInfo:
    id: str
    title: str
    app_id: Optional[str] = None
    bundle_id: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "app_id": self.app_id,
            "bundle_id": self.bundle_id,
        }


class NativeDesktopBridge(Protocol):
    name: str

    def is_available(self) -> bool: ...

    def list_windows(self) -> List[WindowInfo]: ...

    def focus_window(self, *, title_hint: str = "", bundle_id: str = "", app_id: str = "") -> bool: ...

    def capture_screen(self, *, region: Optional[Dict[str, int]] = None) -> bytes: ...

    def mouse_click(self, x: int, y: int, button: str = "left", double: bool = False) -> bool: ...

    def keyboard_type(self, text: str) -> bool: ...

    def keyboard_hotkey(self, keys: List[str]) -> bool: ...
