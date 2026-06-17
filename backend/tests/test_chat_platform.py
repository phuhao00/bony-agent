"""Chat Platform Bridge 基础单元测试。"""

from __future__ import annotations

import pytest

from services.chat_platform.models import PlatformMessage
from services.chat_platform.base_adapter import BasePlatformAdapter
from services.chat_platform.session_store import SessionStore
from services.chat_platform.agent_bridge import _should_handle, _build_chat_request


class DummyAdapter(BasePlatformAdapter):
    platform = "dummy"

    def parse_event(self, event):
        return None

    async def send_text(self, *, message, text, thread_id="", reply_to_message_id=""):
        return {"success": True}


def test_should_handle_private_message():
    msg = PlatformMessage(
        platform="dummy",
        thread_id="t1",
        message_id="m1",
        sender_id="u1",
        sender_name="User",
        text="hello",
        chat_type="private",
        mentions_bot=False,
        is_bot=False,
    )
    assert _should_handle(msg) is True


def test_should_ignore_bot_message():
    msg = PlatformMessage(
        platform="dummy",
        thread_id="t1",
        message_id="m1",
        sender_id="bot1",
        sender_name="Bot",
        text="hello",
        chat_type="private",
        mentions_bot=False,
        is_bot=True,
    )
    assert _should_handle(msg) is False


def test_should_ignore_group_without_mention():
    msg = PlatformMessage(
        platform="dummy",
        thread_id="t1",
        message_id="m1",
        sender_id="u1",
        sender_name="User",
        text="hello",
        chat_type="group",
        mentions_bot=False,
        is_bot=False,
    )
    assert _should_handle(msg) is False


def test_build_chat_request_sets_session_id():
    msg = PlatformMessage(
        platform="dummy",
        thread_id="t1",
        message_id="m1",
        sender_id="u1",
        sender_name="User",
        text="hello",
    )
    req = _build_chat_request(msg)
    assert req.input == "hello"
    assert req.thread_id == "dummy:t1"


def test_chunk_text():
    adapter = DummyAdapter()
    text = "a" * 5000
    chunks = adapter.chunk_text(text, max_length=2000)
    assert len(chunks) == 3
    assert all(len(c) <= 2000 for c in chunks)


def test_rate_limit():
    store = SessionStore()
    key = "test:sender"
    for _ in range(10):
        assert store.check_rate_limit(key, max_calls=10, window_sec=60) is True
    assert store.check_rate_limit(key, max_calls=10, window_sec=60) is False


def test_session_store_get_or_create():
    store = SessionStore()
    s = store.get_or_create("p:t1", platform="p", thread_id="t1", sender_id="u1")
    assert s["platform"] == "p"
    assert s["message_count"] == 1
    s2 = store.get_or_create("p:t1")
    assert s2["message_count"] == 2
