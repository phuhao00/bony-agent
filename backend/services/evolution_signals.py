"""Persistent preference and feedback signals for evolution loops."""

from __future__ import annotations

import json
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from services.learning_data_pipeline import append_event
from services.memory_evaluation import record_outcome
from utils.logger import setup_logger


logger = setup_logger("evolution_signals")

PROJECT_ROOT = Path(__file__).resolve().parents[2]
SIGNALS_FILE = PROJECT_ROOT / "storage" / "evolution" / "preference_signals.jsonl"
_LOCK = threading.Lock()

VALID_SIGNALS = {"upvote", "downvote", "thumbs_up", "thumbs_down", "comment", "useful", "rejected"}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _read_all(path: Optional[Path] = None) -> List[Dict[str, Any]]:
    path = path or SIGNALS_FILE
    if not path.exists():
        return []
    rows: List[Dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return rows


def append_signal(
    *,
    target_type: str,
    target_id: str,
    signal: str,
    comment: str = "",
    source: str = "user",
    trace_id: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
    path: Optional[Path] = None,
) -> Dict[str, Any]:
    path = path or SIGNALS_FILE
    target_type = (target_type or "").strip()
    target_id = (target_id or "").strip()
    normalized_signal = (signal or "").strip().lower()
    if not target_type:
        raise ValueError("target_type is required")
    if not target_id:
        raise ValueError("target_id is required")
    if normalized_signal not in VALID_SIGNALS:
        raise ValueError(f"unsupported signal: {signal}")

    event = {
        "id": str(uuid.uuid4()),
        "target_type": target_type,
        "target_id": target_id,
        "signal": normalized_signal,
        "comment": comment or "",
        "source": source or "user",
        "created_at": _now_iso(),
        "trace_id": trace_id,
        "metadata": metadata or {},
    }
    with _LOCK:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(event, ensure_ascii=False) + "\n")
    try:
        append_event(
            "feedback_signal",
            trace_id=trace_id,
            source=source or "user",
            action=normalized_signal,
            summary=comment or f"{normalized_signal} on {target_type}:{target_id}",
            metadata={
                "signal_id": event["id"],
                "target_type": target_type,
                "target_id": target_id,
                **(metadata or {}),
            },
        )
    except Exception as exc:
        logger.warning("Failed to append feedback learning event: %s", exc)
    if target_type == "memory":
        try:
            record_outcome(
                memory_id=target_id,
                outcome=normalized_signal,
                trace_id=trace_id or "",
                source=source or "user",
                comment=comment or "",
                metadata={"signal_id": event["id"], **(metadata or {})},
            )
        except Exception as exc:
            logger.warning("Failed to append memory outcome event: %s", exc)
    return event


def list_signals(
    *,
    target_type: Optional[str] = None,
    target_id: Optional[str] = None,
    limit: int = 200,
    path: Optional[Path] = None,
) -> List[Dict[str, Any]]:
    rows = _read_all(path)
    if target_type:
        rows = [row for row in rows if row.get("target_type") == target_type]
    if target_id:
        rows = [row for row in rows if row.get("target_id") == target_id]
    return list(reversed(rows[-max(1, min(limit, 1000)):]))


def summarize_signals(target_type: str, target_ids: List[str], path: Optional[Path] = None) -> Dict[str, Dict[str, int]]:
    wanted = set(target_ids)
    summary: Dict[str, Dict[str, int]] = {target_id: {"upvotes": 0, "downvotes": 0, "comments": 0} for target_id in wanted}
    for row in _read_all(path):
        if row.get("target_type") != target_type or row.get("target_id") not in wanted:
            continue
        bucket = summary.setdefault(row["target_id"], {"upvotes": 0, "downvotes": 0, "comments": 0})
        if row.get("signal") in {"upvote", "thumbs_up", "useful"}:
            bucket["upvotes"] += 1
        elif row.get("signal") in {"downvote", "thumbs_down", "rejected"}:
            bucket["downvotes"] += 1
        elif row.get("signal") == "comment":
            bucket["comments"] += 1
    return summary
