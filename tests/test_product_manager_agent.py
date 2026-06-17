"""Tests for Product Manager Agent service and recipes."""

from __future__ import annotations

from unittest.mock import patch

import pytest


def test_list_product_manager_recipes():
    from core.product_manager_recipes import list_recipes

    recipes = list_recipes()
    ids = {r["id"] for r in recipes}
    assert "market.research" in ids
    assert "idea.generate" in ids
    assert "product.analyze" in ids
    assert "product.optimize" in ids
    assert "competitor.scan" in ids
    assert "pm.discovery" in ids
    assert "pm.roadmap" in ids
    assert "pm.user_story" in ids


def test_gather_market_signals():
    from core.product_analysis import gather_market_signals

    with patch("core.product_analysis.execute_web_search_sync", return_value="mock search result"):
        with patch("core.product_analysis._safe_hot_topics", return_value="hot topic snapshot"):
            signals = gather_market_signals("AI 工具")
    assert signals["topic"] == "AI 工具"
    assert len(signals["searches"]) >= 1
    assert signals["hot_topics"] == "hot topic snapshot"


def test_product_manager_environment():
    from services import product_manager_service

    env = product_manager_service.get_environment()
    assert env["agent_id"] == "product_manager_agent"
    assert env["recipe_count"] >= 11
    assert env.get("skill_count") == 6
    assert "discovery-process" in env.get("skill_ids", [])
    assert "Discovery" in " ".join(env["focus_areas"])


def test_product_manager_suggestions():
    from services import product_manager_service

    data = product_manager_service.get_suggestions()
    assert "suggestions" in data
    assert len(data["suggestions"]) >= 3
    assert data["suggestions"][0].get("recipe_id")


def test_product_manager_agent_module_exports():
    from agents.product_manager_agent import (
        AGENT_CAPABILITIES,
        AGENT_ID,
        get_product_manager_base_agent,
    )

    assert AGENT_ID == "product_manager_agent"
    assert "pm_market_research" in AGENT_CAPABILITIES
    agent = get_product_manager_base_agent()
    assert agent.agent_id == "product_manager_agent"
    tool_names = {getattr(t, "name", "") for t in agent.tools}
    assert "skills_list" in tool_names
    assert "skill_view" in tool_names
    assert len(agent.tools) >= 7


def test_market_research_recipe_with_mock_llm():
    from services import product_manager_service

    mock_report = "## 执行摘要\n测试市场报告"
    with patch("core.product_analysis.execute_web_search_sync", return_value="search snippet"):
        with patch("core.product_analysis._safe_hot_topics", return_value=""):
            with patch("core.product_analysis._run_llm", return_value=mock_report):
                result = product_manager_service.start_recipe(
                    "market.research",
                    {"topic": "测试赛道", "region": "中国"},
                )
    assert result.get("success") is True
    assert result.get("status") == "completed"
    assert result["result"]["report"] == mock_report
