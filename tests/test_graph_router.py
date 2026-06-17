"""Tests for Graph Router (LangGraph unified entry)."""

import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from agents.chat_request import ChatRequest, ChatPreferences
from agents.graph_router import select_graph
from agents.publish_routing import is_video_generation_publish_request
from agents.router import IntentRouter


def test_select_graph_default_orchestrator():
    req = ChatRequest(input="生成一张海报")
    route = select_graph(req)
    assert route.graph_id == "orchestrator"


def test_select_graph_greeting_orchestrator():
    req = ChatRequest(input="你好")
    route = select_graph(req)
    assert route.graph_id == "orchestrator"


def test_select_graph_forced_agent():
    req = ChatRequest(input="写文案", agent_id="copywriter_agent")
    route = select_graph(req)
    assert route.graph_id == "chat"
    assert route.agent_id == "copywriter_agent"


def test_select_graph_planning_keywords():
    req = ChatRequest(input="请分步规划完整流程：调研、写稿、出图")
    route = select_graph(req)
    assert route.graph_id == "planning"


def test_select_graph_lobster_keywords():
    req = ChatRequest(input="运行龙虾流水线采集热点")
    route = select_graph(req)
    assert route.graph_id == "lobster"


def test_video_publish_orchestrator_pipeline():
    text = "生成视频并发布到哔哩哔哩"
    assert is_video_generation_publish_request(text)
    req = ChatRequest(input=text, mode="multi")
    route = select_graph(req)
    assert route.graph_id == "orchestrator"
    assert route.use_publish_pipeline is True


def test_image_edit_forced_but_generation_input_routes_to_orchestrator():
    """用户当前选中图片编辑 Agent，但输入是生成新图时应交给 Orchestrator。"""
    cases = [
        "生成一张小红书风格的封面图",
        "画一张banner",
        "做张产品宣传图",
        "生成图片",
    ]
    for text in cases:
        req = ChatRequest(input=text, agent_id="image_edit_agent")
        route = select_graph(req)
        assert route.graph_id == "orchestrator", f"{text!r} should override to orchestrator, got {route}"
        assert route.reason == "generation_overrides_forced_image_edit"


def test_image_edit_forced_and_edit_input_keeps_chat():
    """用户当前选中图片编辑 Agent，输入确实是编辑请求时仍走 Chat 图。"""
    cases = [
        "帮我去掉这张图的水印",
        "把背景换成白色",
        "参考图重绘一下",
    ]
    for text in cases:
        req = ChatRequest(input=text, agent_id="image_edit_agent")
        route = select_graph(req)
        assert route.graph_id == "chat", f"{text!r} should keep chat, got {route}"
        assert route.agent_id == "image_edit_agent"


def test_intent_router_generation_cover_to_media_agent():
    """纯生成请求（封面图/海报）应命中 media_agent 而非 image_edit_agent。"""
    router = IntentRouter()
    result = asyncio.run(router.route("生成一张小红书风格的封面图"))
    assert result.agent_id == "media_agent", f"got {result}"
    assert result.confidence >= 0.9
