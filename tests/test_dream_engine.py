"""
Unit tests for dream_engine and dream_store.

Tests cover:
1. DreamStore.save_digest / load_digest round-trip
2. DreamStore.append_dream_card / load_dream_cards
3. DreamStore.update_dream_card_status
4. dream_engine.collect_window (no events → empty)
5. dream_engine.apply_actions (mocked vector store)
6. dream_engine.patch_companion_for_dream (patched companion state)
"""

import json
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

# ---------------------------------------------------------------------------
# PATH SETUP
# ---------------------------------------------------------------------------
BACKEND_DIR = Path(__file__).parent.parent / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture()
def tmp_dream_runs(tmp_path: Path, monkeypatch):
    """Redirect DREAM_RUNS_DIR and PROJECT_ROOT so tests don't pollute real data."""
    import services.dream_store as ds_module

    evo_dir = tmp_path / "storage" / "evolution"
    evo_dir.mkdir(parents=True)
    runs_dir = evo_dir / "dream_runs"
    runs_dir.mkdir(parents=True)
    monkeypatch.setattr(ds_module, "DREAM_RUNS_DIR", runs_dir)
    monkeypatch.setattr(ds_module, "PROJECT_ROOT", tmp_path)
    return runs_dir


# ===========================================================================
# Test 1: DreamStore save/load digest round-trip
# ===========================================================================

def test_dream_store_save_load_digest(tmp_dream_runs, monkeypatch):
    """save_digest then load_digest returns same payload."""
    import services.dream_store as ds_module
    store = ds_module.DreamStore()

    date = "2099-01-01"
    digest = {
        "summary": "test summary",
        "mood": "calm",
        "cards": [],
        "actions": [],
        "companion_blurb": "",
    }
    store.save_digest(date, digest)
    loaded = store.load_digest(date)

    assert loaded is not None
    assert loaded["summary"] == "test summary"
    assert loaded["mood"] == "calm"


# ===========================================================================
# Test 2: DreamStore append_dream_card / load_dream_cards
# ===========================================================================

@pytest.fixture()
def tmp_dreams_jsonl(tmp_path: Path, monkeypatch):
    """Redirect dreams.jsonl path inside dream_store to tmp dir."""
    import services.dream_store as ds_module

    evo_dir = tmp_path / "storage" / "evolution"
    evo_dir.mkdir(parents=True)
    runs_dir = evo_dir / "dream_runs"
    runs_dir.mkdir(parents=True)
    monkeypatch.setattr(ds_module, "DREAM_RUNS_DIR", runs_dir)
    monkeypatch.setattr(ds_module, "PROJECT_ROOT", tmp_path)
    return tmp_path


def test_dream_store_save_load_cards(tmp_dreams_jsonl, monkeypatch):
    """append_dream_card then load_dream_cards returns all appended cards."""
    import services.dream_store as ds_module
    store = ds_module.DreamStore()

    card1 = {"id": "card-001", "title": "Alpha", "type": "insight", "status": "pending"}
    card2 = {"id": "card-002", "title": "Beta", "type": "action", "status": "pending"}
    store.append_dream_card(card1)
    store.append_dream_card(card2)

    cards = store.load_dream_cards()
    assert len(cards) == 2
    ids = {c["id"] for c in cards}
    assert "card-001" in ids
    assert "card-002" in ids


# ===========================================================================
# Test 3: DreamStore update_dream_card_status
# ===========================================================================

def test_dream_store_update_card_status(tmp_dreams_jsonl, monkeypatch):
    """update_dream_card_status changes card status in place."""
    import services.dream_store as ds_module
    store = ds_module.DreamStore()

    card = {"id": "card-abc", "title": "X", "type": "insight", "status": "pending"}
    store.append_dream_card(card)

    ok = store.update_dream_card_status("card-abc", "accepted")
    assert ok is True

    cards = store.load_dream_cards()
    matched = [c for c in cards if c["id"] == "card-abc"]
    assert len(matched) == 1
    assert matched[0]["status"] == "accepted"


# ===========================================================================
# Test 4: collect_window — no events → empty list
# ===========================================================================

def test_collect_window_empty(tmp_dream_runs, monkeypatch):
    """collect_window returns empty list when no JSONL rows match."""
    import services.dream_engine as de_module

    monkeypatch.setattr(de_module, "read_jsonl_rows", lambda *a, **kw: [])

    events = de_module.collect_window(since_iso="2000-01-01T00:00:00")
    assert isinstance(events, list)
    assert len(events) == 0


# ===========================================================================
# Test 5: apply_actions — calls update_memory_metadata via mocked store
# ===========================================================================

def test_apply_actions_calls_update(tmp_dream_runs, monkeypatch):
    """apply_actions should call update_memory_metadata for lower_confidence actions."""
    import services.dream_engine as de_module

    calls: list[tuple] = []
    mock_store = MagicMock()

    def fake_update(memory_id: str, patch: dict) -> bool:
        calls.append((memory_id, patch))
        return True

    mock_store.update_memory_metadata = fake_update

    # Patch get_vector_store inside dream_engine module
    with patch.object(de_module, "apply_actions", wraps=de_module.apply_actions):
        import utils.vector_store as vs_module
        original_get = getattr(vs_module, "get_vector_store", None)
        monkeypatch.setattr(vs_module, "get_vector_store", lambda: mock_store)

        # Also patch append_event to avoid writing real files
        monkeypatch.setattr(de_module, "append_event", lambda *a, **kw: None)

        actions = [
            {"type": "lower_confidence", "memory_id": "m-001", "reason": "outdated"},
            {"type": "lower_confidence", "memory_id": "m-002", "reason": "conflicting"},
        ]
        result = de_module.apply_actions(actions)

    assert result["applied"] == 2
    assert result["skipped"] == 0
    assert len(calls) == 2
    assert calls[0][0] == "m-001"
    assert calls[1][0] == "m-002"


# ===========================================================================
# Test 6: patch_companion_for_dream
# ===========================================================================

def test_patch_companion_for_dream(tmp_dream_runs, monkeypatch):
    """patch_companion_for_dream calls patch_companion_state with mood + feedback."""
    import services.dream_engine as de_module

    patched: list[dict] = []

    # Patch at the core.companion_state module level
    import core.companion_state as cs_module
    monkeypatch.setattr(cs_module, "patch_companion_state", lambda p: patched.append(p) or {})

    digest = {
        "summary": "Weekly reflection: focus on AI tools",
        "companion_blurb": "You explored a lot this week",
        "cards": [],
        "actions": [],
    }

    de_module.patch_companion_for_dream(digest, mood_label="thoughtful")

    assert len(patched) >= 1
    all_keys = set()
    for p in patched:
        all_keys.update(p.keys())

    # Should have called with mood and/or append_feedback
    assert ("mood" in all_keys) or ("append_feedback" in all_keys)
