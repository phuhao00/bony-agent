"""Resolve media paths for publishing.

Publishing requests can arrive from both React UI and Agent tool calls. When a
generation result is included in the content, that result is the authoritative
source for the media to publish and should beat stale UI/LLM-provided media_urls.
"""

import os
import re
from typing import Any, Dict, List, Optional

from utils.generation_history import get_generation_history


VIDEO_EXTENSIONS = (".mp4", ".webm", ".mov", ".avi")
IMAGE_EXTENSIONS = (".jpg", ".jpeg", ".png", ".gif", ".webp")
MEDIA_EXTENSIONS = VIDEO_EXTENSIONS + IMAGE_EXTENSIONS

PLACEHOLDER_PATTERNS = re.compile(
    r"^\s*(\[.*\]|<.*>|替换|placeholder|video_url|image_url|url_here|your_url|xxx)\s*$",
    re.IGNORECASE,
)


def is_video_url(url: str) -> bool:
    return _clean_url(url).lower().endswith(VIDEO_EXTENSIONS)


def is_image_url(url: str) -> bool:
    return _clean_url(url).lower().endswith(IMAGE_EXTENSIONS)


def _clean_url(url: str) -> str:
    return str(url or "").split("?")[0].rstrip(".,;:，。；：!！?)）]")


def _append_unique(items: List[str], item: Optional[str]) -> None:
    if item and item not in items:
        items.append(item)


def _local_output_path(filename: str, outputs_dir: str) -> Optional[str]:
    path = os.path.join(outputs_dir, os.path.basename(filename).split("?")[0])
    return path if os.path.exists(path) else None


def _resolve_media_url(url: str, outputs_dir: str, root_dir: str) -> Optional[str]:
    value = str(url or "").strip()
    if not value or PLACEHOLDER_PATTERNS.match(value):
        return None

    clean = _clean_url(value)
    if os.path.isabs(clean) and os.path.exists(clean):
        return clean
    if value.startswith("/api/media/"):
        return _local_output_path(value[len("/api/media/"):], outputs_dir)
    if "storage" in value and "outputs" in value:
        candidate = value.split("?")[0].lstrip("./")
        if os.path.isabs(candidate) and os.path.exists(candidate):
            return candidate
        path = os.path.join(root_dir, candidate)
        if os.path.exists(path):
            return path
        return _local_output_path(os.path.basename(candidate), outputs_dir)
    if value.startswith("http"):
        return value
    return None


def extract_media_from_text(text: str, outputs_dir: str, media_type: Optional[str] = None) -> List[str]:
    """Extract media references from generated text, preserving priority order."""
    found: List[str] = []
    value = text or ""

    extensions = VIDEO_EXTENSIONS if media_type == "video" else IMAGE_EXTENSIONS if media_type == "image" else MEDIA_EXTENSIONS
    ext_pattern = "|".join(re.escape(ext.lstrip(".")) for ext in extensions)

    for match in re.finditer(r"直接显示[：:]+\s*(\S+)", value):
        candidate = match.group(1).strip()
        clean = _clean_url(candidate)
        if clean.lower().endswith(extensions):
            if os.path.isabs(clean) and os.path.exists(clean):
                _append_unique(found, clean)
            else:
                _append_unique(found, _local_output_path(os.path.basename(clean), outputs_dir))

    absolute_re = re.compile(
        rf"(/[^\s<>\"'\)\]]*storage[/\\]outputs[/\\][^\s<>\"'\)\]]+\.(?:{ext_pattern}))",
        re.IGNORECASE,
    )
    for match in absolute_re.finditer(value):
        candidate = _clean_url(match.group(1))
        if os.path.exists(candidate):
            _append_unique(found, candidate)

    local_re = re.compile(
        rf"(?:storage[/\\]outputs[/\\]|/api/media/)([^\s<>\"'\)\]]+\.(?:{ext_pattern})(?:\?[^\s<>\"'\)\]]*)?)",
        re.IGNORECASE,
    )
    for match in local_re.finditer(value):
        _append_unique(found, _local_output_path(match.group(1), outputs_dir))

    http_re = re.compile(
        rf"https?://[^\s<>\"']+?\.(?:{ext_pattern})(?:\?[^\s<>\"'\)\]]*)?",
        re.IGNORECASE,
    )
    for match in http_re.finditer(value):
        _append_unique(found, match.group(0).rstrip(".,;:，。；：!！"))

    return found


def _extract_media_path_from_record(record: Dict[str, Any], outputs_dir: str, media_type: str) -> Optional[str]:
    result = str(record.get("result") or "")
    metadata = record.get("metadata") or {}

    extracted = extract_media_from_text(result, outputs_dir, media_type=media_type)
    if extracted:
        return extracted[0]

    if os.path.isabs(result) and os.path.exists(result):
        return result

    url = metadata.get("url")
    if isinstance(url, str) and url.startswith("http"):
        return url

    return None


def get_latest_generated_media(record_type: str, outputs_dir: str) -> Optional[str]:
    history = get_generation_history(record_type=record_type, limit=10)
    for record in history:
        resolved = _extract_media_path_from_record(record, outputs_dir, record_type)
        if resolved:
            return resolved
    return None


def normalize_publish_media(
    media_urls: Optional[List[str]],
    content: str,
    content_type: str,
    outputs_dir: str,
    logger: Optional[Any] = None,
) -> List[str]:
    """Return publish media with current generation text taking priority."""
    root_dir = os.path.abspath(os.path.join(outputs_dir, "..", ".."))
    requested_type = (content_type or "mixed").lower()
    wants_video = requested_type in {"video", "mixed"}
    wants_image = requested_type in {"image", "mixed"}

    content_videos = extract_media_from_text(content or "", outputs_dir, media_type="video")
    if wants_video and content_videos:
        if logger:
            logger.warning(f"[media_resolver] 使用正文中的当前视频覆盖 media_urls: {content_videos}")
        return content_videos

    resolved: List[str] = []
    for url in media_urls or []:
        item = _resolve_media_url(url, outputs_dir, root_dir)
        if item:
            _append_unique(resolved, item)
        elif logger:
            logger.warning(f"[media_resolver] Cannot resolve media path {url!r}")

    if wants_video and any(is_video_url(item) for item in resolved):
        return resolved

    if wants_image and not wants_video:
        content_images = extract_media_from_text(content or "", outputs_dir, media_type="image")
        if content_images:
            return content_images
        if resolved:
            return resolved

    if wants_video:
        latest_video = get_latest_generated_media("video", outputs_dir)
        if latest_video:
            if logger:
                logger.warning(f"[media_resolver] 未收到可用视频，回退到最近生成记录: {latest_video}")
            return [latest_video]

    return resolved