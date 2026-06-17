"""Tests for Game Design Agent service and recipes."""

from __future__ import annotations

from unittest.mock import patch


def test_list_game_design_recipes():
    from core.game_design_recipes import list_recipes

    recipes = list_recipes()
    ids = {r["id"] for r in recipes}
    assert "concept.pitch" in ids
    assert "core.loop" in ids
    assert "balance.framework" in ids


def test_gather_game_design_signals():
    from core.game_design_analysis import gather_game_design_signals

    with patch("core.game_design_analysis.execute_web_search_sync", return_value="mock search"):
        with patch("core.game_design_analysis._safe_gaming_trends", return_value="trends"):
            signals = gather_game_design_signals("Roguelike")
    assert signals["topic"] == "Roguelike"
    assert len(signals["searches"]) >= 1


def test_game_design_environment():
    from services import game_design_service

    env = game_design_service.get_environment()
    assert env["agent_id"] == "game_design_agent"
    assert env["recipe_count"] >= 6


def test_game_design_agent_module_exports():
    from agents.game_design_agent import AGENT_CAPABILITIES, AGENT_ID, get_game_design_base_agent

    assert AGENT_ID == "game_design_agent"
    assert "gd_concept_system" in AGENT_CAPABILITIES
    agent = get_game_design_base_agent()
    assert agent.agent_id == "game_design_agent"
    assert len(agent.tools) >= 5


def test_concept_pitch_recipe_with_mock_llm():
    from services import game_design_service

    mock_report = "## 一句话卖点\n测试概念案"
    with patch("core.game_design_analysis.execute_web_search_sync", return_value="snippet"):
        with patch("core.game_design_analysis._safe_gaming_trends", return_value=""):
            with patch("core.game_design_analysis._run_llm", return_value=mock_report):
                result = game_design_service.start_recipe(
                    "concept.pitch",
                    {"idea": "合成放置", "platform": "手游"},
                )
    assert result.get("success") is True
    assert result["result"]["report"] == mock_report
