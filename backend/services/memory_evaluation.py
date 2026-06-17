"""Memory recall and outcome tracking for evaluation and curation."""

from __future__ import annotations

import json
import threading
import uuid
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from services.learning_data_pipeline import append_event
from utils.logger import setup_logger

logger = setup_logger("memory_evaluation")

PROJECT_ROOT = Path(__file__).resolve().parents[2]
MEMORY_USAGE_FILE = PROJECT_ROOT / "storage" / "evolution" / "memory_usage.jsonl"
_LOCK = threading.RLock()

POSITIVE_OUTCOMES = {"upvote", "thumbs_up", "useful", "used"}
NEGATIVE_OUTCOMES = {"downvote", "thumbs_down", "rejected", "stale", "wrong"}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _append(row: Dict[str, Any], path: Optional[Path] = None) -> Dict[str, Any]:
    path = path or MEMORY_USAGE_FILE
    payload = {"id": str(uuid.uuid4()), "created_at": _now_iso(), **row}
    path.parent.mkdir(parents=True, exist_ok=True)
    with _LOCK:
        with path.open("a", encoding="utf-8") as file:
            file.write(json.dumps(payload, ensure_ascii=False) + "\n")
    return payload


def record_recall(
    *,
    memory_id: str,
    query: str,
    trace_id: str = "",
    session_id: str = "",
    source: str = "memory_coordinator",
    rank: int = 0,
    metadata: Optional[Dict[str, Any]] = None,
    path: Optional[Path] = None,
) -> Dict[str, Any]:
    memory_id = (memory_id or "").strip()
    if not memory_id:
        raise ValueError("memory_id is required")
    event = _append(
        {
            "kind": "recall",
            "memory_id": memory_id,
            "query": (query or "")[:500],
            "trace_id": trace_id or "",
            "session_id": session_id or "",
            "source": source or "memory_coordinator",
            "rank": max(0, int(rank or 0)),
            "outcome": "pending",
            "metadata": metadata or {},
        },
        path=path,
    )
    try:
        append_event(
            "memory_recall",
            session_id=session_id,
            trace_id=trace_id,
            source=source,
            action="record_recall",
            summary=f"memory recalled: {memory_id}",
            metadata={"memory_id": memory_id, "rank": rank, **(metadata or {})},
        )
    except Exception as exc:
        logger.warning("Failed to append memory recall evaluation event: %s", exc)
    return event


def record_outcome(
    *,
    memory_id: str,
    outcome: str,
    trace_id: str = "",
    source: str = "user",
    comment: str = "",
    metadata: Optional[Dict[str, Any]] = None,
    path: Optional[Path] = None,
) -> Dict[str, Any]:
    memory_id = (memory_id or "").strip()
    normalized = (outcome or "").strip().lower()
    if not memory_id:
        raise ValueError("memory_id is required")
    if not normalized:
        raise ValueError("outcome is required")
    polarity = "positive" if normalized in POSITIVE_OUTCOMES else "negative" if normalized in NEGATIVE_OUTCOMES else "neutral"
    return _append(
        {
            "kind": "outcome",
            "memory_id": memory_id,
            "query": "",
            "trace_id": trace_id or "",
            "session_id": "",
            "source": source or "user",
            "rank": 0,
            "outcome": normalized,
            "polarity": polarity,
            "comment": comment or "",
            "metadata": metadata or {},
        },
        path=path,
    )


def list_memory_usage(
    *,
    memory_id: Optional[str] = None,
    trace_id: Optional[str] = None,
    kind: Optional[str] = None,
    limit: int = 200,
    path: Optional[Path] = None,
) -> List[Dict[str, Any]]:
    path = path or MEMORY_USAGE_FILE
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
                    logger.warning("Skipping invalid memory usage line")
                    continue
                if memory_id and row.get("memory_id") != memory_id:
                    continue
                if trace_id and row.get("trace_id") != trace_id:
                    continue
                if kind and row.get("kind") != kind:
                    continue
                rows.append(row)
    rows.sort(key=lambda item: item.get("created_at") or "", reverse=True)
    return rows[: max(1, min(int(limit or 200), 1000))]


