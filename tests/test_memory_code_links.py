"""Tests for memory ↔ code entity linking."""

from __future__ import annotations

import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).parent.parent / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from services.memory_code_links import extract_code_refs, resolve_memory_code_entities


def test_extract_file_paths():
    content = "Updated `backend/tools/memory_tools.py` and backend/services/memory_coordinator.py"
    refs = extract_code_refs(content)
    labels = {r["label"] for r in refs}
    assert "backend/tools/memory_tools.py" in labels or any("memory_tools" in l for l in labels)


def test_extract_symbols():
    content = "Use search_memory and MemoryCoordinator for recall"
    refs = extract_code_refs(content)
    kinds = {r["kind"] for r in refs}
    assert "symbol" in kinds


def test_metadata_code_refs():
    entities = resolve_memory_code_entities(
        "some memory",
        {"code_refs": ["web/app/settings/context/MemoryPanel.tsx"]},
        use_codegraph=False,
    )
    assert any(e.get("path", "").endswith("MemoryPanel.tsx") for e in entities)
