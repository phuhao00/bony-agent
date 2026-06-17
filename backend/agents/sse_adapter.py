"""SSE v2 event helpers for unified LangGraph chat stream."""

from __future__ import annotations

import json
from typing import Any, AsyncIterator, Iterator


def format_sse_event(payload: dict[str, Any]) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def metadata_event(
    *,
    trace_id: str,
    graph_id: str,
    provider: str,
    model: str,
    mode: str,
    agent_id: str | None = None,
) -> dict[str, Any]:
    return {
        "type": "metadata",
        "trace_id": trace_id,
        "graph_id": graph_id,
        "provider": provider,
        "model": model,
        "mode": mode,
        "agent_id": agent_id,
    }


def graph_selected_event(route: Any) -> dict[str, Any]:
    return {
        "type": "graph_selected",
        "graph_id": route.graph_id,
        "reason": route.reason,
        "confidence": route.confidence,
        "agent_id": route.agent_id,
        "use_publish_pipeline": route.use_publish_pipeline,
    }


async def wrap_sse_stream(events: AsyncIterator[dict[str, Any]]) -> AsyncIterator[str]:
    async for event in events:
        yield format_sse_event(event)
    yield format_sse_event({"type": "done"})


def iter_sse_strings(events: Iterator[dict[str, Any]]) -> Iterator[str]:
    for event in events:
        yield format_sse_event(event)
    yield format_sse_event({"type": "done"})
