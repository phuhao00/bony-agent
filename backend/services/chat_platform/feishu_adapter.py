"""Chat Platform Bridge — Feishu / Lark 适配器。"""

from __future__ import annotations

import json
import os
import re
from typing import Any

from services.chat_platform.base_adapter import BasePlatformAdapter
from services.chat_platform.config_store import get_platform_config
from services.chat_platform.models import PlatformAttachment, PlatformMessage
from services import meal_feishu_api as fs
from services.meal_feishu_config import is_configured, load_config as load_feishu_config
from utils.logger import setup_logger

logger = setup_logger("chat_platform.feishu")


def _feishu_enabled() -> bool:
    env = os.getenv("CHAT_PLATFORM_FEISHU_ENABLED", "").lower()
    if env in ("0", "false", "no"):
        return False
    if env in ("1", "true", "yes"):
        return True
    return get_platform_config("feishu").get("enabled", True)


class FeishuPlatformAdapter(BasePlatformAdapter):
    """Feishu 平台适配器。

    复用现有 meal_feishu_api 的凭证和回复能力，不修改现有餐费/运维链路。
    """

    platform = "feishu"
    max_message_length = 4000

    @property
    def enabled(self) -> bool:
        return _feishu_enabled() and is_configured()

    def parse_event(self, event: Any) -> PlatformMessage | None:
        if not isinstance(event, dict):
            return None
        # 支持直接传入 event 体或外包一层 { event }
        body = event.get("event") or event
        if not isinstance(body, dict):
            return None

        msg = body.get("message") or {}
        sender = body.get("sender") or {}
        sender_id_obj = sender.get("sender_id") or {}
        sender_open_id = sender_id_obj.get("open_id") or ""
        chat_id = msg.get("chat_id") or ""
        chat_type = msg.get("chat_type") or ""
        message_id = msg.get("message_id") or ""
        msg_type = msg.get("message_type") or ""

        if not message_id or not sender_open_id:
            return None
        if msg_type != "text":
            # 当前只处理文本消息；图片等媒体可后续扩展
            return None

        try:
            content_obj = json.loads(msg.get("content") or "{}")
        except Exception:
            content_obj = {}

        raw_text = (content_obj.get("text") or "").strip()
        if not raw_text:
            return None

        # 去掉 @_user_xxx 的占位符
        text = re.sub(r"@_user_\d+\s*", "", raw_text).strip()

        mentions = msg.get("mentions") or []
        bot_oid = fs.get_bot_open_id()
        at_bot = any(
            (m.get("id") or {}).get("open_id") == bot_oid for m in mentions if bot_oid
        )
        if not at_bot:
            at_bot = bool(re.search(r"@_user_\d+", raw_text))

        sender_name = fs.get_user_name(sender_open_id, chat_id=chat_id)

        thread_id = chat_id if chat_type == "group" else f"p2p:{sender_open_id}"

        return PlatformMessage(
            platform=self.platform,
            thread_id=thread_id,
            message_id=message_id,
            sender_id=sender_open_id,
            sender_name=sender_name or "用户",
            text=text,
            chat_id=chat_id,
            chat_type="group" if chat_type == "group" else "private",
            mentions_bot=at_bot,
            is_bot=bool(bot_oid and sender_open_id == bot_oid),
            raw_event=body,
        )

    async def send_text(
        self,
        *,
        message: PlatformMessage,
        text: str,
        thread_id: str = "",
        reply_to_message_id: str = "",
    ) -> dict[str, Any]:
        target_message_id = reply_to_message_id or message.message_id
        try:
            ok = fs.reply_text(target_message_id, text)
            return {"success": ok, "platform": self.platform, "message_id": target_message_id}
        except Exception as exc:
            logger.exception(f"[chat_platform.feishu] send_text failed: {exc}")
            return {"success": False, "platform": self.platform, "error": str(exc)}


def get_feishu_adapter() -> FeishuPlatformAdapter:
    return FeishuPlatformAdapter()


def verify_feishu_signature(
    body_bytes: bytes,
    signature: str,
    timestamp: str,
    nonce: str = "",
) -> bool:
    """飞书事件签名校验（encrypt_key 存在时）。"""
    cfg = load_feishu_config()
    encrypt_key = cfg.get("encrypt_key") or os.getenv("FEISHU_ENCRYPT_KEY", "")
    if not encrypt_key:
        return True
    try:
        import hmac
        import hashlib

        # 飞书签名规范：timestamp + "\n" + nonce + "\n" + body
        basestring = f"{timestamp}\n{nonce}\n{body_bytes.decode('utf-8')}"
        expected = hmac.new(
            encrypt_key.encode("utf-8"),
            basestring.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        return hmac.compare_digest(expected, signature)
    except Exception as exc:
        logger.warning(f"[chat_platform.feishu] signature verify failed: {exc}")
        return False
