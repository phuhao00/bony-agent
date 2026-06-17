"""Persistence for customer-service workspaces and chat sessions."""

from __future__ import annotations

import json
import os
import re
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional

from utils.logger import setup_logger

logger = setup_logger("customer_service_store")

PROJECT_ROOT = Path(__file__).resolve().parents[2]
CS_ROOT = PROJECT_ROOT / "storage" / "customer_service"
WORKSPACES_FILE = CS_ROOT / "workspaces.json"
SESSIONS_DIR = CS_ROOT / "sessions"
CONFIG_FILE = CS_ROOT / "config.json"
FEEDBACK_FILE = CS_ROOT / "feedback_drafts.json"
DEFAULT_WORKSPACE_ID = "mod-customer-service"

WORKSPACE_DEFAULTS: Dict[str, Any] = {
    "icon": "✦",
    "slug": "",
    "enabled": True,
    "is_default": False,
    "knowledge_categories": [],
    "suggested_questions": [],
    "topic_groups": [],
    "retrieval_mode": "hybrid",
    "top_k": 5,
    "temperature": 0.35,
}

ChatMode = Literal["agent", "faq_only"]

CS_ROOT.mkdir(parents=True, exist_ok=True)
SESSIONS_DIR.mkdir(parents=True, exist_ok=True)


def _now() -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S")


def _read_json(path: Path, default: Any) -> Any:
    if not path.is_file():
        return default
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as exc:
        logger.warning("read json failed %s: %s", path, exc)
        return default


def _write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def get_chat_mode() -> ChatMode:
    cfg = _read_json(CONFIG_FILE, {})
    mode = (cfg.get("mode") or "agent").strip().lower()
    return "faq_only" if mode == "faq_only" else "agent"


def set_chat_mode(mode: str) -> ChatMode:
    normalized: ChatMode = "faq_only" if (mode or "").strip().lower() == "faq_only" else "agent"
    _write_json(CONFIG_FILE, {"mode": normalized, "updated_at": _now()})
    return normalized


def save_feedback_draft(
    *,
    session_id: str,
    user_message: str,
    correction: str,
    turn_index: Optional[int] = None,
    workspace_id: str = "",
) -> Dict[str, Any]:
    rows = _read_json(FEEDBACK_FILE, [])
    if not isinstance(rows, list):
        rows = []
    draft_id = str(uuid.uuid4())
    row = {
        "id": draft_id,
        "session_id": session_id,
        "workspace_id": workspace_id,
        "user_message": (user_message or "").strip()[:2000],
        "correction": (correction or "").strip()[:8000],
        "turn_index": turn_index,
        "status": "pending",
        "created_at": _now(),
    }
    rows.append(row)
    _write_json(FEEDBACK_FILE, rows[-200:])
    return row


def get_active_workspace_id() -> str:
    cfg = _read_json(CONFIG_FILE, {})
    active = (cfg.get("active_workspace_id") or "").strip()
    if active:
        ws = get_workspace(active)
        if ws and ws.get("enabled", True):
            return active
    for row in list_workspaces():
        if row.get("is_default") and row.get("enabled", True):
            return str(row.get("id") or "")
    for row in list_workspaces():
        if row.get("enabled", True):
            return str(row.get("id") or "")
    return ""


def set_active_workspace_id(workspace_id: str) -> None:
    cfg = _read_json(CONFIG_FILE, {})
    cfg["active_workspace_id"] = workspace_id
    cfg["updated_at"] = _now()
    _write_json(CONFIG_FILE, cfg)


