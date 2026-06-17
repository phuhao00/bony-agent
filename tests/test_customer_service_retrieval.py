"""Tests for customer-service knowledge retrieval."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from utils.cs_faq_retrieval import search_markdown_sections  # noqa: E402


SAMPLE_MD = """# Hello Kitty's Tech Quest

### 随身小背包 vs 巨型魔法工厂
- **个人计算机 (PC)**
  - 算力和存储容量有限。
  - 适合个人娱乐和日常写作业。
- **云服务器 (IaaS 云计算)**
  - 弹性扩展。
"""


def test_search_markdown_sections_matches_pc():
    hits = search_markdown_sections(SAMPLE_MD, "pc", top_k=2)
    assert hits
    section, score, _title = hits[0]
    assert score >= 4.0
    assert "个人计算机 (PC)" in section or "PC" in section


def test_search_markdown_sections_matches_chinese_keyword():
    hits = search_markdown_sections(SAMPLE_MD, "云服务器", top_k=1)
    assert hits
    assert "云服务器" in hits[0][0]
