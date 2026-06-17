"""Tests for chat service input → messages normalization."""

from __future__ import annotations

from agents.chat_request import ChatRequest
from agents.chat_service import _resolve_chat_messages


def test_resolve_chat_messages_from_input_only():
    req = ChatRequest(input="帮我做竞品分析", agent_id="product_manager_agent")
    messages = _resolve_chat_messages(req)
    assert len(messages) == 1
    assert messages[0].role == "user"
    assert messages[0].content == "帮我做竞品分析"


def test_resolve_chat_messages_prefers_existing_messages():
    from agents.chat_request import ChatMessage

    req = ChatRequest(
        input="ignored",
        messages=[ChatMessage(role="user", content="已有消息")],
    )
    messages = _resolve_chat_messages(req)
    assert len(messages) == 1
    assert messages[0].content == "已有消息"
