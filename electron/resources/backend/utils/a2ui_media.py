"""A2UI media sentinel lines for chat UI (mirrors web/lib/a2uiMedia.ts)."""

from __future__ import annotations

import re
from typing import List, Literal

RE_STORAGE_IMAGE = re.compile(
    r"storage[/\\]outputs[/\\]([^\s\)\n'\"]+\.(?:jpg|jpeg|png|gif|webp))",
    re.IGNORECASE,
)
RE_STORAGE_VIDEO = re.compile(
    r"storage[/\\]outputs[/\\]([^\s\)\n'\"]+\.(?:mp4|webm|mov|avi))",
    re.IGNORECASE,
)
RE_BACKEND_MEDIA = re.compile(
    r"/media/([^\s\"'>\n]+\.(?:jpg|jpeg|png|gif|webp|mp4|webm|mov|avi))",
    re.IGNORECASE,
)
RE_HTTP_IMAGE = re.compile(
    r"https?://[^\s\"'>\n]+\.(?:jpg|jpeg|png|gif|webp)(?:\?[^\s\"'>\n]*)?",
    re.IGNORECASE,
)
RE_HTTP_VIDEO = re.compile(
    r"https?://[^\s\"'>\n]+\.(?:mp4|webm|mov|avi)(?:\?[^\s\"'>\n]*)?",
    re.IGNORECASE,
)


def build_a2ui_media_lines(text: str) -> List[str]:
    """Extract displayable media URLs from tool output text."""
    if not text or not isinstance(text, str):
        return []

    out: List[str] = []
    seen: set[str] = set()

    def add(kind: Literal["image", "video"], url: str) -> None:
        line = f"A2UI_MEDIA:{kind}:{url}"
        if line in seen:
            return
        seen.add(line)
        out.append(line)

    for m in RE_STORAGE_IMAGE.finditer(text):
        add("image", f"/api/media/{m.group(1).replace(chr(92), '/')}")
    for m in RE_STORAGE_VIDEO.finditer(text):
        add("video", f"/api/media/{m.group(1).replace(chr(92), '/')}")
    for m in RE_BACKEND_MEDIA.finditer(text):
        fn = m.group(1).replace("\\", "/")
        kind: Literal["image", "video"] = (
            "video" if re.search(r"\.(mp4|webm|mov|avi)$", fn, re.I) else "image"
        )
        add(kind, f"/api/media/{fn}")
    for m in RE_HTTP_IMAGE.finditer(text):
        add("image", m.group(0))
    for m in RE_HTTP_VIDEO.finditer(text):
        add("video", m.group(0))

    return out
