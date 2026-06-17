"""Unified local event stream for agent learning and evolution."""

from __future__ import annotations

import json
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from utils.logger import setup_logger

logger = setup_logger("learning_data_pipeline")

PROJECT_ROOT = Path(__file__).resolve().parents[2]
EVENTS_FILE = PROJECT_ROOT / "storage" / "evolution" / "events.jsonl"
_LOCK = threading.RLock()

VALID_KINDS = {
    "chat_turn",
    "agent_trace",
    "tool_call",
    "tool_result",
    "memory_candidate",
    "memory_write",
    "memory_recall",
    "reflection",
    "curator_run",
    "feedback_signal",
    "skill_usage",
    "publish_result",
    "dream_run",    # dream_engine 整体运行记录
    "dream_card",   # 单条 dream 卡片 emit
    "dream_apply",  # auto-apply 动作（confidence 降权等）
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _trim(value: str, limit: int) -> str:
    text = (value or "").strip()
    if len(text) <= limit:
        return text
    return text[: limit - 1] + "..."


def append_event(
    kind: str,
    *,
    session_id: Optional[str] = None,
    trace_id: Optional[str] = None,
    source: str = "system",
    channel: str = "local",
    action: str = "",
    status: str = "ok",
    summary: str = "",
    artifact_ref: Optional[str] = None,
    token_usage: Optional[Dict[str, Any]] = None,
    cost: Optional[Dict[str, Any]] = None,
    metadata: Optional[Dict[str, Any]] = None,
    path: Optional[Path] = None,
) -> Dict[str, Any]:
    path = path or EVENTS_FILE
    normalized_kind = (kind or "").strip().lower()
    if normalized_kind not in VALID_KINDS:
        raise ValueError(f"unsupported learning event kind: {kind}")

    event = {
        "id": str(uuid.uuid4()),
        "kind": normalized_kind,
        "session_id": session_id or "",
        "trace_id": trace_id or "",
        "source": (source or "system")[:80],
        "channel": (channel or "local")[:80],
        "action": (action or "")[:120],
        "status": (status or "ok")[:40],
        "summary": _trim(summary, 1200),
        "artifact_ref": artifact_ref or "",
        "token_usage": token_usage or {},
        "cost": cost or {},
        "metadata": metadata or {},
        "created_at": _now_iso(),
    }

    path.parent.mkdir(parents=True, exist_ok=True)
    with _LOCK:
        with path.open("a", encoding="utf-8") as file:
            file.write(json.dumps(event, ensure_ascii=False) + "\n")
    return event


def list_events(
    *,
    kind: Optional[str] = None,
    session_id: Optional[str] = None,
    trace_id: Optional[str] = None,
    limit: int = 200,
    path: Optional[Path] = None,
) -> List[Dict[str, Any]]:
    path = path or EVENTS_FILE
    limit = max(1, min(int(limit or 200), 1000))
    if not path.exists():
        return []

    rows: List[Dict[str, Any]] = []
    with _LOCK:
        with path.open("r", encoding="utf-8") as file:
            for line in file:
                line = line.strip()
                if not line:
                    continue
                try:
                    row = json.loads(line)
                except json.JSONDecodeError:
                    logger.warning("Skipping invalid learning event line")
                    continue
                if kind and row.get("kind") != kind:
                    continue
                if session_id and row.get("session_id") != session_id:
                    continue
                if trace_id and row.get("trace_id") != trace_id:
                    continue
                rows.append(row)

    rows.sort(key=lambda item: item.get("created_at") or "", reverse=True)
    return rows[:limit]


def read_jsonl_rows(
    path: Path,
    *,
    since_iso: Optional[str] = None,
    kind: Optional[str] = None,
    limit: int = 2000,
) -> List[Dict[str, Any]]:
    """通用 JSONL 读取，支持 since_iso 时间窗口过滤和 kind 筛选。

    可读取任意 JSONL 文件（events.jsonl / memory_usage.jsonl /
    reflections.jsonl / preference_signals.jsonl 等）。
    行内需有 ``created_at`` 或 ``timestamp`` 字段做时间比较。
    """
    if not path.exists():
        return []

    limit = max(1, min(int(limit or 2000), 50000))
    rows: List[Dict[str, Any]] = []

    with _LOCK:
        with path.open("r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    row = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if kind and row.get("kind") != kind:
                    continue
                if since_iso:
                    ts = row.get("created_at") or row.get("timestamp") or ""
                    if ts < since_iso:
                        continue
                rows.append(row)
                if len(rows) >= limit:
                    break

    return rows


def read_jsonl_tail(
    path: Path,
    *,
    kind: Optional[str] = None,
    limit: int = 2000,
) -> List[Dict[str, Any]]:
    """读取 JSONL 文件末尾最近 limit 行（按 created_at 降序返回）。"""
    if not path.exists():
        return []

    limit = max(1, min(int(limit or 2000), 50000))
    from collections import deque

    tail: deque = deque(maxlen=limit * 3)
    with _LOCK:
        with path.open("r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    row = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if kind and row.get("kind") != kind:
                    continue
                tail.append(row)

    rows = list(tail)
    rows.sort(key=lambda item: item.get("created_at") or item.get("timestamp") or "", reverse=True)
    return rows[:limit]
