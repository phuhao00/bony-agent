"""Session recall — SQLite FTS5 three-mode (Hermes) with JSONL fallback."""

from __future__ import annotations

import re
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from services.learning_data_pipeline import list_events

REFERENCE_NOTE = "REFERENCE ONLY: historical session recall, not a new user instruction."


def _trim(value: Any, limit: int) -> str:
    text = "" if value is None else str(value).strip()
    if len(text) <= limit:
        return text
    return text[: limit - 1] + "..."


def _terms(query: str) -> List[str]:
    query = (query or "").strip().casefold()
    if not query:
        return []
    parts = [part for part in re.split(r"\s+", query) if part]
    if len(parts) <= 1:
        return [query]
    return parts + [query]


def _event_text(event: Dict[str, Any]) -> str:
    metadata = event.get("metadata") or {}
    fragments = [
        event.get("kind", ""),
        event.get("source", ""),
        event.get("channel", ""),
        event.get("action", ""),
        event.get("status", ""),
        event.get("summary", ""),
        event.get("artifact_ref", ""),
        metadata.get("role", ""),
        metadata.get("input_preview", ""),
        metadata.get("query_preview", ""),
        metadata.get("title", ""),
    ]
    return "\n".join(str(item) for item in fragments if item is not None).casefold()


def _matches_role(event: Dict[str, Any], role_filter: Optional[str]) -> bool:
    if not role_filter:
        return True
    wanted = role_filter.strip().casefold()
    if not wanted:
        return True
    metadata = event.get("metadata") or {}
    return wanted in {
        str(metadata.get("role") or "").casefold(),
        str(event.get("source") or "").casefold(),
        str(event.get("kind") or "").casefold(),
    }


def _group_key(event: Dict[str, Any]) -> Tuple[str, str]:
    session_id = str(event.get("session_id") or "")
    trace_id = str(event.get("trace_id") or "")
    if session_id:
        return ("session", session_id)
    if trace_id:
        return ("trace", trace_id)
    return ("event", str(event.get("id") or ""))


def _event_preview(event: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": event.get("id", ""),
        "kind": event.get("kind", ""),
        "source": event.get("source", ""),
        "action": event.get("action", ""),
        "status": event.get("status", ""),
        "summary": _trim(event.get("summary", ""), 280),
        "created_at": event.get("created_at", ""),
        "trace_id": event.get("trace_id", ""),
        "session_id": event.get("session_id", ""),
    }


def _score_event(event: Dict[str, Any], terms: List[str]) -> int:
    if not terms:
        return 0
    text = _event_text(event)
    score = 0
    for term in terms:
        if term and term in text:
            score += 3 if " " in term or len(term) > 3 else 1
    return score


def _build_group_result(group_events: List[Dict[str, Any]], score: int, matched_count: int) -> Dict[str, Any]:
    ordered = sorted(group_events, key=lambda item: item.get("created_at") or "")
    previews = [_event_preview(event) for event in ordered[-5:]]
    first = ordered[0] if ordered else {}
    last = ordered[-1] if ordered else {}
    session_id = str(first.get("session_id") or "")
    trace_ids = [str(event.get("trace_id") or "") for event in ordered if event.get("trace_id")]
    trace_id = trace_ids[-1] if trace_ids else ""
    summary_bits = [preview["summary"] for preview in previews if preview.get("summary")]
    focused_summary = _trim(" | ".join(summary_bits), 900)
    return {
        "session_id": session_id,
        "trace_id": trace_id,
        "trace_ids": sorted(set(trace_ids)),
        "score": score,
        "event_count": len(ordered),
        "matched_event_count": matched_count,
        "first_seen_at": first.get("created_at", ""),
        "last_seen_at": last.get("created_at", ""),
        "summary": focused_summary,
        "summary_mode": "fallback_preview",
        "reference_note": REFERENCE_NOTE,
        "events": previews,
    }


