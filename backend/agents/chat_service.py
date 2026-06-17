"""Unified LangGraph chat service — Graph Router entry + SSE streaming."""

from __future__ import annotations

import asyncio
import os
from typing import Any, AsyncIterator, List

from langchain_core.messages import HumanMessage

from agents.chat_request import ChatMessage, ChatRequest
from agents.workspace_context import augment_input_with_workspace, resolve_workspace_root
from utils.workspace_root import workspace_root_scope
from agents.graph_router import select_graph
from agents.orchestrator import invoke_multi_agent, stream_multi_agent
from agents.planning_bot import get_planning_graph
from agents.lobster_bot import build_lobster_graph
from agents.chat_graph import invoke_chat_graph, stream_chat_graph
from agents.sse_adapter import graph_selected_event, metadata_event
from core.llm_provider import get_current_model, get_provider_id
from core.assistant_catalog import get_by_agent_id
from services.memory_coordinator import augment_input_with_memory, get_memory_coordinator
from utils.logger import setup_logger
from utils.trace_store import append_trace_event, create_trace, finalize_trace, update_trace_metadata

logger = setup_logger("chat_service")

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _resolve_chat_messages(req: ChatRequest) -> list[ChatMessage]:
    """Map legacy `input`-only requests to a single user message for ChatGraph."""
    if req.messages:
        return req.messages
    text = req.resolved_input()
    if text:
        return [ChatMessage(role="user", content=text)]
    return []


async def _memory_prefetch_events(
    user_text: str,
    preferences: Any,
    trace_id: str,
    session_id: str = "",
    priority_ids: list | None = None,
) -> tuple[str, list[dict[str, Any]]]:
    events: list[dict[str, Any]] = []
    agent_input = user_text
    if not preferences.chat_memory_recall:
        return agent_input, events

    # Phase 3C: 从 companion state 读取 memory_tag_ids，作为 priority_ids 基础
    if priority_ids is None:
        try:
            from core.companion_state import get_companion_state
            companion = get_companion_state()
            priority_ids = companion.get("memory_tag_ids") or []
        except Exception:
            priority_ids = []

    memory_prefetch = await asyncio.to_thread(
        augment_input_with_memory, user_text,
        trace_id=trace_id,
        session_id=session_id or trace_id,
        priority_ids=priority_ids or None,
    )
    agent_input = str(memory_prefetch.get("input") or user_text)
    if memory_prefetch.get("hit_count"):
        ev = {
            "type": "memory_prefetch",
            "hit_count": memory_prefetch.get("hit_count"),
            "hit_ids": [hit.get("id") for hit in memory_prefetch.get("hits", [])],
        }
        update_trace_metadata(
            trace_id,
            {
                "memory_hit_count": ev["hit_count"],
                "memory_hit_ids": ev["hit_ids"],
            },
        )
        append_trace_event(trace_id, ev)
        events.append(ev)
    return agent_input, events


async def stream_planning_graph(
    user_input: str,
    api_key: str,
    thread_id: str,
) -> AsyncIterator[dict[str, Any]]:
    from agents.checkpoint import graph_run_config

    graph = get_planning_graph(api_key)
    config = graph_run_config(thread_id)
    yield {"type": "start", "graph_id": "planning", "input": user_input}
    async for chunk in graph.astream({"input": user_input, "plan": [], "past_steps": [], "response": ""}, config=config, stream_mode="updates"):
        for node_name, update in chunk.items():
            if not isinstance(update, dict):
                continue
            if update.get("plan"):
                yield {
                    "type": "decision",
                    "next_agent": "planner",
                    "guidance": str(update.get("plan")),
                    "completed_agents": [],
                }
            if update.get("response"):
                yield {
                    "type": "final",
                    "response": str(update["response"]),
                    "completed_agents": ["planning"],
                    "graph_id": "planning",
                }


async def stream_lobster_graph(user_input: str, thread_id: str) -> AsyncIterator[dict[str, Any]]:
    from agents.checkpoint import graph_run_config
    from agents.lobster_bot import build_lobster_graph

    graph = build_lobster_graph()
    config = graph_run_config(thread_id)
    initial = {
        "messages": [HumanMessage(content=user_input)],
        "trend_platforms": ["bilibili", "douyin", "xiaohongshu"],
        "publish_platforms": [],
        "limit": 8,
        "trending_data": {},
        "top_topics": [],
        "generated_content": "",
        "generated_title": "",
        "generated_media_path": "",
        "target_node": "auto",
        "publish_results": [],
        "final_report": "",
    }
    yield {"type": "start", "graph_id": "lobster", "input": user_input}
    async for chunk in graph.astream(initial, config=config, stream_mode="updates"):
        for node_name, update in chunk.items():
            if not isinstance(update, dict):
                continue
            yield {
                "type": "agent_result",
                "agent_id": node_name,
                "content": str(update.get("final_report") or update.get("analysis") or node_name),
                "completed_agents": [node_name],
            }
            if update.get("final_report"):
                yield {
                    "type": "final",
                    "response": str(update["final_report"]),
                    "completed_agents": ["lobster"],
                    "graph_id": "lobster",
                }


