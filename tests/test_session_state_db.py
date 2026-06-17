"""Tests for SQLite FTS session store."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).parent.parent / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


@pytest.fixture()
def temp_db(tmp_path, monkeypatch):
    db_path = tmp_path / "session_state.db"
    monkeypatch.setattr("services.session_state_db.DB_PATH", db_path)
    yield db_path


def test_append_and_discovery(temp_db):
    from services.session_state_db import append_message, discovery_search, browse_mode

    sid = "sess-test-1"
    append_message(sid, "user", "如何发布小红书视频", title_hint="小红书发布")
    append_message(sid, "assistant", "先登录账号再上传素材")

    disc = discovery_search("小红书", limit=5)
    assert disc["mode"] == "discovery"
    assert disc["result_count"] >= 1
    assert disc["results"][0]["session_id"] == sid

    browse = browse_mode(limit=5)
    assert browse["mode"] == "browse"
    assert browse["result_count"] >= 1


def test_scroll_mode(temp_db):
    from services.session_state_db import append_message, scroll_messages

    sid = "sess-scroll"
    ids = []
    for i in range(5):
        ids.append(append_message(sid, "user" if i % 2 == 0 else "assistant", f"message {i}"))

    result = scroll_messages(sid, around_message_id=ids[2], window=2)
    assert result["mode"] == "scroll"
    assert len(result["messages"]) >= 3


def test_session_search_three_modes(temp_db):
    from services.session_state_db import append_message
    from services.session_recall import session_search

    sid = "sess-recall"
    append_message(sid, "user", "生成抖音脚本模板")
    append_message(sid, "assistant", "这是三段式脚本结构")

    browse = session_search("", session_id="", limit=5)
    assert browse["mode"] == "browse"

    disc = session_search("抖音脚本", limit=3)
    assert disc.get("mode") == "discovery" or disc.get("backend") == "sqlite_fts"

    scroll = session_search("", session_id=sid, around_message_id=1)
    assert scroll["mode"] == "scroll"


def test_session_stats(temp_db):
    from services.session_state_db import append_message, session_stats

    append_message("s1", "user", "hello")
    append_message("s1", "assistant", "hi")
    append_message("s2", "user", "another session")

    stats = session_stats()
    assert stats["session_count"] == 2
    assert stats["message_count"] == 3
    assert stats["last_updated"] is not None


def test_ensure_session_db_ready_skips_backfill_when_populated(temp_db, monkeypatch):
    from services.session_state_db import append_message, ensure_session_db_ready

    append_message("existing", "user", "already here")

    backfill_called = {"n": 0}

    def fake_backfill():
        backfill_called["n"] += 1
        return 0

    monkeypatch.setattr("services.session_state_db.backfill_from_events", fake_backfill)

    result = ensure_session_db_ready()
    assert backfill_called["n"] == 0
    assert result["session_count"] == 1
    assert result["message_count"] == 1
    assert result["imported_on_startup"] == 0


def test_backfill_from_events_imports_chat_turns(temp_db, tmp_path):
    from services.session_state_db import backfill_from_events, discovery_search

    events_file = tmp_path / "events.jsonl"
    events_file.write_text(
        json.dumps(
            {
                "id": "evt-1",
                "kind": "chat_turn",
                "session_id": "backfill-sess",
                "trace_id": "trace-1",
                "source": "test",
                "channel": "local",
                "action": "chat",
                "status": "ok",
                "summary": "backfill user message",
                "metadata": {"role": "user", "content": "backfill user message"},
                "created_at": "2026-01-01T00:00:00Z",
            },
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )

    imported = backfill_from_events(events_path=events_file)
    assert imported == 1

    disc = discovery_search("backfill", limit=5)
    assert disc["result_count"] >= 1
    assert disc["results"][0]["session_id"] == "backfill-sess"


def test_ensure_session_db_ready_triggers_backfill_when_empty(temp_db, tmp_path, monkeypatch):
    from services import session_state_db as sdb

    events_file = tmp_path / "events.jsonl"
    events_file.write_text(
        json.dumps(
            {
                "id": "evt-2",
                "kind": "chat_turn",
                "session_id": "startup-sess",
                "trace_id": "trace-2",
                "source": "test",
                "channel": "local",
                "action": "chat",
                "status": "ok",
                "summary": "startup import message",
                "metadata": {"role": "user", "content": "startup import message"},
                "created_at": "2026-01-01T00:00:00Z",
            },
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )

    real_backfill = sdb.backfill_from_events
    monkeypatch.setattr(
        sdb,
        "backfill_from_events",
        lambda events_path=None, max_events=5000: real_backfill(
            events_path=events_file, max_events=max_events
        ),
    )

    result = sdb.ensure_session_db_ready()
    assert result["imported_on_startup"] == 1
    assert result["session_count"] == 1
    assert result["message_count"] == 1