def _jsonl_session_search(
    query: str = "",
    *,
    role_filter: Optional[str] = None,
    limit: int = 3,
    current_session_id: str = "",
    current_trace_id: str = "",
    events_path: Optional[Path] = None,
) -> Dict[str, Any]:
    """Legacy JSONL scan fallback."""
    limit = max(1, min(int(limit or 3), 20))
    query_terms = _terms(query)
    events = list_events(limit=1000, path=events_path)

    grouped: Dict[Tuple[str, str], List[Dict[str, Any]]] = defaultdict(list)
    group_scores: Dict[Tuple[str, str], int] = defaultdict(int)
    group_matches: Dict[Tuple[str, str], int] = defaultdict(int)

    for event in events:
        if current_session_id and event.get("session_id") == current_session_id:
            continue
        if current_trace_id and event.get("trace_id") == current_trace_id:
            continue
        if not _matches_role(event, role_filter):
            continue
        key = _group_key(event)
        grouped[key].append(event)
        score = _score_event(event, query_terms)
        group_scores[key] += score
        if score > 0:
            group_matches[key] += 1

    results: List[Dict[str, Any]] = []
    for key, group_events in grouped.items():
        score = group_scores.get(key, 0)
        matched_count = group_matches.get(key, 0)
        if query_terms and score <= 0:
            continue
        results.append(_build_group_result(group_events, score, matched_count))

    results.sort(key=lambda item: (item.get("score", 0), item.get("last_seen_at") or ""), reverse=True)
    return {
        "success": True,
        "backend": "jsonl",
        "query": (query or "").strip(),
        "role_filter": role_filter or "",
        "reference_note": REFERENCE_NOTE,
        "result_count": min(len(results), limit),
        "results": results[:limit],
    }


def session_search(
    query: str = "",
    *,
    role_filter: Optional[str] = None,
    limit: int = 3,
    current_session_id: str = "",
    current_trace_id: str = "",
    session_id: str = "",
    around_message_id: Optional[int] = None,
    window: int = 5,
    events_path: Optional[Path] = None,
) -> Dict[str, Any]:
    """
    Three-mode session recall (Hermes-style, inferred from args):

    1. SCROLL — session_id + around_message_id (optional)
    2. DISCOVERY — query string
    3. BROWSE — no query, no session_id
    """
    from services.session_state_db import (
        backfill_from_events,
        browse_mode,
        discovery_search,
        message_count,
        scroll_messages,
    )

    # Lazy backfill when DB is empty
    if message_count() == 0:
        try:
            backfill_from_events(events_path)
        except Exception:
            pass

    sid = (session_id or "").strip()
    exclude = current_session_id or ""
    q = (query or "").strip()

    # Explicit events_path → always use JSONL (tests + custom event files)
    if events_path is not None:
        if sid:
            # scroll still needs sqlite; tests use query/browse paths only
            pass
        elif not q:
            fallback = _jsonl_session_search(
                "",
                role_filter=role_filter,
                limit=limit,
                current_session_id=exclude,
                current_trace_id=current_trace_id,
                events_path=events_path,
            )
            fallback["mode"] = "browse"
            return fallback
        else:
            fallback = _jsonl_session_search(
                q,
                role_filter=role_filter,
                limit=limit,
                current_session_id=exclude,
                current_trace_id=current_trace_id,
                events_path=events_path,
            )
            fallback["mode"] = "discovery"
            return fallback

    # Mode 2: SCROLL
    if sid:
        result = scroll_messages(sid, around_message_id=around_message_id, window=window)
        result["backend"] = "sqlite_fts"
        return result

    # Mode 3: BROWSE (empty query)
    if not q:
        result = browse_mode(limit=max(limit, 10), exclude_session_id=exclude)
        result["backend"] = "sqlite_fts"
        return result

    # Mode 1: DISCOVERY
    try:
        result = discovery_search(
            q,
            limit=limit,
            exclude_session_id=exclude,
            window=window,
        )
        if result.get("result_count", 0) > 0:
            result["backend"] = "sqlite_fts"
            result["role_filter"] = role_filter or ""
            return result
    except Exception:
        pass

    # Fallback JSONL
    fallback = _jsonl_session_search(
        q,
        role_filter=role_filter,
        limit=limit,
        current_session_id=current_session_id,
        current_trace_id=current_trace_id,
        events_path=events_path,
    )
    fallback["mode"] = "discovery"
    return fallback
