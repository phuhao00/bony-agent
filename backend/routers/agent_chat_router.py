"""FastAPI routes for unified LangGraph agent chat."""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from fastapi import HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from agents.chat_request import ChatMessage, ChatPreferences, ChatRequest, WorkspaceContext
from agents.chat_service import (
    after_chat_turn,
    create_chat_trace,
    invoke_agent_chat,
    stream_agent_chat,
)
from agents.sse_adapter import format_sse_event
from core.llm_provider import get_api_key, get_current_model, get_provider_id
from utils.logger import setup_logger
from utils.trace_store import append_trace_event, finalize_trace

logger = setup_logger("agent_chat_router")


def _exception_detail(exc: BaseException) -> str:
    """Return a human-readable, non-empty exception description for SSE/HTTP errors."""
    msg = str(exc).strip()
    class_name = type(exc).__name__
    if msg:
        return f"{class_name}: {msg}"
    if isinstance(exc, TimeoutError):
        return (
            "Agent execution timed out. "
            "The selected operation took too long — try again with a shorter request, "
            "or verify that the model/provider is responsive."
        )
    return f"{class_name}: an unexpected error occurred (no additional details available)."


def _record_trace_reflection(trace_id: str) -> None:
    if not trace_id:
        return
    try:
        from services.reflection_loop import reflect_trace

        reflect_trace(trace_id)
    except Exception as exc:
        logger.warning("Trace reflection skipped for %s: %s", trace_id, exc)


class AgentChatMessage(BaseModel):
    role: str
    content: str


class AgentChatRequestBody(BaseModel):
    messages: List[AgentChatMessage] = Field(default_factory=list)
    input: Optional[str] = None
    preferences: Optional[Dict[str, Any]] = None
    workspace_context: Optional[Dict[str, Any]] = None
    agent_id: Optional[str] = None
    graph_hint: str = "auto"
    mode: str = "multi"
    thread_id: Optional[str] = None
    stream: bool = True


def to_chat_request(body: AgentChatRequestBody) -> ChatRequest:
    return ChatRequest(
        messages=[ChatMessage(role=m.role, content=m.content) for m in body.messages],
        input=body.input,
        preferences=ChatPreferences.from_camel(body.preferences),
        workspace_context=WorkspaceContext.from_raw(body.workspace_context),
        agent_id=body.agent_id,
        graph_hint=body.graph_hint,  # type: ignore[arg-type]
        mode="multi",
        thread_id=body.thread_id,
        stream=body.stream,
    )


def legacy_multi_to_chat(input_text: str, agent_id: Optional[str] = None, preferences: Optional[dict] = None) -> ChatRequest:
    return ChatRequest(
        input=input_text,
        agent_id=agent_id,
        mode="multi",
        preferences=ChatPreferences.from_camel(preferences),
    )


async def api_agent_chat_invoke(body: AgentChatRequestBody) -> dict:
    req = to_chat_request(body)
    trace_id = body.thread_id or create_chat_trace(req)
    try:
        result = await invoke_agent_chat(req, api_key=get_api_key() or "", trace_id=trace_id)
        finalize_trace(
            trace_id,
            status="completed",
            final_response=str(result.get("response") or ""),
            metadata_updates={"completed_agents": result.get("completed_agents") or [], "graph_id": result.get("graph_id")},
        )
        _record_trace_reflection(trace_id)
        after_chat_turn(req, str(result.get("response") or ""), trace_id)
        result["provider"] = get_provider_id()
        result["model"] = get_current_model()
        result["trace_id"] = trace_id
        return result
    except Exception as exc:
        detail = _exception_detail(exc)
        append_trace_event(trace_id, {"type": "error", "detail": detail})
        finalize_trace(trace_id, status="failed", error=detail)
        _record_trace_reflection(trace_id)
        logger.error("agent chat invoke failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=detail) from exc


async def api_agent_chat_stream(body: AgentChatRequestBody) -> StreamingResponse:
    req = to_chat_request(body)
    trace_id = body.thread_id or create_chat_trace(req)
    api_key = get_api_key() or ""

    async def event_generator():
        final_response = ""
        completed_agents: List[str] = []
        try:
            async for event in stream_agent_chat(req, api_key=api_key, trace_id=trace_id):
                if event.get("type") == "final":
                    final_response = str(event.get("response") or "")
                if event.get("completed_agents"):
                    completed_agents = list(event.get("completed_agents") or [])
                yield format_sse_event(event)
            finalize_trace(
                trace_id,
                status="completed",
                final_response=final_response,
                metadata_updates={"completed_agents": completed_agents},
            )
            _record_trace_reflection(trace_id)
            after_chat_turn(req, final_response, trace_id)
            yield format_sse_event({"type": "done"})
        except Exception as exc:
            detail = _exception_detail(exc)
            append_trace_event(trace_id, {"type": "error", "detail": detail})
            finalize_trace(trace_id, status="failed", error=detail)
            _record_trace_reflection(trace_id)
            yield format_sse_event({"type": "error", "detail": detail})

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
