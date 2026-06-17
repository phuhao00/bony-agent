"""Tests for knowledge auto-optimize routing helpers."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from routers.knowledge_router import _should_auto_optimize_doc  # noqa: E402


def test_should_auto_optimize_pdf_not_yet_optimized():
    assert _should_auto_optimize_doc({"source_type": "pdf"}) is True


def test_should_skip_already_optimized():
    assert _should_auto_optimize_doc({"source_type": "pdf", "content_optimized": True}) is False


def test_should_skip_faq():
    assert _should_auto_optimize_doc({"content_type": "faq", "source_type": "pdf"}) is False


def test_should_auto_optimize_converted_upload():
    assert _should_auto_optimize_doc({"converted": True, "source_filename": "report.pdf"}) is True
