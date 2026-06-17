"""Tests for Ad Campaign Assistant service and recipes."""

from __future__ import annotations

from unittest.mock import patch


def test_list_ad_campaign_recipes():
    from core.ad_campaign_recipes import list_recipes

    recipes = list_recipes()
    ids = {r["id"] for r in recipes}
    assert "strategy.plan" in ids
    assert "creative.copy" in ids
    assert "audience.analyze" in ids
    assert "budget.allocate" in ids
    assert "report.review" in ids


def test_ad_campaign_environment():
    from services import ad_campaign_service

    env = ad_campaign_service.get_environment()
    assert env["agent_id"] == "ad_campaign_agent"
    assert env["recipe_count"] >= 5


def test_ad_campaign_suggestions():
    from services import ad_campaign_service

    data = ad_campaign_service.get_suggestions()
    assert len(data["suggestions"]) >= 3
    assert data["suggestions"][0].get("recipe_id")


def test_strategy_recipe_with_mock_llm():
    from services import ad_campaign_service

    mock_report = "## 投放策略\n测试报告"
    with patch("core.ad_campaign_analysis.execute_web_search_sync", return_value="search snippet"):
        with patch("core.ad_campaign_analysis._run_llm", return_value=mock_report):
            result = ad_campaign_service.start_recipe(
                "strategy.plan",
                {"product": "SaaS 协作工具"},
            )
    assert result.get("success") is True
    assert result.get("status") == "completed"
    assert result["result"]["report"] == mock_report


def test_strategy_requires_product():
    from services import ad_campaign_service

    result = ad_campaign_service.start_recipe("strategy.plan", {})
    assert result.get("success") is False
    assert result.get("status") == "failed"
    assert "product is required" in str(result.get("error", ""))


def test_ad_campaign_agent_module_exports():
    from agents.ad_campaign_agent import AGENT_CAPABILITIES, AGENT_ID, get_ad_campaign_base_agent

    assert AGENT_ID == "ad_campaign_agent"
    assert "ad_strategy_planning" in AGENT_CAPABILITIES
    agent = get_ad_campaign_base_agent()
    assert agent.agent_id == "ad_campaign_agent"
    assert len(agent.tools) >= 3
