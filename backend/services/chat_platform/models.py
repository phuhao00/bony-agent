"""Chat Platform Bridge — 跨平台消息模型。"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional


@dataclass
class PlatformAttachment:
    """平台附件（图片、文件等）的最小抽象。"""

    type: str  # image, file, video, etc.
    url: str = ""
    file_key: str = ""
    name: str = ""
    size: int = 0
    local_path: str = ""
    mime_type: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class PlatformMessage:
    """一条跨平台聊天消息。"""

    platform: str  # feishu | discord
    thread_id: str
    message_id: str
    sender_id: str
    sender_name: str
    text: str
    chat_id: str = ""  # 群/频道 ID
    chat_type: str = "private"  # private | group | channel
    mentions_bot: bool = False
    is_bot: bool = False
    attachments: list[PlatformAttachment] = field(default_factory=list)
    raw_event: dict[str, Any] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)

    @property
    def session_id(self) -> str:
        """返回全局唯一的会话 ID，用于 Agent thread_id。"""
        return f"{self.platform}:{self.thread_id}"


@dataclass
class PlatformThread:
    """一个跨平台对话线程（类似 Vercel Chat SDK 的 Thread）。"""

    platform: str
    thread_id: str
    display_name: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)

    @property
    def session_id(self) -> str:
        return f"{self.platform}:{self.thread_id}"
