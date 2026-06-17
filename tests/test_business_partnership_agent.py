"""Tests for Business Partnership Assistant service and recipes."""

from __future__ import annotations

from unittest.mock import patch


def test_list_business_partnership_recipes():
    from core.business_partnership_recipes import list_recipes

    recipes = list_recipes()
    ids = {r["id"] for r in recipes}
    assert "outreach.draft" in ids
    assert "proposal.generate" in ids
    assert "contract.review" in ids
    assert "partner.evaluate" in ids
    assert "pipeline.plan" in ids


def test_business_partnership_environment():
    from services import business_partnership_service

    env = business_partnership_service.get_environment()
    assert env["agent_id"] == "business_partnership_agent"
    assert env["recipe_count"] >= 5


def test_business_partnership_suggestions():
    from services import business_partnership_service

    data = business_partnership_service.get_suggestions()
    assert len(data["suggestions"]) >= 3
    assert data["suggestions"][0].get("recipe_id")


def test_outreach_recipe_with_mock_llm():
    from services import business_partnership_service

    mock_report = "## Outreach 文案\n测试文案"
    with patch(
        "core.business_partnership_analysis.execute_web_search_sync",
        return_value="search snippet",
    ):
        with patch("core.business_partnership_analysis._run_llm", return_value=mock_report):
            result = business_partnership_service.start_recipe(
                "outreach.draft",
                {"our_company": "Acme", "target_partner": "Beta Corp"},
            )
    assert result.get("success") is True
    assert result.get("status") == "completed"
    assert result["result"]["report"] == mock_report


def test_contract_review_requires_summary():
    from services import business_partnership_service

    result = business_partnership_service.start_recipe("contract.review", {})
    assert result.get("success") is False
    assert result.get("status") == "failed"
    assert "contract_summary is required" in str(result.get("error", ""))


def test_business_partnership_agent_module_exports():
    from agents.business_partnership_agent import (
        AGENT_CAPABILITIES,
        AGENT_ID,
        get_business_partnership_base_agent,
    )

    assert AGENT_ID == "business_partnership_agent"
    assert "bp_outreach_draft" in AGENT_CAPABILITIES
    agent = get_business_partnership_base_agent()
    assert agent.agent_id == "business_partnership_agent"
    assert len(agent.tools) >= 3