def summarize_memory_usage(memory_ids: Optional[List[str]] = None, *, path: Optional[Path] = None) -> Dict[str, Dict[str, int]]:
    wanted = set(memory_ids or [])
    summary: Dict[str, Counter] = defaultdict_counter()
    for row in list_memory_usage(limit=1000, path=path):
        memory_id = row.get("memory_id") or ""
        if not memory_id or (wanted and memory_id not in wanted):
            continue
        bucket = summary[memory_id]
        if row.get("kind") == "recall":
            bucket["recalls"] += 1
        elif row.get("kind") == "outcome":
            if row.get("polarity") == "positive":
                bucket["positive"] += 1
            elif row.get("polarity") == "negative":
                bucket["negative"] += 1
            else:
                bucket["neutral"] += 1
    return {memory_id: dict(counts) for memory_id, counts in summary.items()}


def _media_refs_from_metadata(metadata: Dict[str, Any]) -> List[str]:
    refs: List[str] = []
    for key in ("media_url", "media_urls", "image_url", "image_urls", "thumbnail_url", "artifact_ref"):
        value = metadata.get(key)
        if isinstance(value, str) and value.strip():
            refs.append(value.strip())
        elif isinstance(value, list):
            refs.extend(str(item).strip() for item in value if str(item).strip())
    return list(dict.fromkeys(refs))


def list_memory_hit_records(
    *,
    memory_id: Optional[str] = None,
    trace_id: Optional[str] = None,
    limit: int = 100,
    path: Optional[Path] = None,
    memories: Optional[List[Dict[str, Any]]] = None,
) -> List[Dict[str, Any]]:
    """Return recall rows enriched with the recalled memory body and display metadata."""
    recall_rows = list_memory_usage(memory_id=memory_id, trace_id=trace_id, kind="recall", limit=limit, path=path)
    if not recall_rows:
        return []

    if memories is None:
        try:
            from utils.vector_store import get_vector_store

            store = get_vector_store()
            memories = store.get_all_memories() if store else []
        except Exception as exc:
            logger.warning("Failed to enrich memory recall rows: %s", exc)
            memories = []

    memory_by_id = {str(item.get("id") or ""): item for item in memories if item.get("id")}
    records: List[Dict[str, Any]] = []
    for row in recall_rows:
        recalled_id = str(row.get("memory_id") or "")
        usage_metadata = row.get("metadata") or {}
        snapshot = usage_metadata.get("memory_snapshot") if isinstance(usage_metadata, dict) else None
        snapshot = snapshot if isinstance(snapshot, dict) else {}
        current_memory = memory_by_id.get(recalled_id, {})
        current_store_joined = recalled_id in memory_by_id
        snapshot_available = bool(snapshot.get("content") or snapshot.get("metadata"))
        memory = current_memory or snapshot
        metadata = dict(memory.get("metadata") or {})
        missing_reason = ""
        if not current_store_joined:
            missing_reason = (
                "current_store_missing_snapshot_available"
                if snapshot_available
                else "not_found_in_current_memory_store"
            )
        records.append(
            {
                "id": row.get("id") or "",
                "created_at": row.get("created_at") or "",
                "memory_id": recalled_id,
                "query": row.get("query") or "",
                "trace_id": row.get("trace_id") or "",
                "session_id": row.get("session_id") or "",
                "source": row.get("source") or "",
                "rank": row.get("rank") or 0,
                "outcome": row.get("outcome") or "pending",
                "usage_metadata": usage_metadata,
                "memory": {
                    "id": recalled_id,
                    "content": memory.get("content") or "",
                    "metadata": metadata,
                    "missing": not current_store_joined,
                    "missing_reason": missing_reason,
                    "current_store_joined": current_store_joined,
                    "snapshot_available": snapshot_available,
                    "media_refs": _media_refs_from_metadata(metadata),
                },
            }
        )
    return records


def defaultdict_counter() -> Dict[str, Counter]:
    from collections import defaultdict

    return defaultdict(Counter)
