"""Tests for knowledge content optimizer rule-based cleanup."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from services.knowledge_content_optimizer import cleanup_extracted_text  # noqa: E402


def test_fix_hyphenation_and_merge_paragraphs():
    raw = """Intro line that continues here
and should merge with previous.

Page 3

know-
ledge base test."""
    cleaned = cleanup_extracted_text(raw)
    assert "knowledge base test" in cleaned
    assert "Page 3" not in cleaned
    assert "Intro line that continues here and should merge" in cleaned


def test_strip_toc_dot_leaders():
    raw = "Chapter One .............. 12\n\nBody text."
    cleaned = cleanup_extracted_text(raw)
    assert "Chapter One" in cleaned
    assert ".............." not in cleaned


def test_dedupe_consecutive_repeated_lines():
    raw = "Company Header\nCompany Header\nCompany Header\n\nPara one."
    cleaned = cleanup_extracted_text(raw)
    assert cleaned.count("Company Header") == 1