"""Tests for Game Art Agent service and recipes."""

from __future__ import annotations

from unittest.mock import patch


def test_list_game_art_recipes():
    from core.game_art_recipes import list_recipes

    recipes = list_recipes()
    ids = {r["id"] for r in recipes}
    assert "style.guide" in ids
    assert "character.brief" in ids
    assert "visual.research" in ids


def test_gather_game_art_signals():
    from core.game_art_analysis import gather_game_art_signals

    with patch("core.game_art_analysis.execute_web_search_sync", return_value="mock search result"):
        with patch("core.game_art_analysis._safe_gaming_trends", return_value="trend snapshot"):
            signals = gather_game_art_signals("奇幻 RPG")
    assert signals["topic"] == "奇幻 RPG"
    assert len(signals["searches"]) >= 1


def test_game_art_environment():
    from services import game_art_service

    env = game_art_service.get_environment()
    assert env["agent_id"] == "game_art_agent"
    assert env["recipe_count"] >= 5


def test_game_art_agent_module_exports():
    from agents.game_art_agent import AGENT_CAPABILITIES, AGENT_ID, get_game_art_base_agent

    assert AGENT_ID == "game_art_agent"
    assert "ga_visual_design" in AGENT_CAPABILITIES
    agent = get_game_art_base_agent()
    assert agent.agent_id == "game_art_agent"
    assert len(agent.tools) >= 5


def test_style_guide_recipe_with_mock_llm():
    from services import game_art_service

    mock_report = "## 视觉定位\n测试风格指南"
    with patch("core.game_art_analysis.execute_web_search_sync", return_value="snippet"):
        with patch("core.game_art_analysis._safe_gaming_trends", return_value=""):
            with patch("core.game_art_analysis._run_llm", return_value=mock_report):
                result = game_art_service.start_recipe(
                    "style.guide",
                    {"game_name": "测试游戏", "genre": "RPG"},
                )
    assert result.get("success") is True
    assert result["result"]["report"] == mock_report

