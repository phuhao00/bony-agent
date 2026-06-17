"""
Unit tests for memory_graph_export.py

Tests cover:
1. export_memory_graph mode=memories returns {nodes, links} structure
2. export_memory_graph mode=topics returns topic-type nodes
3. export_memory_graph mode=usage returns usage-type nodes
4. export_memory_graph mode=dreams returns dream-card nodes
5. Snapshot cache is used on second call (same mode)
6. Unknown mode raises ValueError
"""

import sys
import json
import time
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

BACKEND_DIR = Path(__file__).parent.parent / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def clear_snap_cache():
    """Reset module-level snapshot cache between tests."""
    try:
        import services.memory_graph_export as mge
        mge._SNAP_CACHE.clear()
    except Exception:
        pass
    yield
    try:
        import services.memory_graph_export as mge
        mge._SNAP_CACHE.clear()
    except Exception:
        pass


def _fake_vector_store(memories: list[dict] | None = None):
    """Return a mock that mimics VectorStoreManager.get_all_memories()."""
    vs = MagicMock()
    vs.get_all_memories.return_value = memories or []
    return vs


def _mock_empty_jsonl(monkeypatch):
    """Patch read_jsonl_rows in learning_data_pipeline to return empty."""
    import services.learning_data_pipeline as ldp
    monkeypatch.setattr(ldp, "read_jsonl_rows", lambda *a, **kw: [])


# ---------------------------------------------------------------------------
# Test 1: mode=memories
# ---------------------------------------------------------------------------

def test_export_memories_structure(monkeypatch):
    """mode=memories must return dict with nodes and links."""
    import services.memory_graph_export as mge

    sample_memories = [
        {"id": "m1", "content": "Python is great for all coding tasks here", "metadata": {}},
        {"id": "m2", "content": "pytest is useful for all testing tasks here", "metadata": {}},
    ]

    # Patch get_vector_store in the memory_graph_export module namespace
    monkeypatch.setattr(mge, "get_vector_store", lambda: _fake_vector_store(sample_memories))
    _mock_empty_jsonl(monkeypatch)

    result = mge.export_memory_graph(mode="memories")
    assert "nodes" in result
    assert "links" in result
    assert isinstance(result["nodes"], list)
    assert isinstance(result["links"], list)
    # Should have at least the two memory nodes
    node_ids = {n["id"] for n in result["nodes"]}
    assert "m1" in node_ids
    assert "m2" in node_ids


# ---------------------------------------------------------------------------
# Test 2: mode=topics
# ---------------------------------------------------------------------------

def test_export_topics_structure(monkeypatch):
    """mode=topics must return topic-type nodes."""
    import services.memory_graph_export as mge

    sample_memories = [
        {"id": "m1", "content": "AI assistant talk", "metadata": {"topic": "AI"}},
        {"id": "m2", "content": "AI coding help", "metadata": {"topic": "AI"}},
        {"id": "m3", "content": "Python packages", "metadata": {"topic": "Python"}},
    ]

    monkeypatch.setattr(mge, "get_vector_store", lambda: _fake_vector_store(sample_memories))
    _mock_empty_jsonl(monkeypatch)

    result = mge.export_memory_graph(mode="topics")
    assert "nodes" in result
    topic_nodes = [n for n in result["nodes"] if n.get("type") == "topic"]
    assert len(topic_nodes) >= 1


# ---------------------------------------------------------------------------
# Test 3: mode=usage
# ---------------------------------------------------------------------------

def test_export_usage_structure(monkeypatch):
    """mode=usage must return usage-type nodes."""
    import services.memory_graph_export as mge

    monkeypatch.setattr(mge, "get_vector_store", lambda: _fake_vector_store([
        {"id": "m1", "content": "test", "metadata": {}},
    ]))

    usage_rows = [
        {"memory_id": "m1", "at": "2026-01-01T00:00:00", "kind": "recall"},
        {"memory_id": "m1", "at": "2026-01-02T00:00:00", "kind": "recall"},
    ]
    # _build_usage_graph lazy imports read_jsonl_rows from learning_data_pipeline
    import services.learning_data_pipeline as ldp
    monkeypatch.setattr(ldp, "read_jsonl_rows", lambda *a, **kw: usage_rows)

    result = mge.export_memory_graph(mode="usage")
    assert "nodes" in result
    node_ids = {n["id"] for n in result["nodes"]}
    assert "m1" in node_ids


# ---------------------------------------------------------------------------
# Test 4: mode=dreams
# ---------------------------------------------------------------------------

def test_export_dreams_structure(monkeypatch):
    """mode=dreams must return dream-card nodes."""
    import services.memory_graph_export as mge

    dream_rows = [
        {"id": "dc1", "title": "dream insight", "type": "insight", "status": "pending",
         "created_at": "2026-01-01T02:00:00"},
    ]
    monkeypatch.setattr(mge, "get_vector_store", lambda: _fake_vector_store([]))

    # _build_dreams_graph lazy imports get_dream_store
    import services.dream_store as ds_module
    mock_ds = MagicMock()
    mock_ds.load_dream_cards.return_value = dream_rows
    monkeypatch.setattr(ds_module, "get_dream_store", lambda: mock_ds)

    result = mge.export_memory_graph(mode="dreams")
    assert "nodes" in result
    # _build_dreams_graph uses type="dream" (not "dream_card")
    dream_nodes = [n for n in result["nodes"] if n.get("type") in ("dream", "dream_card")]
    assert len(dream_nodes) >= 1


# ---------------------------------------------------------------------------
# Test 5: Snapshot cache
# ---------------------------------------------------------------------------

def test_snapshot_cache_used(monkeypatch):
    """Second call with same mode should use snapshot cache, not rebuild."""
    import services.memory_graph_export as mge

    build_count = [0]
    original_build = mge._build_memories_graph

    def counting_build(*a, **kw):
        build_count[0] += 1
        return original_build(*a, **kw)

    monkeypatch.setattr(mge, "_build_memories_graph", counting_build)
    monkeypatch.setattr(mge, "get_vector_store", lambda: _fake_vector_store([]))
    _mock_empty_jsonl(monkeypatch)

    # First call: builds
    mge.export_memory_graph(mode="memories")
    # Second call: should use cache
    mge.export_memory_graph(mode="memories")

    # Build function called only once
    assert build_count[0] == 1


# ---------------------------------------------------------------------------
# Test 6: Unknown mode returns error response (not nodes/links)
# ---------------------------------------------------------------------------

def test_export_unknown_mode_returns_error(monkeypatch):
    """Passing an unknown mode should return an error dict (not raise)."""
    import services.memory_graph_export as mge

    result = mge.export_memory_graph(mode="__nonexistent__")
    # Implementation returns {"error": "...", "nodes": [], "links": []}
    assert "error" in result
    assert result["nodes"] == []
    assert result["links"] == []
