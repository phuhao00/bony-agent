"""FastAPI routes for built-in AI customer service."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from core.llm_provider import get_api_key
from services.customer_service_engine import stream_customer_service_chat
from services.customer_service_store import (
    create_workspace,
    delete_workspace,
    get_active_workspace_id,
    get_chat_mode,
    get_session,
    get_workspace,
    save_feedback_draft,
    set_chat_mode,
    update_workspace,
)
from services.customer_service_workspace import (
    activate_workspace,
    derive_topic_groups,
    enrich_workspace,
    list_workspaces_enriched,
    resolve_workspace,
)
from utils.logger import setup_logger
from utils.rag_manager import get_rag_manager

logger = setup_logger("customer_service_router")


class ChatStreamBody(BaseModel):
    message: str = ""
    session_id: str = ""
    workspace_id: str = ""
    use_llm: bool = True
    structured_intent: bool = False
    top_k: Optional[int] = None


class ModeBody(BaseModel):
    mode: str = "agent"


class FeedbackBody(BaseModel):
    user_message: str = ""
    correction: str = ""
    turn_index: Optional[int] = None


class TopicGroupBody(BaseModel):
    id: str = ""
    icon: str = "💬"
    title: str = "常见问题"
    questions: List[str] = Field(default_factory=list)


class WorkspaceCreateBody(BaseModel):
    name: str
    description: str = ""
    domain: str = ""
    system_prompt: str = ""
    welcome_message: str = ""
    knowledge_doc_ids: List[str] = Field(default_factory=list)
    knowledge_categories: List[str] = Field(default_factory=list)
    suggested_questions: List[str] = Field(default_factory=list)
    topic_groups: List[TopicGroupBody] = Field(default_factory=list)
    icon: str = "✦"
    slug: str = ""
    enabled: bool = True
    is_default: bool = False
    retrieval_mode: str = "hybrid"
    top_k: int = 5
    temperature: float = 0.35


class WorkspaceUpdateBody(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    domain: Optional[str] = None
    system_prompt: Optional[str] = None
    welcome_message: Optional[str] = None
    knowledge_doc_ids: Optional[List[str]] = None
    knowledge_categories: Optional[List[str]] = None
    suggested_questions: Optional[List[str]] = None
    topic_groups: Optional[List[TopicGroupBody]] = None
    icon: Optional[str] = None
    slug: Optional[str] = None
    enabled: Optional[bool] = None
    is_default: Optional[bool] = None
    retrieval_mode: Optional[str] = None
    top_k: Optional[int] = None
    temperature: Optional[float] = None


class ActiveWorkspaceBody(BaseModel):
    workspace_id: str = ""


def _rag():
    return get_rag_manager(get_api_key() or None)


def _workspace_or_404(workspace_id: str) -> Dict[str, Any]:
    ws = get_workspace(workspace_id)
    if not ws:
        raise HTTPException(status_code=404, detail="客服实例不存在")
    return ws


def _resolve(workspace_id: str = "") -> Dict[str, Any]:
    try:
        return resolve_workspace(workspace_id or None, rag_manager=_rag())
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


async def api_cs_health(workspace_id: str = "") -> Dict[str, Any]:
    workspace = _resolve(workspace_id)
    return {
        "status": "ok",
        "workspace": workspace,
        "workspace_id": workspace.get("id"),
        "knowledge_doc_count": workspace.get("knowledge_doc_count", 0),
        "faq_item_count": workspace.get("faq_item_count", 0),
        "llm_enabled": bool(get_api_key()),
        "mode": get_chat_mode(),
        "active_workspace_id": get_active_workspace_id(),
    }


async def api_cs_list_workspaces() -> Dict[str, Any]:
    rows = list_workspaces_enriched(_rag())
    return {"workspaces": rows, "active_workspace_id": get_active_workspace_id()}


async def api_cs_create_workspace(body: WorkspaceCreateBody) -> Dict[str, Any]:
    row = create_workspace(
        name=body.name,
        description=body.description,
        domain=body.domain,
        system_prompt=body.system_prompt,
        welcome_message=body.welcome_message,
        knowledge_doc_ids=body.knowledge_doc_ids,
        knowledge_categories=body.knowledge_categories,
        suggested_questions=body.suggested_questions,
        topic_groups=[g.model_dump() for g in body.topic_groups],
        icon=body.icon,
        slug=body.slug,
        enabled=body.enabled,
        is_default=body.is_default,
        retrieval_mode=body.retrieval_mode,
        top_k=body.top_k,
        temperature=body.temperature,
    )
    return {"workspace": enrich_workspace(row, _rag())}


async def api_cs_get_workspace(workspace_id: str) -> Dict[str, Any]:
    ws = _workspace_or_404(workspace_id)
    topic_groups = derive_topic_groups(ws, _rag())
    return {
        "workspace": enrich_workspace(ws, _rag()),
        "topic_groups": topic_groups,
    }


async def api_cs_update_workspace(workspace_id: str, body: WorkspaceUpdateBody) -> Dict[str, Any]:
    _workspace_or_404(workspace_id)
    patch = body.model_dump(exclude_unset=True)
    if "topic_groups" in patch and patch["topic_groups"] is not None:
        patch["topic_groups"] = [
            (g.model_dump() if hasattr(g, "model_dump") else g) for g in patch["topic_groups"]
        ]
    updated = update_workspace(workspace_id, patch)
    if not updated:
        raise HTTPException(status_code=404, detail="客服实例不存在")
    return {"workspace": enrich_workspace(updated, _rag())}


async def api_cs_delete_workspace(workspace_id: str) -> Dict[str, Any]:
    if not delete_workspace(workspace_id):
        raise HTTPException(status_code=404, detail="客服实例不存在")
    return {"ok": True, "active_workspace_id": get_active_workspace_id()}


async def api_cs_get_active_workspace() -> Dict[str, Any]:
    wid = get_active_workspace_id()
    if not wid:
        rows = list_workspaces_enriched(_rag())
        return {"active_workspace_id": "", "workspace": rows[0] if rows else None}
    ws = get_workspace(wid)
    return {
        "active_workspace_id": wid,
        "workspace": enrich_workspace(ws, _rag()) if ws else None,
    }


async def api_cs_set_active_workspace(body: ActiveWorkspaceBody) -> Dict[str, Any]:
    try:
        result = activate_workspace(body.workspace_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    ws = get_workspace(body.workspace_id)
    return {
        **result,
        "workspace": enrich_workspace(ws, _rag()) if ws else None,
    }


async def api_cs_workspace_suggestions(workspace_id: str) -> Dict[str, Any]:
    ws = _workspace_or_404(workspace_id)
    groups = derive_topic_groups(ws, _rag())
    return {"workspace_id": workspace_id, "topic_groups": groups}


async def api_cs_get_mode() -> Dict[str, str]:
    return {"mode": get_chat_mode()}


async def api_cs_set_mode(body: ModeBody) -> Dict[str, str]:
    return {"mode": set_chat_mode(body.mode)}


async def api_cs_session_history(session_id: str) -> Dict[str, Any]:
    session = get_session(session_id)
    if not session.get("messages"):
        raise HTTPException(status_code=404, detail="Session not found")
    return {
        "session_id": session.get("session_id") or session_id,
        "workspace_id": session.get("workspace_id") or "",
        "messages": session.get("messages") or [],
    }


async def api_cs_session_feedback(session_id: str, body: FeedbackBody) -> Dict[str, Any]:
    correction = (body.correction or "").strip()
    if not correction:
        raise HTTPException(status_code=400, detail="correction 不能为空")

    session = get_session(session_id)
    if not session.get("session_id"):
        raise HTTPException(status_code=404, detail="Session not found")

    draft = save_feedback_draft(
        session_id=session_id,
        user_message=body.user_message,
        correction=correction,
        turn_index=body.turn_index,
        workspace_id=session.get("workspace_id") or get_active_workspace_id(),
    )
    return {"ok": True, "draft_id": draft["id"]}


async def api_cs_chat_stream(body: ChatStreamBody) -> StreamingResponse:
    workspace = _resolve(body.workspace_id)
    use_llm = bool(body.use_llm)

    async def event_generator():
        try:
            async for line in stream_customer_service_chat(
                workspace=workspace,
                message=body.message,
                session_id=body.session_id,
                use_llm=use_llm,
            ):
                yield line
        except Exception as exc:
            logger.error("customer service stream failed: %s", exc, exc_info=True)
            from services.customer_service_engine import _sse

            yield _sse("error", {"error": str(exc)})
            yield _sse("done", {})

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


router = APIRouter(prefix="/api/v1/ai-customer-service", tags=["AI客服"])

router.add_api_route("/health", api_cs_health, methods=["GET"])
router.add_api_route("/workspaces", api_cs_list_workspaces, methods=["GET"])
router.add_api_route("/workspaces", api_cs_create_workspace, methods=["POST"])
router.add_api_route("/workspaces/{workspace_id}", api_cs_get_workspace, methods=["GET"])
router.add_api_route("/workspaces/{workspace_id}", api_cs_update_workspace, methods=["PUT"])
router.add_api_route("/workspaces/{workspace_id}", api_cs_delete_workspace, methods=["DELETE"])
router.add_api_route("/workspaces/{workspace_id}/suggestions", api_cs_workspace_suggestions, methods=["GET"])
router.add_api_route("/config/active-workspace", api_cs_get_active_workspace, methods=["GET"])
router.add_api_route("/config/active-workspace", api_cs_set_active_workspace, methods=["POST"])
router.add_api_route("/config/mode", api_cs_get_mode, methods=["GET"])
router.add_api_route("/config/mode", api_cs_set_mode, methods=["POST"])
router.add_api_route("/chat/stream", api_cs_chat_stream, methods=["POST"])
router.add_api_route("/sessions/{session_id}/history", api_cs_session_history, methods=["GET"])
router.add_api_route("/sessions/{session_id}/feedback", api_cs_session_feedback, methods=["POST"])