async def stream_agent_chat(
    req: ChatRequest,
    *,
    api_key: str = "",
    trace_id: str,
) -> AsyncIterator[dict[str, Any]]:
    route = select_graph(req)
    provider = get_provider_id()
    model = get_current_model()
    user_text = req.resolved_input()

    yield metadata_event(
        trace_id=trace_id,
        graph_id=route.graph_id,
        provider=provider,
        model=model,
        mode=req.mode,
        agent_id=route.agent_id,
    )
    gs = graph_selected_event(route)
    append_trace_event(trace_id, gs)
    yield gs
    selected_assistant = get_by_agent_id(route.agent_id)
    if selected_assistant:
        assistant_event = {
            "type": "assistant_selected",
            "agent_id": route.agent_id,
            "assistant": selected_assistant.to_dict(),
            "reason": route.reason,
            "confidence": route.confidence,
        }
        append_trace_event(trace_id, assistant_event)
        yield assistant_event

    agent_input, mem_events = await _memory_prefetch_events(
        user_text, req.preferences, trace_id,
        session_id=req.thread_id or trace_id,
    )
    for ev in mem_events:
        yield ev

    ws_ctx = req.workspace_context.to_state_dict()
    agent_input = augment_input_with_workspace(agent_input, ws_ctx)

    append_trace_event(trace_id, {"type": "start", "input": user_text, "graph_id": route.graph_id})

    if route.graph_id == "chat":
        async for event in stream_chat_graph(
            messages=_resolve_chat_messages(req),
            preferences=req.preferences,
            agent_id=route.agent_id,
            api_key=api_key,
        ):
            append_trace_event(trace_id, event)
            yield event
        return

    if route.graph_id == "planning":
        async for event in stream_planning_graph(agent_input, api_key, trace_id):
            append_trace_event(trace_id, event)
            yield event
        return

    if route.graph_id == "lobster":
        async for event in stream_lobster_graph(agent_input, trace_id):
            append_trace_event(trace_id, event)
            yield event
        return

    if route.graph_id == "claude_code":
        from services.claude_code_service import stream_claude_code

        ws_root = resolve_workspace_root(ws_ctx)
        with workspace_root_scope(ws_root):
            async for event in stream_claude_code(
                prompt=agent_input,
                workspace_root=ws_root,
                session_id=req.thread_id or trace_id,
            ):
                append_trace_event(trace_id, event)
                if event.get("type") == "message":
                    payload = event.get("payload") or {}
                    content = (
                        payload.get("content")
                        if isinstance(payload, dict)
                        else str(payload)
                    )
                    if content:
                        yield {
                            "type": "agent_result",
                            "agent_id": "claude_code",
                            "content": str(content)[:8000],
                            "completed_agents": ["claude_code"],
                        }
                elif event.get("type") == "permission_request":
                    yield event
                elif event.get("type") == "final":
                    yield {
                        "type": "final",
                        "response": str(event.get("response") or ""),
                        "completed_agents": ["claude_code"],
                        "graph_id": "claude_code",
                    }
                elif event.get("type") == "error":
                    yield event
                else:
                    yield event
        return

    # orchestrator
    ws_root = resolve_workspace_root(ws_ctx)
    with workspace_root_scope(ws_root):
        async for event in stream_multi_agent(
            agent_input,
            api_key,
            preferences=req.preferences.to_state_dict(),
            workspace_context=ws_ctx,
            thread_id=trace_id,
            use_publish_pipeline=route.use_publish_pipeline,
        ):
            append_trace_event(trace_id, event)
            yield event


async def invoke_agent_chat(req: ChatRequest, *, api_key: str = "", trace_id: str = "") -> dict[str, Any]:
    route = select_graph(req)
    user_text = req.resolved_input()
    agent_input = user_text
    if req.preferences.chat_memory_recall:
        prefetch = await asyncio.to_thread(
            augment_input_with_memory, user_text,
            trace_id=trace_id or "",
            session_id=req.thread_id or trace_id or "",
        )
        agent_input = str(prefetch.get("input") or user_text)

    ws_ctx = req.workspace_context.to_state_dict()
    agent_input = augment_input_with_workspace(agent_input, ws_ctx)

    if route.graph_id == "chat":
        return await invoke_chat_graph(
            messages=_resolve_chat_messages(req),
            preferences=req.preferences,
            agent_id=route.agent_id,
            api_key=api_key,
        )
    if route.graph_id == "planning":
        graph = get_planning_graph(api_key)
        from agents.checkpoint import graph_run_config

        result = await graph.ainvoke(
            {"input": agent_input, "plan": [], "past_steps": [], "response": ""},
            config=graph_run_config(trace_id or "planning-sync"),
        )
        return {"response": result.get("response", ""), "completed_agents": ["planning"], "graph_id": "planning"}
    if route.graph_id == "lobster":
        graph = build_lobster_graph()
        result = await graph.ainvoke(
            {
                "messages": [HumanMessage(content=agent_input)],
                "trend_platforms": ["bilibili", "douyin", "xiaohongshu"],
                "publish_platforms": [],
                "limit": 8,
                "trending_data": {},
                "top_topics": [],
                "generated_content": "",
                "generated_title": "",
                "generated_media_path": "",
                "target_node": "auto",
                "publish_results": [],
                "final_report": "",
            }
        )
        return {
            "response": result.get("final_report") or "",
            "completed_agents": ["lobster"],
            "graph_id": "lobster",
        }

    ws_root = resolve_workspace_root(ws_ctx)
    with workspace_root_scope(ws_root):
        return await invoke_multi_agent(
            agent_input,
            api_key,
            preferences=req.preferences.to_state_dict(),
            workspace_context=ws_ctx,
            thread_id=trace_id,
            use_publish_pipeline=route.use_publish_pipeline,
        )


def create_chat_trace(req: ChatRequest) -> str:
    return create_trace(
        "agent_chat",
        req.resolved_input(),
        metadata={
            "mode": req.mode,
            "graph_hint": req.graph_hint,
            "provider": get_provider_id(),
            "model": get_current_model(),
        },
    )


def after_chat_turn(req: ChatRequest, response: str, trace_id: str) -> None:
    get_memory_coordinator().after_turn(req.resolved_input(), response, trace_id=trace_id)
