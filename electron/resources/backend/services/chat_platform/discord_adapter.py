"""Chat Platform Bridge — Discord 适配器。"""

from __future__ import annotations

import asyncio
import os
from typing import Any, Callable

from services.chat_platform.base_adapter import BasePlatformAdapter
from services.chat_platform.config_store import get_platform_config
from services.chat_platform.models import PlatformMessage
from utils.logger import setup_logger

logger = setup_logger("chat_platform.discord")


def _discord_enabled() -> bool:
    env = os.getenv("CHAT_PLATFORM_DISCORD_ENABLED", "").lower()
    if env in ("0", "false", "no"):
        return False
    if env in ("1", "true", "yes"):
        return True
    return get_platform_config("discord").get("enabled", False)


def _discord_bot_token() -> str:
    return os.getenv("CHAT_PLATFORM_DISCORD_BOT_TOKEN", "") or get_platform_config("discord").get("bot_token", "")


class DiscordPlatformAdapter(BasePlatformAdapter):
    """Discord 平台适配器。

    使用 discord.py 的 Gateway 监听消息；回复时直接调用 discord.py API。
    """

    platform = "discord"
    max_message_length = 2000

    def __init__(self) -> None:
        super().__init__()
        self._client: Any | None = None
        self._on_message_cb: Callable[[PlatformMessage], Any] | None = None
        self._task: asyncio.Task | None = None

    @property
    def enabled(self) -> bool:
        return _discord_enabled() and bool(_discord_bot_token())

    def parse_event(self, event: Any) -> PlatformMessage | None:
        """将 discord.py Message 对象解析为 PlatformMessage。"""
        msg = event
        if msg is None or getattr(msg, "author", None) is None:
            return None
        if getattr(msg.author, "bot", False):
            return None

        text = str(getattr(msg, "content", "") or "").strip()
        if not text:
            return None

        channel = getattr(msg, "channel", None)
        guild = getattr(msg, "guild", None)
        try:
            import discord

            is_dm = isinstance(channel, discord.DMChannel)
        except Exception:
            is_dm = False

        # 群聊中只处理 @bot 或包含 bot 昵称的消息
        mentions_bot = False
        bot_user = getattr(self._client, "user", None)
        if bot_user:
            mentions_bot = bot_user.mentioned_in(msg) if hasattr(msg, "mentions") else False
            if not mentions_bot and bot_user.id in [m.id for m in getattr(msg, "mentions", [])]:
                mentions_bot = True

        if not is_dm and not mentions_bot:
            return None

        thread_id = str(getattr(channel, "id", "") or "")
        message_id = str(getattr(msg, "id", "") or "")
        sender_id = str(getattr(msg.author, "id", "") or "")
        sender_name = str(getattr(msg.author, "display_name", "") or getattr(msg.author, "name", "用户"))

        return PlatformMessage(
            platform=self.platform,
            thread_id=thread_id,
            message_id=message_id,
            sender_id=sender_id,
            sender_name=sender_name,
            text=text,
            chat_id=thread_id,
            chat_type="private" if is_dm else "group",
            mentions_bot=mentions_bot,
            is_bot=False,
            raw_event={"channel_id": thread_id, "guild_id": str(getattr(guild, "id", "") or "")},
        )

    async def send_text(
        self,
        *,
        message: PlatformMessage,
        text: str,
        thread_id: str = "",
        reply_to_message_id: str = "",
    ) -> dict[str, Any]:
        if self._client is None:
            return {"success": False, "platform": self.platform, "error": "discord client not ready"}
        try:
            channel_id = int(thread_id or message.thread_id)
            channel = self._client.get_channel(channel_id)
            if channel is None:
                return {"success": False, "platform": self.platform, "error": f"channel not found: {channel_id}"}

            kwargs: dict[str, Any] = {}
            if reply_to_message_id:
                try:
                    kwargs["reference"] = await channel.fetch_message(int(reply_to_message_id))
                except Exception:
                    pass

            sent = await channel.send(text[: self.max_message_length], **kwargs)
            return {
                "success": True,
                "platform": self.platform,
                "message_id": str(getattr(sent, "id", "")),
            }
        except Exception as exc:
            logger.exception(f"[chat_platform.discord] send_text failed: {exc}")
            return {"success": False, "platform": self.platform, "error": str(exc)}

    def start(self, on_message: Callable[[PlatformMessage], Any]) -> None:
        """启动 Discord Gateway 客户端。"""
        if not self.enabled:
            logger.info("[chat_platform.discord] disabled, not starting")
            return
        self._on_message_cb = on_message
        try:
            import discord
        except ImportError as exc:
            logger.error(f"[chat_platform.discord] discord.py not installed: {exc}")
            return

        intents = discord.Intents.default()
        intents.message_content = True
        intents.dm_messages = True

        client = discord.Client(intents=intents)

        @client.event
        async def on_ready() -> None:
            logger.info(f"[chat_platform.discord] logged in as {client.user}")

        @client.event
        async def on_message(message: Any) -> None:
            platform_msg = self.parse_event(message)
            if platform_msg is None:
                return
            if self._on_message_cb:
                try:
                    if asyncio.iscoroutinefunction(self._on_message_cb):
                        await self._on_message_cb(platform_msg)
                    else:
                        self._on_message_cb(platform_msg)
                except Exception as exc:
                    logger.exception(f"[chat_platform.discord] on_message failed: {exc}")

        self._client = client

        async def _runner() -> None:
            await client.start(_discord_bot_token())

        try:
            loop = asyncio.get_running_loop()
            self._task = loop.create_task(_runner())
        except RuntimeError:
            asyncio.run(_runner())

    async def stop(self) -> None:
        if self._client:
            await self._client.close()
        if self._task:
            self._task.cancel()


def get_discord_adapter() -> DiscordPlatformAdapter:
    return DiscordPlatformAdapter()
