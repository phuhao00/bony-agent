"""Tests for taste-skill art direction prompt enrichment."""

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from services.taste_art_direction import (
    copy_anti_slop_block,
    enrich_image_prompt,
    enrich_video_prompt,
    is_taste_art_direction_enabled,
    pick_skill_id,
    pipeline_taste_metadata,
)


@pytest.fixture(autouse=True)
def _enable_taste(monkeypatch):
    monkeypatch.setenv("TASTE_ART_DIRECTION", "1")


def test_pick_skill_id_image_web():
    assert pick_skill_id("image_web") == "imagegen-frontend-web"
    assert pick_skill_id("brand") == "brandkit"


def test_enrich_image_prompt_contains_anti_slop():
    brief = "做一个 SaaS 落地页 hero"
    out = enrich_image_prompt(brief, section="hero")
    assert "BANNED" in out
    assert brief in out
    assert "hero" in out.lower()


def test_enrich_video_prompt_contains_cinematic_rules():
    brief = "15秒产品宣传片"
    out = enrich_video_prompt(brief, ref_image_context="hero image warm palette")
    assert "stock" in out.lower()
    assert brief in out
    assert "warm palette" in out


def test_copy_anti_slop_bans_filler_verbs():
    block = copy_anti_slop_block()
    assert "Elevate" in block
    assert "Seamless" in block


def test_pipeline_taste_metadata():
    meta = pipeline_taste_metadata("新品发布活动")
    assert meta.get("taste_art_direction") is True
    assert "taste_design_read" in meta
    assert meta.get("taste_image_skill") == "imagegen-frontend-web"


def test_disabled_returns_original_brief(monkeypatch):
    monkeypatch.setenv("TASTE_ART_DIRECTION", "0")
    assert is_taste_art_direction_enabled() is False
    brief = "简单描述"
    assert enrich_image_prompt(brief) == brief
    assert enrich_video_prompt(brief) == brief
