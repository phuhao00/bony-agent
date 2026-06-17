"""Tests for PM skill loader and skill-backed recipes."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest

from core.pm_skill_loader import PM_SKILL_IDS, load_pm_skill_bundle, skill_id_for_recipe

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SKILLS_DIR = PROJECT_ROOT / ".agent" / "skills"


@pytest.mark.parametrize("skill_id", PM_SKILL_IDS)
def test_pm_skill_directories_exist(skill_id: str):
    skill_dir = SKILLS_DIR / skill_id
    assert skill_dir.is_dir(), f"missing skill dir: {skill_id}"
    skill_file = skill_dir / "SKILL.md"
    assert skill_file.is_file(), f"missing SKILL.md: {skill_id}"
    content = skill_file.read_text(encoding="utf-8")
    assert "category: product-manager" in content
    assert "deanpeters-pm-skills" in content


def test_load_pm_skill_bundle_discovery():
    bundle = load_pm_skill_bundle("discovery-process")
    assert bundle["skill_id"] == "discovery-process"
    assert "Discovery" in bundle["skill_body"] or "discovery" in bundle["skill_body"].lower()
    assert bundle["has_template"] is True


def test_load_pm_skill_bundle_user_story_has_example():
    bundle = load_pm_skill_bundle("user-story")
    assert bundle["has_example"] is True


def test_skill_id_for_recipe_mapping():
    assert skill_id_for_recipe("pm.discovery") == "discovery-process"
    assert skill_id_for_recipe("pm.roadmap") == "roadmap-planning"
    assert skill_id_for_recipe("market.research") is None


def test_load_pm_skill_bundle_unknown():
    with pytest.raises(ValueError, match="Unknown PM skill"):
        load_pm_skill_bundle("not-a-skill")


def test_pm_discovery_recipe_with_mock_llm():
    from services import product_manager_service

    mock_report = "## Discovery Plan\n测试 Discovery 输出"
    with patch("core.product_analysis.gather_market_signals", return_value={"topic": "x", "searches": [], "hot_topics": ""}):
        with patch("core.product_analysis._run_llm", return_value=mock_report):
            result = product_manager_service.start_recipe(
                "pm.discovery",
                {"problem": "留存下降", "context": "SaaS"},
            )
    assert result.get("success") is True
    assert result["result"]["skill_id"] == "discovery-process"
    assert result["result"]["report"] == mock_report
    execution = result["result"].get("execution") or {}
    assert execution.get("skill_id") == "discovery-process"
    assert execution.get("skill_loaded") is True
    assert isinstance(execution.get("logs"), list)
    assert execution.get("model")
    assert execution.get("provider")
