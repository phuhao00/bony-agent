"""FastAPI routes for Claude Code streaming integration."""

from __future__ import annotations

from typing import Any, Optional

from fastapi import HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from agents.sse_adapter import format_sse_event
from services.claude_code_service import (
    get_health_status,
    list_workspace_slash_commands,
    respond_permission,
    stream_claude_code,
)
from utils.logger import setup_logger

logger = setup_logger("claude_code_router")


class ClaudeCodeStreamBody(BaseModel):
    prompt: str
    workspace_root: Optional[str] = None
    scope_type: str = "workspace"
    scope_path: Optional[str] = None
    scope_label: Optional[str] = None
    session_id: Optional[str] = None
    permission_mode: str = "default"
    model: Optional[str] = None


class ClaudeCodePermissionBody(BaseModel):
    permission_id: str
    allow: bool = True
    message: str = ""


async def api_claude_code_health() -> dict[str, Any]:
    return get_health_status()


async def api_claude_code_stream(body: ClaudeCodeStreamBody) -> StreamingResponse:
    prompt = (body.prompt or "").strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="prompt 不能为空")

    async def event_generator():
        try:
            async for event in stream_claude_code(
                prompt=prompt,
                workspace_root=body.workspace_root,
                scope_type=body.scope_type or "workspace",
                scope_path=body.scope_path,
                scope_label=body.scope_label,
                session_id=body.session_id,
                permission_mode=body.permission_mode or "default",
                model=body.model,
            ):
                yield format_sse_event(event)
            yield format_sse_event({"type": "done"})
        except Exception as exc:
            logger.error("claude-code stream error: %s", exc, exc_info=True)
            yield format_sse_event({"type": "error", "detail": str(exc)})
            yield format_sse_event({"type": "done"})

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


async def api_claude_code_permission(body: ClaudeCodePermissionBody) -> dict[str, Any]:
    ok = respond_permission(body.permission_id, body.allow, body.message)
    if not ok:
        raise HTTPException(status_code=404, detail="permission not found or already resolved")
    return {"ok": True, "permission_id": body.permission_id, "allow": body.allow}


async def api_claude_code_commands(workspace_root: Optional[str] = None) -> dict[str, Any]:
    return {"commands": list_workspace_slash_commands(workspace_root)}
