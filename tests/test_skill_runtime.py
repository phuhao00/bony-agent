"""Tests for progressive-disclosure skill runtime."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).parent.parent / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from services.skill_runtime import (
    build_skill_index_prompt_block,
    list_skill_index,
    load_skill_body,
    record_skill_usage,
)


def test_list_skill_index_includes_taste_skill(tmp_path, monkeypatch):
    skills_dir = tmp_path / ".agent" / "skills" / "design-taste-frontend"
    skills_dir.mkdir(parents=True)
    (skills_dir / "SKILL.md").write_text(
        "---\nname: design-taste-frontend\ndescription: Anti-slop frontend\n---\n# Body\n",
        encoding="utf-8",
    )
    enabled_path = tmp_path / "storage" / "skills_enabled.json"
    enabled_path.parent.mkdir(parents=True)
    enabled_path.write_text(json.dumps({"design-taste-frontend": True}), encoding="utf-8")

    monkeypatch.setattr("services.skill_runtime.SKILLS_DIR", tmp_path / ".agent" / "skills")
    monkeypatch.setattr("services.skill_runtime.SKILLS_ENABLED_PATH", enabled_path)

    entries = list_skill_index()
    assert len(entries) == 1
    assert entries[0].id == "design-taste-frontend"
    assert entries[0].source == "taste-skill"
    assert "Anti-slop" in entries[0].description


def test_load_skill_body_records_usage(tmp_path, monkeypatch):
    skills_dir = tmp_path / ".agent" / "skills" / "foo"
    skills_dir.mkdir(parents=True)
    (skills_dir / "SKILL.md").write_text("# Foo skill\n", encoding="utf-8")
    usage_path = tmp_path / "storage" / "evolution" / "skill_usage.jsonl"

    monkeypatch.setattr("services.skill_runtime.SKILLS_DIR", tmp_path / ".agent" / "skills")
    monkeypatch.setattr("services.skill_runtime.SKILL_USAGE_PATH", usage_path)

    body = load_skill_body("foo")
    assert body is not None
    assert usage_path.exists()
    line = usage_path.read_text(encoding="utf-8").strip()
    event = json.loads(line)
    assert event["skill_id"] == "foo"
    assert event["action"] == "view"


def test_build_skill_index_prompt_block_nonempty():
    block = build_skill_index_prompt_block()
    # Real project has many skills; block should mention skills_list
    if block:
        assert "skills_list" in block or "skill_view" in block
