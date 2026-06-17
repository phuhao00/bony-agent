"""Workspace enrichment: knowledge binding, suggestions, stats."""

from __future__ import annotations

import random
from typing import Any, Dict, List, Optional

from services.customer_service_store import (
    bootstrap_if_empty,
    get_active_workspace_id,
    get_workspace,
    list_workspaces,
    set_active_workspace_id,
)
from utils.logger import setup_logger

logger = setup_logger("customer_service_workspace")

TopicGroup = Dict[str, Any]


def _resolve_knowledge_doc_ids(workspace: Dict[str, Any], rag_manager) -> List[str]:
    explicit = list(workspace.get("knowledge_doc_ids") or [])
    if not rag_manager:
        return explicit

    categories = [c.strip() for c in (workspace.get("knowledge_categories") or []) if c]
    if categories:
        cat_set = set(categories)
        for doc in rag_manager.get_documents_info():
            doc_id = doc.get("id")
            if not doc_id:
                continue
            doc_cat = (doc.get("category") or "uncategorized").strip()
            if doc_cat in cat_set and doc_id not in explicit:
                explicit.append(doc_id)

    return explicit


def _faq_items_for_workspace(workspace: Dict[str, Any], rag_manager) -> List[Dict[str, Any]]:
    if not rag_manager:
        return []
    items: List[Dict[str, Any]] = []
    doc_ids = _resolve_knowledge_doc_ids(workspace, rag_manager)
    for doc_id in doc_ids:
        if not rag_manager.is_faq_document(doc_id):
            continue
        faq = rag_manager.get_faq_document(doc_id)
        if not faq.get("success"):
            continue
        for item in faq.get("items") or []:
            q = (item.get("question") or "").strip()
            if q:
                items.append(item)
    return items


def count_faq_items(workspace: Dict[str, Any], rag_manager) -> int:
    return len(_faq_items_for_workspace(workspace, rag_manager))


def enrich_workspace(workspace: Dict[str, Any], rag_manager=None) -> Dict[str, Any]:
    """Return workspace copy with resolved knowledge_doc_ids and stats."""
    row = dict(workspace)
    resolved_ids = _resolve_knowledge_doc_ids(row, rag_manager)
    row["knowledge_doc_ids"] = resolved_ids
    row["knowledge_doc_count"] = len(resolved_ids)
    row["faq_item_count"] = count_faq_items(row, rag_manager) if rag_manager else 0
    return row


def derive_topic_groups(workspace: Dict[str, Any], rag_manager=None) -> List[TopicGroup]:
    configured = workspace.get("topic_groups")
    if isinstance(configured, list) and configured:
        out: List[TopicGroup] = []
        for i, group in enumerate(configured):
            if not isinstance(group, dict):
                continue
            questions = [str(q).strip() for q in (group.get("questions") or []) if str(q).strip()]
            if not questions:
                continue
            out.append({
                "id": str(group.get("id") or f"group-{i}"),
                "icon": str(group.get("icon") or "💬"),
                "title": str(group.get("title") or "常见问题"),
                "questions": questions[:8],
            })
        if out:
            return out

    suggested = [str(q).strip() for q in (workspace.get("suggested_questions") or []) if str(q).strip()]
    if suggested:
        return [{
            "id": "suggested",
            "icon": "💬",
            "title": "常见问题",
            "questions": suggested[:12],
        }]

    faq_items = _faq_items_for_workspace(workspace, rag_manager)
    if faq_items:
        sample = faq_items[:40]
        if len(sample) > 8:
            random.shuffle(sample)
        questions = [(item.get("question") or "").strip() for item in sample[:8]]
        questions = [q for q in questions if q]
        if questions:
            return [{
                "id": "from-knowledge",
                "icon": "📚",
                "title": "来自知识库",
                "questions": questions,
            }]

    welcome = (workspace.get("welcome_message") or "").strip()
    domain = (workspace.get("domain") or workspace.get("name") or "本领域").strip()
    return [{
        "id": "starter",
        "icon": "✨",
        "title": "开始提问",
        "questions": [
            f"{domain}有哪些常见问题？",
            f"请介绍一下{domain}相关服务",
            welcome or "我需要一些帮助",
        ][:3],
    }]


def resolve_workspace(workspace_id: Optional[str] = None, *, rag_manager=None) -> Dict[str, Any]:
    bootstrap_if_empty()
    wid = (workspace_id or "").strip() or get_active_workspace_id()
    ws = get_workspace(wid) if wid else None
    if not ws or ws.get("enabled") is False:
        enabled = [w for w in list_workspaces() if w.get("enabled", True)]
        ws = enabled[0] if enabled else None
    if not ws:
        raise ValueError("没有可用的客服实例，请先创建一个 workspace")
    return enrich_workspace(ws, rag_manager)


def list_workspaces_enriched(rag_manager=None) -> List[Dict[str, Any]]:
    bootstrap_if_empty()
    active = get_active_workspace_id()
    rows = []
    for ws in list_workspaces():
        if ws.get("enabled") is False:
            continue
        enriched = enrich_workspace(ws, rag_manager)
        enriched["is_active"] = enriched.get("id") == active
        rows.append(enriched)
    return rows


def activate_workspace(workspace_id: str) -> Dict[str, Any]:
    ws = get_workspace(workspace_id)
    if not ws:
        raise ValueError("workspace not found")
    if ws.get("enabled") is False:
        raise ValueError("workspace is disabled")
    set_active_workspace_id(workspace_id)
    return {"active_workspace_id": workspace_id}
