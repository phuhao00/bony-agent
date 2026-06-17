"""Chat Platform Bridge — 将平台消息转发给 AI Agent。"""

from __future__ import annotations

import asyncio
import os
import uuid
from typing import Any

from agents.chat_request import ChatRequest, ChatPreferences, WorkspaceContext
from agents.chat_service import invoke_agent_chat, create_chat_trace, after_chat_turn
from services.chat_platform.config_store import get_common_config
from services.chat_platform.models import PlatformMessage
from services.chat_platform.session_store import session_store
from utils.logger import setup_logger

logger = setup_logger("chat_platform.agent_bridge")


def _default_agent_id() -> str:
    return os.getenv("CHAT_PLATFORM_DEFAULT_AGENT_ID", "") or get_common_config().get("default_agent_id", "media_agent")


def _rate_limit_config() -> tuple[bool, int, int]:
    common = get_common_config()
    env_enabled = os.getenv("CHAT_PLATFORM_RATE_LIMIT_ENABLED", "").lower()
    enabled = env_enabled in ("1", "true", "yes") if env_enabled else common.get("rate_limit_enabled", True)
    per_sender = int(os.getenv("CHAT_PLATFORM_RATE_LIMIT_PER_SENDER") or common.get("rate_limit_per_sender", 20))
    window = int(os.getenv("CHAT_PLATFORM_RATE_LIMIT_WINDOW") or common.get("rate_limit_window", 60))
    return enabled, per_sender, window


def _should_handle(message: PlatformMessage) -> bool:
    """判断消息是否应该交给 Agent 处理。"""
    if message.is_bot:
        return False
    if not message.text.strip():
        return False
    # 群聊中只处理 @bot 或明确提及 bot 的消息
    if message.chat_type == "group" and not message.mentions_bot:
        return False
    return True


def _build_chat_request(message: PlatformMessage) -> ChatRequest:
    """将平台消息组装为 ChatRequest。"""
    workspace_ctx = WorkspaceContext(
        source_message_id=message.message_id,
        trace_id=str(uuid.uuid4()),
    )
    return ChatRequest(
        input=message.text.strip(),
        agent_id=_default_agent_id(),
        mode="multi",
        graph_hint="auto",
        thread_id=message.session_id,
        preferences=ChatPreferences(),
        workspace_context=workspace_ctx,
        stream=False,
    )


async def handle_platform_message(
    message: PlatformMessage,
    *,
    adapter: Any,
) -> dict[str, Any]:
    """处理平台消息：限流、调用 Agent、发送回复。"""
    result: dict[str, Any] = {
        "handled": False,
        "responded": False,
        "error": "",
        "response": "",
        "session_id": message.session_id,
    }

    if not _should_handle(message):
        result["error"] = "ignored"
        return result

    session = session_store.get_or_create(
        message.session_id,
        platform=message.platform,
        thread_id=message.thread_id,
        sender_id=message.sender_id,
    )

    rate_limit_enabled, rate_limit_per_sender, rate_limit_window = _rate_limit_config()
    rate_key = f"{message.platform}:{message.sender_id}"
    if rate_limit_enabled and not session_store.check_rate_limit(
        rate_key, max_calls=rate_limit_per_sender, window_sec=rate_limit_window
    ):
        logger.warning(f"[chat_platform] rate limit hit for {rate_key}")
        result["error"] = "rate_limited"
        await adapter.send_text(
            message=message,
            text="请求太频繁，请稍后再试。",
            thread_id=message.thread_id,
            reply_to_message_id=message.message_id,
        )
        return result

    req = _build_chat_request(message)
    req.agent_id = _default_agent_id()
    trace_id = create_chat_trace(req)
    req.workspace_context.trace_id = trace_id

    try:
        agent_response = await invoke_agent_chat(req, trace_id=trace_id)
    except Exception as exc:
        logger.exception(f"[chat_platform] agent invoke failed: {exc}")
        result["error"] = f"agent_error: {exc}"
        await adapter.send_text(
            message=message,
            text="Agent 处理失败，请稍后重试。",
            thread_id=message.thread_id,
            reply_to_message_id=message.message_id,
        )
        return result

    response_text = ""
    if isinstance(agent_response, dict):
        response_text = str(agent_response.get("response") or agent_response.get("output") or "")
    else:
        response_text = str(agent_response or "")

    if not response_text.strip():
        result["error"] = "empty_response"
        return result

    result["response"] = response_text
    result["handled"] = True

    # 保存记忆
    try:
        after_chat_turn(req, response_text, trace_id=trace_id)
    except Exception as exc:
        logger.warning(f"[chat_platform] after_chat_turn failed: {exc}")

    # 按平台限制分片发送
    max_length = getattr(adapter, "max_message_length", 2000)
    chunks = adapter.chunk_text(response_text, max_length=max_length)
    sent_count = 0
    for chunk in chunks:
        try:
            await adapter.send_text(
                message=message,
                text=chunk,
                thread_id=message.thread_id,
                reply_to_message_id=message.message_id if sent_count == 0 else "",
            )
            sent_count += 1
        except Exception as exc:
            logger.exception(f"[chat_platform] send_text failed: {exc}")
            result["error"] = f"send_error: {exc}"
            break

    result["responded"] = sent_count > 0
    result["chunks"] = sent_count
    return result


# 同步包装，方便非 async 上下文（如 threading.Thread）调用
def handle_platform_message_sync(message: PlatformMessage, *, adapter: Any) -> dict[str, Any]:
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(handle_platform_message(message, adapter=adapter))
    return loop.run_until_complete(handle_platform_message(message, adapter=adapter))