def _normalize_workspace_row(row: Dict[str, Any]) -> Dict[str, Any]:
    out = {**WORKSPACE_DEFAULTS, **row}
    out["knowledge_doc_ids"] = list(out.get("knowledge_doc_ids") or [])
    out["knowledge_categories"] = [
        str(c).strip() for c in (out.get("knowledge_categories") or []) if str(c).strip()
    ]
    out["suggested_questions"] = [
        str(q).strip() for q in (out.get("suggested_questions") or []) if str(q).strip()
    ]
    groups = out.get("topic_groups") or []
    out["topic_groups"] = groups if isinstance(groups, list) else []
    out["enabled"] = out.get("enabled") is not False
    out["is_default"] = bool(out.get("is_default"))
    return out


def bootstrap_if_empty(*, seed_doc_ids: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    rows = list_workspaces()
    if rows:
        return rows
    row = _normalize_workspace_row({
        "id": DEFAULT_WORKSPACE_ID,
        "name": "默认客服助手",
        "description": "通用智能客服，绑定知识库后可服务任意领域",
        "domain": "通用",
        "system_prompt": (
            "你是专业、可靠的 AI 客服助手。请优先依据知识库回答；"
            "若无相关内容，请诚实说明并引导用户补充信息。"
        ),
        "welcome_message": "你好，需要什么帮助？",
        "knowledge_doc_ids": list(seed_doc_ids or []),
        "is_default": True,
        "icon": "✦",
    })
    _write_json(WORKSPACES_FILE, [row])
    set_active_workspace_id(row["id"])
    return [row]


def ensure_default_workspace(*, knowledge_doc_ids: Optional[List[str]] = None) -> Dict[str, Any]:
    """Backward-compatible helper: bootstrap and optionally merge FAQ doc ids."""
    bootstrap_if_empty(seed_doc_ids=knowledge_doc_ids)
    active_id = get_active_workspace_id() or DEFAULT_WORKSPACE_ID
    existing = get_workspace(active_id) or get_workspace(DEFAULT_WORKSPACE_ID)
    if not existing:
        return bootstrap_if_empty(seed_doc_ids=knowledge_doc_ids)[0]
    if knowledge_doc_ids:
        current = set(existing.get("knowledge_doc_ids") or [])
        merged = sorted(current | set(knowledge_doc_ids))
        if merged != list(existing.get("knowledge_doc_ids") or []):
            updated = update_workspace(existing["id"], {"knowledge_doc_ids": merged})
            return updated or existing
    return existing


def normalize_workspace(row: Dict[str, Any]) -> Dict[str, Any]:
    return _normalize_workspace_row(row)


def list_workspaces() -> List[Dict[str, Any]]:
    rows = _read_json(WORKSPACES_FILE, [])
    if not isinstance(rows, list):
        return []
    return [normalize_workspace(r) for r in rows if isinstance(r, dict)]


def get_workspace(workspace_id: str) -> Optional[Dict[str, Any]]:
    for row in list_workspaces():
        if row.get("id") == workspace_id:
            return row
    return None


def create_workspace(
    *,
    name: str,
    description: str = "",
    domain: str = "",
    system_prompt: str = "",
    welcome_message: str = "",
    knowledge_doc_ids: Optional[List[str]] = None,
    knowledge_categories: Optional[List[str]] = None,
    suggested_questions: Optional[List[str]] = None,
    topic_groups: Optional[List[Dict[str, Any]]] = None,
    icon: str = "✦",
    slug: str = "",
    enabled: bool = True,
    is_default: bool = False,
    retrieval_mode: str = "hybrid",
    top_k: int = 5,
    temperature: float = 0.35,
) -> Dict[str, Any]:
    ws_id = str(uuid.uuid4())
    row = _normalize_workspace_row({
        "id": ws_id,
        "name": (name or "未命名客服").strip()[:120],
        "description": (description or "").strip()[:2000],
        "domain": (domain or "").strip()[:120],
        "system_prompt": (system_prompt or "").strip()[:8000],
        "welcome_message": (welcome_message or "").strip()[:500],
        "knowledge_doc_ids": list(knowledge_doc_ids or []),
        "knowledge_categories": list(knowledge_categories or []),
        "suggested_questions": list(suggested_questions or []),
        "topic_groups": list(topic_groups or []),
        "icon": (icon or "✦").strip()[:8],
        "slug": (slug or "").strip()[:64],
        "enabled": enabled,
        "is_default": is_default,
        "retrieval_mode": retrieval_mode if retrieval_mode in ("faq", "rag", "hybrid") else "hybrid",
        "top_k": max(1, min(12, int(top_k))),
        "temperature": max(0.0, min(1.0, float(temperature))),
        "created_at": _now(),
        "updated_at": _now(),
    })
    rows = list_workspaces()
    if is_default:
        for i, existing in enumerate(rows):
            rows[i] = {**existing, "is_default": False}
    rows.append(row)
    _write_json(WORKSPACES_FILE, rows)
    if is_default or len(rows) == 1:
        set_active_workspace_id(ws_id)
    return row


def update_workspace(workspace_id: str, patch: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    rows = list_workspaces()
    updated: Optional[Dict[str, Any]] = None
    make_default = bool(patch.get("is_default"))
    for i, row in enumerate(rows):
        if row.get("id") != workspace_id:
            if make_default:
                rows[i] = {**row, "is_default": False}
            continue
        merged = {**row}
        for key, val in patch.items():
            if key in ("id", "created_at"):
                continue
            merged[key] = val
        merged = _normalize_workspace_row(merged)
        merged["id"] = workspace_id
        merged["created_at"] = row.get("created_at") or _now()
        merged["updated_at"] = _now()
        rows[i] = merged
        updated = merged
    if updated is None:
        return None
    _write_json(WORKSPACES_FILE, rows)
    if make_default:
        set_active_workspace_id(workspace_id)
    return updated


def delete_workspace(workspace_id: str) -> bool:
    rows = list_workspaces()
    new_rows = [r for r in rows if r.get("id") != workspace_id]
    if len(new_rows) == len(rows):
        return False
    if not new_rows:
        _write_json(WORKSPACES_FILE, [])
        _write_json(CONFIG_FILE, {"mode": get_chat_mode(), "updated_at": _now()})
        return True
    if not any(r.get("is_default") for r in new_rows):
        new_rows[0] = {**new_rows[0], "is_default": True}
    active = get_active_workspace_id()
    if active == workspace_id:
        default = next((r for r in new_rows if r.get("is_default")), new_rows[0])
        set_active_workspace_id(str(default.get("id") or ""))
    _write_json(WORKSPACES_FILE, new_rows)
    return True


def _session_path(session_id: str) -> Path:
    safe = re.sub(r"[^a-zA-Z0-9_-]", "", session_id or "")
    return SESSIONS_DIR / f"{safe or 'unknown'}.json"


def get_session(session_id: str) -> Dict[str, Any]:
    data = _read_json(_session_path(session_id), {})
    if not isinstance(data, dict):
        return {"session_id": session_id, "workspace_id": "", "messages": []}
    data.setdefault("session_id", session_id)
    data.setdefault("messages", [])
    return data


def save_session(session: Dict[str, Any]) -> None:
    sid = session.get("session_id") or str(uuid.uuid4())
    session["session_id"] = sid
    session["updated_at"] = _now()
    _write_json(_session_path(sid), session)


def append_session_message(
    session_id: str,
    *,
    workspace_id: str,
    role: str,
    content: str,
    metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    session = get_session(session_id) if session_id else {"session_id": "", "messages": []}
    if not session.get("session_id"):
        session["session_id"] = str(uuid.uuid4())
    session["workspace_id"] = workspace_id
    messages = list(session.get("messages") or [])
    messages.append({
        "role": role,
        "content": content,
        "metadata": metadata or {},
        "turn_index": len(messages),
        "created_at": _now(),
    })
    session["messages"] = messages[-40:]
    save_session(session)
    return session


def clear_session(session_id: str) -> None:
    path = _session_path(session_id)
    if path.is_file():
        path.unlink()
