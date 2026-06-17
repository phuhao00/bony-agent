"""Chat Platform Bridge — 平台适配器基类。"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from services.chat_platform.models import PlatformMessage


class BasePlatformAdapter(ABC):
    """平台适配器接口。

    设计目标与 Vercel Chat SDK 的 Adapter 概念对齐：
    - 将平台原始事件解析为 PlatformMessage
    - 将 Agent 的文本回复发回平台
    """

    @property
    @abstractmethod
    def platform(self) -> str:
        """平台标识，如 feishu / discord。"""
        ...

    @property
    def enabled(self) -> bool:
        """是否启用该平台的 AI 聊天桥接。子类可覆盖。"""
        return True

    @abstractmethod
    def parse_event(self, event: Any) -> PlatformMessage | None:
        """将平台原始事件解析为 PlatformMessage；无法处理时返回 None。"""
        ...

    @abstractmethod
    async def send_text(
        self,
        *,
        message: PlatformMessage,
        text: str,
        thread_id: str = "",
        reply_to_message_id: str = "",
    ) -> dict[str, Any]:
        """向平台发送文本回复。"""
        ...

    async def send_markdown(
        self,
        *,
        message: PlatformMessage,
        text: str,
        thread_id: str = "",
        reply_to_message_id: str = "",
    ) -> dict[str, Any]:
        """发送 Markdown 格式内容；默认降级为 send_text。"""
        return await self.send_text(
            message=message,
            text=text,
            thread_id=thread_id,
            reply_to_message_id=reply_to_message_id,
        )

    def chunk_text(self, text: str, max_length: int = 2000) -> list[str]:
        """将长文本按长度拆分成多条消息。"""
        if len(text) <= max_length:
            return [text]
        chunks: list[str] = []
        start = 0
        while start < len(text):
            end = start + max_length
            # 优先在换行处截断
            if end < len(text):
                nl = text.rfind("\n", start, end)
                if nl > start:
                    end = nl + 1
            chunks.append(text[start:end])
            start = end
        return chunks
