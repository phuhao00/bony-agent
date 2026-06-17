"""Video generation + publish routing helpers (no heavy imports)."""

from __future__ import annotations

PLATFORM_ALIASES = {
    "xiaohongshu": ["小红书", "xiaohongshu", "xhs"],
    "douyin": ["抖音", "douyin", "tiktok"],
    "bilibili": ["哔哩哔哩", "b站", "bilibili", "B站"],
    "youtube": ["youtube", "YouTube"],
    "twitter": ["twitter", "Twitter", "x.com", "X"],
    "weibo": ["weibo", "微博"],
}


def detect_publish_platform(text: str) -> str:
    for platform, aliases in PLATFORM_ALIASES.items():
        if any(alias in text for alias in aliases):
            return platform
    return ""


def is_video_generation_publish_request(text: str) -> bool:
    has_video = any(k in text for k in ["视频", "video", "动画", "生成视频", "做视频", "制作视频"])
    has_publish = any(k in text for k in ["发布", "发到", "发不到", "上传", "投稿"])
    return has_video and has_publish and bool(detect_publish_platform(text))
