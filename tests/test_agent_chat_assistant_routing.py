"""Tests for main-chat assistant routing and workspace context."""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from agents.chat_request import ChatRequest, WorkspaceContext
from agents.graph_router import select_graph
from agents.workspace_context import augment_input_with_workspace
from core.assistant_intent_resolver import resolve_assistant_intent
from core.assistant_catalog import get_by_agent_id, list_assistants


def test_assistant_catalog_contains_main_chat_targets():
    assistants = list_assistants()
    agent_ids = {item["agent_id"] for item in assistants}
    assert "product_manager_agent" in agent_ids
    assert "legal_agent" in agent_ids
    assert "game_art_agent" in agent_ids
    assert "image_edit_agent" in agent_ids
    assert "desktop_operator_agent" in agent_ids


def test_forced_agent_id_prefers_chat_graph():
    req = ChatRequest(input="帮我审一下合同", agent_id="legal_agent")
    route = select_graph(req)
    assert route.graph_id == "chat"
    assert route.agent_id == "legal_agent"
    assert route.reason == "forced_agent_id"


def test_catalog_keyword_routes_to_specialist_chat_graph():
    req = ChatRequest(input="帮我做一个手游 UI 视觉风格指南")
    route = select_graph(req)
    assert route.graph_id == "chat"
    assert route.agent_id == "game_art_agent"
    assert route.reason.startswith("assistant_intent_resolver:")


def test_mod_game_market_routes_to_product_manager():
    req = ChatRequest(input="帮我分析下mod游戏市场")
    route = select_graph(req)
    assert route.graph_id == "chat"
    assert route.agent_id == "product_manager_agent"
    assert route.reason.startswith("assistant_intent_resolver:")


def test_smart_resolver_does_not_treat_mod_market_as_code():
    candidate = resolve_assistant_intent("帮我分析下mod游戏市场")
    assert candidate is not None
    assert candidate.agent_id == "product_manager_agent"
    assert candidate.confidence >= 0.8


def test_smart_resolver_routes_actual_code_analysis_to_code_agent():
    candidate = resolve_assistant_intent("帮我分析下这段代码的调用关系和 bug 风险")
    assert candidate is not None
    assert candidate.agent_id == "code_analyst_agent"


def test_smart_resolver_routes_legal_contract_review():
    candidate = resolve_assistant_intent("帮我审一下这段劳动合同条款有没有风险")
    assert candidate is not None
    assert candidate.agent_id == "legal_agent"


def test_image_edit_request_routes_to_image_edit_agent():
    req = ChatRequest(input="帮我把这张图片右下角水印去掉，并保持背景自然")
    route = select_graph(req)
    assert route.graph_id == "chat"
    assert route.agent_id == "image_edit_agent"
    assert route.reason.startswith("assistant_intent_resolver:")


def test_smart_resolver_routes_reference_image_edit():
    candidate = resolve_assistant_intent("用参考图的风格帮我修一下这张照片，顺便换背景")
    assert candidate is not None
    assert candidate.agent_id == "image_edit_agent"


def test_high_risk_assistant_metadata_requires_approval():
    programmer = get_by_agent_id("programmer_agent")
    desktop = get_by_agent_id("desktop_operator_agent")
    assert programmer is not None and programmer.requires_approval
    assert desktop is not None and desktop.requires_approval


def test_workspace_context_preserves_attachments():
    ctx = WorkspaceContext.from_raw(
        {
            "root": "/repo",
            "attached_files": ["web/app/page.tsx"],
            "attachments": [{"name": "brief.png", "type": "image/png", "size": 12}],
            "source_message_id": "user-1",
        }
    )
    state = ctx.to_state_dict()
    assert state["attachments"][0]["name"] == "brief.png"
    text = augment_input_with_workspace("请分析", state)
    assert "web/app/page.tsx" in text
    assert "brief.png" in text

