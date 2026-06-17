"""Chat Platform Bridge — 跨平台聊天机器人接入层。

受 Vercel Chat SDK 的 Thread/Message 抽象启发，将 Feishu / Discord 消息统一转发到
AI Media Agent 的 chat_service，实现 Agent 与外部 IM 平台的交互。
"""

from __future__ import annotations

from services.chat_platform.models import PlatformMessage, PlatformThread
from services.chat_platform.base_adapter import BasePlatformAdapter

__all__ = ["PlatformMessage", "PlatformThread", "BasePlatformAdapter"]
