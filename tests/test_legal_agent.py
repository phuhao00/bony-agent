"""Tests for Legal Advisor Agent service and recipes."""

from __future__ import annotations

from unittest.mock import patch

import pytest


def test_list_legal_recipes():
    from core.legal_recipes import list_recipes

    recipes = list_recipes()
    ids = {r["id"] for r in recipes}
    assert "case.research" in ids
    assert "compliance.audit" in ids
    assert "regulation.interpret" in ids
    assert "contract.risk" in ids
    assert "finance.legal" in ids


def test_gather_legal_signals():
    from core.legal_analysis import gather_legal_signals

    with patch("core.legal_analysis.execute_web_search_sync", return_value="mock legal search"):
        signals = gather_legal_signals("劳动合同解除")
    assert signals["topic"] == "劳动合同解除"
    assert len(signals["searches"]) >= 1


def test_legal_environment():
    from services import legal_service

    env = legal_service.get_environment()
    assert env["agent_id"] == "legal_agent"
    assert env["recipe_count"] >= 5
    assert "案例检索与权威法律解读" in env["focus_areas"]


def test_legal_suggestions():
    from services import legal_service

    data = legal_service.get_suggestions()
    assert "suggestions" in data
    assert len(data["suggestions"]) >= 3
    assert data["suggestions"][0].get("recipe_id")


def test_legal_agent_module_exports():
    from agents.legal_agent import AGENT_CAPABILITIES, AGENT_ID, get_legal_base_agent

    assert AGENT_ID == "legal_agent"
    assert "legal_case_research" in AGENT_CAPABILITIES
    agent = get_legal_base_agent()
    assert agent.agent_id == "legal_agent"
    assert len(agent.tools) >= 4


def test_case_research_recipe_with_mock_llm():
    from services import legal_service

    mock_report = "## 争议焦点\n测试法律报告"
    with patch("core.legal_analysis.execute_web_search_sync", return_value="search snippet"):
        with patch("core.legal_analysis._run_llm", return_value=mock_report):
            result = legal_service.start_recipe(
                "case.research",
                {"topic": "劳动合同解除", "jurisdiction": "中国"},
            )
    assert result.get("success") is True
    assert result.get("status") == "completed"
    assert "测试法律报告" in result["result"]["report"]
