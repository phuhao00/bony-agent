"""Adapt vector-store memories to OpenHuman-style chunk browser payloads."""

from __future__ import annotations

import re
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from services.memory_code_links import resolve_memory_code_entities
from utils.logger import setup_logger
from utils.vector_store import get_vector_store

logger = setup_logger("memory_chunks")

_DOMAIN_ENTITIES = [
    "小红书", "抖音", "B站", "YouTube", "Twitter", "快手", "视频号",
    "文案", "脚本", "发布", "混剪", "即梦", "豆包",
]


def _parse_ts(metadata: Dict[str, Any]) -> float:
    raw = metadata.get("created_at") or metadata.get("timestamp") or ""
    if isinstance(raw, (int, float)):
        return float(raw)
    text = str(raw).strip()
    if not text:
        return 0.0
    try:
        if text.isdigit():
            return float(text)
        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.timestamp()
    except Exception:
        return 0.0


def _preview(content: str, limit: int = 400) -> str:
    text = (content or "").strip()
    if len(text) <= limit:
        return text
    return text[: limit - 1] + "…"


def _extract_entities(content: str, metadata: Dict[str, Any]) -> List[Dict[str, Any]]:
    entities: List[Dict[str, Any]] = []
    seen: set[str] = set()
    layer = str(metadata.get("knowledge_layer") or "")
    source = str(metadata.get("source") or "")
    mtype = str(metadata.get("type") or "")

    for label in [layer, source, mtype]:
        if label and label not in seen:
            seen.add(label)
            entities.append({"id": label, "label": label, "kind": "meta"})

    for term in _DOMAIN_ENTITIES:
        if term in (content or "") and term not in seen:
            seen.add(term)
            entities.append({"id": term, "label": term, "kind": "topic"})

    for match in re.finditer(r"#([\w\u4e00-\u9fff]+)", content or ""):
        tag = match.group(1)
        if tag not in seen:
            seen.add(tag)
            entities.append({"id": tag, "label": f"#{tag}", "kind": "topic"})

    return entities[:20]


def memory_to_chunk(item: Dict[str, Any]) -> Dict[str, Any]:
    meta = item.get("metadata") or {}
    content = str(item.get("content") or "")
    ts = _parse_ts(meta)
    source_id = str(meta.get("source") or meta.get("knowledge_layer") or "agent_memory")
    return {
        "id": str(item.get("id") or ""),
        "source_id": source_id,
        "source_kind": str(meta.get("knowledge_layer") or "memory"),
        "content_preview": _preview(content),
        "content_full": content,
        "timestamp_ms": int(ts * 1000) if ts else 0,
        "status": "admitted",
        "metadata": meta,
        "entities": _extract_entities(content, meta),
        "code_entities": resolve_memory_code_entities(content, meta, use_codegraph=False),
    }


def list_memory_chunks(
    *,
    search: str = "",
    layer: str = "",
    source: str = "",
    entity_id: str = "",
    limit: int = 200,
) -> Dict[str, Any]:
    store = get_vector_store()
    if not store:
        return {"chunks": [], "sources": [], "top_people": [], "top_topics": [], "count": 0}

    if search.strip() and hasattr(store, "search_memory"):
        raw = store.search_memory(search.strip(), k=min(limit, 50))
    elif hasattr(store, "get_all_memories"):
        raw = store.get_all_memories()
    else:
        raw = []

    chunks: List[Dict[str, Any]] = []
    for item in raw:
        chunk = memory_to_chunk(item)
        if layer and layer != "all" and chunk["source_kind"] != layer:
            continue
        if source and source not in chunk["source_id"]:
            continue
        if entity_id:
            labels = {e["id"] for e in chunk["entities"]}
            if entity_id not in labels:
                continue
        chunks.append(chunk)

    chunks.sort(key=lambda c: c.get("timestamp_ms", 0), reverse=True)
    chunks = chunks[:limit]

    source_counts: Dict[str, int] = {}
    entity_counts: Dict[str, Dict[str, Any]] = {}
    for ch in chunks:
        sid = ch["source_id"]
        source_counts[sid] = source_counts.get(sid, 0) + 1
        for ent in ch["entities"]:
            eid = ent["id"]
            if eid not in entity_counts:
                entity_counts[eid] = {**ent, "count": 0}
            entity_counts[eid]["count"] += 1

    sources = [
        {"id": sid, "label": sid, "kind": "source", "count": cnt, "status": "admitted"}
        for sid, cnt in sorted(source_counts.items(), key=lambda x: -x[1])
    ]
    top_topics = sorted(
        [v for v in entity_counts.values() if v.get("kind") == "topic"],
        key=lambda x: -x["count"],
    )[:12]
    top_people = sorted(
        [v for v in entity_counts.values() if v.get("kind") not in ("topic", "meta")],
        key=lambda x: -x["count"],
    )[:8]

    logger.debug("[memory_chunks] listed count=%d search=%r", len(chunks), search[:40] if search else "")
    return {
        "chunks": chunks,
        "sources": sources,
        "top_people": top_people,
        "top_topics": top_topics,
        "count": len(chunks),
        "snapshot_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


def get_chunk_detail(memory_id: str) -> Optional[Dict[str, Any]]:
    store = get_vector_store()
    if not store or not hasattr(store, "get_all_memories"):
        return None
    for item in store.get_all_memories():
        if str(item.get("id")) == memory_id:
            chunk = memory_to_chunk(item)
            chunk["code_entities"] = resolve_memory_code_entities(
                chunk["content_full"],
                chunk.get("metadata"),
                use_codegraph=True,
            )
            return chunk
    return None
