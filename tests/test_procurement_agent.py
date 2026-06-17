"""Tests for Procurement Assistant service and recipes."""

from __future__ import annotations

from unittest.mock import patch


def test_list_procurement_recipes():
    from core.procurement_recipes import list_recipes

    recipes = list_recipes()
    ids = {r["id"] for r in recipes}
    assert "vendor.evaluate" in ids
    assert "rfq.draft" in ids
    assert "quote.compare" in ids
    assert "contract.review" in ids
    assert "cost.optimize" in ids
    assert "sourcing.strategy" in ids


def test_procurement_environment():
    from services import procurement_service

    env = procurement_service.get_environment()
    assert env["agent_id"] == "procurement_agent"
    assert env["recipe_count"] >= 6


def test_procurement_suggestions():
    from services import procurement_service

    data = procurement_service.get_suggestions()
    assert len(data["suggestions"]) >= 3
    assert data["suggestions"][0].get("recipe_id")


def test_rfq_recipe_with_mock_llm():
    from services import procurement_service

    mock_report = "## RFQ 草案\n测试询价单"
    with patch("core.procurement_analysis.execute_web_search_sync", return_value="search snippet"):
        with patch("core.procurement_analysis._run_llm", return_value=mock_report):
            result = procurement_service.start_recipe(
                "rfq.draft",
                {"item": "办公笔记本"},
            )
    assert result.get("success") is True
    assert result.get("status") == "completed"
    assert result["result"]["report"] == mock_report


def test_quote_compare_requires_quotes():
    from services import procurement_service

    result = procurement_service.start_recipe("quote.compare", {"item": "耗材"})
    assert result.get("success") is False
    assert result.get("status") == "failed"
    assert "quotes is required" in str(result.get("error", ""))


def test_procurement_agent_module_exports():
    from agents.procurement_agent import AGENT_CAPABILITIES, AGENT_ID, get_procurement_base_agent

    assert AGENT_ID == "procurement_agent"
    assert "procurement_vendor_eval" in AGENT_CAPABILITIES
    agent = get_procurement_base_agent()
    assert agent.agent_id == "procurement_agent"
    assert len(agent.tools) >= 3
