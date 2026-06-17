"""记忆网图导出模块：以四种 mode 构建图节点和边，并提供 snapshot 缓存。

Mode:
  memories  — 记忆节点 + 相似度边（关键词共现）
  topics    — 主题聚合节点 + 记忆分布边
  usage     — 记忆使用频率节点 + recall 链路边
  dreams    — dream 卡片节点 + 关联记忆边
"""

from __future__ import annotations

import hashlib
import json
import time
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

from utils.logger import setup_logger
from utils.vector_store import get_vector_store

logger = setup_logger("memory_graph_export")

PROJECT_ROOT = Path(__file__).resolve().parents[2]
GRAPH_SNAPSHOT_DIR = PROJECT_ROOT / "storage" / "memory" / "graph_snapshots"
GRAPH_SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)

_TYPE_COLOR: Dict[str, str] = {
    "memory": "#4A83DD",
    "topic": "#6BAA8E",
    "usage": "#F5A623",
    "dream": "#9B59B6",
    "default": "#888888",
}

_SNAP_CACHE: Dict[str, Dict] = {}
_SNAP_TTL = 300


def invalidate_graph_snapshots() -> None:
    """写入/删除记忆后失效 L1 与磁盘 snapshot。"""
    _SNAP_CACHE.clear()
    if GRAPH_SNAPSHOT_DIR.exists():
        for path in GRAPH_SNAPSHOT_DIR.glob("*.json"):
            try:
                path.unlink()
            except OSError:
                pass


def _cache_get(mode: str) -> Optional[Dict]:
    entry = _SNAP_CACHE.get(mode)
    if entry and (time.monotonic() - entry["ts"]) < _SNAP_TTL:
        return entry["data"]
    return None


def _cache_set(mode: str, data: Dict) -> None:
    _SNAP_CACHE[mode] = {"data": data, "ts": time.monotonic()}


def _snapshot_path(mode: str) -> Path:
    return GRAPH_SNAPSHOT_DIR / f"{mode}.json"


def _load_disk_snapshot(mode: str) -> Optional[Dict]:
    path = _snapshot_path(mode)
    if not path.exists():
        return None
    try:
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict) and data.get("nodes") is not None:
            return data
    except Exception as exc:
        logger.warning("Failed to load graph snapshot %s: %s", path, exc)
    return None


def _save_disk_snapshot(mode: str, data: Dict) -> None:
    payload = {**data, "snapshot_at": time.strftime("%Y-%m-%dT%H:%M:%S")}
    try:
        with _snapshot_path(mode).open("w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False)
    except Exception as exc:
        logger.warning("Failed to save graph snapshot mode=%s: %s", mode, exc)


def _short_id(text: str, length: int = 8) -> str:
    return hashlib.md5(text.encode()).hexdigest()[:length]


def _extract_terms(content: str) -> Set[str]:
    return {w for w in content.lower().split() if len(w) >= 3}


def _build_cooccurrence_links(id_to_terms: Dict[str, Set[str]], max_links: int = 300) -> List[Dict]:
    """倒排索引构建共现边，避免 O(n²) 两两比较。"""
    term_to_ids: Dict[str, Set[str]] = defaultdict(set)
    for mem_id, terms in id_to_terms.items():
        for term in terms:
            term_to_ids[term].add(mem_id)

    pair_counts: Counter = Counter()
    for ids in term_to_ids.values():
        id_list = sorted(ids)
        for i in range(len(id_list)):
            for j in range(i + 1, len(id_list)):
                pair_counts[(id_list[i], id_list[j])] += 1

    links: List[Dict] = []
    for (source, target), shared_count in pair_counts.most_common(max_links):
        if shared_count < 2:
            break
        links.append(
            {
                "source": source,
                "target": target,
                "relation": "shared_terms",
                "weight": min(1.0, shared_count / 10),
            }
        )
    return links


def _build_memories_graph() -> Dict:
    store = get_vector_store()
    if not store:
        return {"nodes": [], "links": []}

    all_mems = store.get_all_memories()
    if not all_mems:
        return {"nodes": [], "links": []}

    nodes: List[Dict] = []
    id_to_terms: Dict[str, Set[str]] = {}

    for mem in all_mems[:200]:
        mem_id = str(mem.get("id") or _short_id(str(mem.get("content", ""))))
        content = str(mem.get("content") or "")
        metadata = mem.get("metadata") or {}
        layer = metadata.get("knowledge_layer") or metadata.get("type") or "general"
        confidence = float(metadata.get("confidence") or 1.0)
        size = max(10, min(50, int(confidence * 30)))
        id_to_terms[mem_id] = _extract_terms(content)

        nodes.append(
            {
                "id": mem_id,
                "label": content[:40] + ("…" if len(content) > 40 else ""),
                "type": "memory",
                "size": size,
                "color": _TYPE_COLOR["memory"],
                "meta": {
                    "layer": layer,
                    "confidence": confidence,
                    "source": metadata.get("source"),
                    "created_at": metadata.get("timestamp"),
                },
            }
        )

    links = _build_cooccurrence_links(id_to_terms)
    return {"nodes": nodes, "links": links}


def _build_topics_graph() -> Dict:
    store = get_vector_store()
    if not store:
        return {"nodes": [], "links": []}

    all_mems = store.get_all_memories()
    if not all_mems:
        return {"nodes": [], "links": []}

    layer_groups: Dict[str, List] = defaultdict(list)
    for mem in all_mems[:200]:
        metadata = mem.get("metadata") or {}
        layer = metadata.get("knowledge_layer") or metadata.get("type") or "general"
        layer_groups[layer].append(mem)

    nodes: List[Dict] = []
    links: List[Dict] = []

    for layer, mems in layer_groups.items():
        topic_id = f"topic:{layer}"
        nodes.append(
            {
                "id": topic_id,
                "label": layer,
                "type": "topic",
                "size": max(20, min(70, len(mems) * 5)),
                "color": _TYPE_COLOR["topic"],
                "meta": {"layer": layer, "memory_count": len(mems)},
            }
        )
        for mem in mems[:30]:
            mem_id = str(mem.get("id") or _short_id(str(mem.get("content", ""))))
            content = str(mem.get("content") or "")
            metadata = mem.get("metadata") or {}
            nodes.append(
                {
                    "id": mem_id,
                    "label": content[:40] + ("…" if len(content) > 40 else ""),
                    "type": "memory",
                    "size": 12,
                    "color": _TYPE_COLOR["memory"],
                    "meta": {"layer": layer, "source": metadata.get("source")},
                }
            )
            links.append(
                {
                    "source": topic_id,
                    "target": mem_id,
                    "relation": "belongs_to",
                    "weight": 0.8,
                }
            )

    return {"nodes": nodes, "links": links}


def _build_usage_graph() -> Dict:
    from services.learning_data_pipeline import read_jsonl_tail

    usage_file = PROJECT_ROOT / "storage" / "evolution" / "memory_usage.jsonl"

    store = get_vector_store()
    if not store:
        return {"nodes": [], "links": []}

    all_mems = store.get_all_memories()
    mem_map = {str(m.get("id") or ""): m for m in all_mems if m.get("id")}

    recall_counter: Counter = Counter()
    query_to_mems: Dict[str, List[str]] = defaultdict(list)

    if usage_file.exists():
        rows = read_jsonl_tail(usage_file, limit=2000)
        for row in rows:
            mem_id = str(row.get("memory_id") or "")
            query = str(row.get("query") or "")[:40]
            if mem_id:
                recall_counter[mem_id] += 1
                if query:
                    query_to_mems[query].append(mem_id)

    nodes: List[Dict] = []
    links: List[Dict] = []
    node_ids: Set[str] = set()

    for mem_id, count in recall_counter.most_common(80):
        mem = mem_map.get(mem_id)
        if not mem:
            continue
        content = str(mem.get("content") or "")
        nodes.append(
            {
                "id": mem_id,
                "label": content[:40] + ("…" if len(content) > 40 else ""),
                "type": "memory",
                "size": max(10, min(60, 10 + count * 3)),
                "color": _TYPE_COLOR["usage"],
                "meta": {
                    "recall_count": count,
                    "layer": (mem.get("metadata") or {}).get("knowledge_layer"),
                },
            }
        )
        node_ids.add(mem_id)

    for query, mem_ids in list(query_to_mems.items())[:30]:
        query_id = f"query:{_short_id(query)}"
        nodes.append(
            {
                "id": query_id,
                "label": query[:30] + "…",
                "type": "usage",
                "size": 16,
                "color": _TYPE_COLOR["usage"],
                "meta": {"query": query},
            }
        )
        for mem_id in set(mem_ids):
            if mem_id in node_ids:
                links.append(
                    {
                        "source": query_id,
                        "target": mem_id,
                        "relation": "recalled_by",
                        "weight": 0.6,
                    }
                )

    return {"nodes": nodes, "links": links}


def _build_dreams_graph() -> Dict:
    from services.dream_store import get_dream_store

    store = get_vector_store()
    dream_store = get_dream_store()

    cards = dream_store.load_dream_cards(limit=50)
    if not cards:
        return {"nodes": [], "links": []}

    all_mems: Dict[str, Any] = {}
    if store:
        for mem in store.get_all_memories():
            mid = str(mem.get("id") or "")
            if mid:
                all_mems[mid] = mem

    nodes: List[Dict] = []
    links: List[Dict] = []
    node_ids: Set[str] = set()

    for card in cards:
        card_id = str(card.get("id") or _short_id(str(card.get("title", ""))))
        status = card.get("status") or "pending"
        nodes.append(
            {
                "id": card_id,
                "label": str(card.get("title") or "")[:40],
                "type": "dream",
                "size": 24 if status == "act" else 16,
                "color": _TYPE_COLOR["dream"],
                "meta": {
                    "status": status,
                    "date": str(card.get("created_at") or "")[:10],
                    "body": str(card.get("body") or "")[:100],
                },
            }
        )
        node_ids.add(card_id)
        for mem_id in card.get("memory_refs") or []:
            mem = all_mems.get(str(mem_id))
            if not mem:
                continue
            content = str(mem.get("content") or "")
            if mem_id not in node_ids:
                nodes.append(
                    {
                        "id": mem_id,
                        "label": content[:40] + ("…" if len(content) > 40 else ""),
                        "type": "memory",
                        "size": 12,
                        "color": _TYPE_COLOR["memory"],
                        "meta": {},
                    }
                )
                node_ids.add(mem_id)
            links.append(
                {
                    "source": card_id,
                    "target": mem_id,
                    "relation": "references",
                    "weight": 0.7,
                }
            )

    return {"nodes": nodes, "links": links}


def export_memory_graph(mode: str = "memories") -> Dict[str, Any]:
    """统一导出接口，带 L1 + 磁盘 snapshot 缓存。"""
    valid_modes = {"memories", "topics", "usage", "dreams"}
    if mode not in valid_modes:
        return {"error": f"invalid mode: {mode}", "nodes": [], "links": []}

    cached = _cache_get(mode)
    if cached:
        logger.debug("[memory-graph] L1 cache hit mode=%s", mode)
        return cached

    disk = _load_disk_snapshot(mode)
    if disk:
        _cache_set(mode, disk)
        logger.debug("[memory-graph] disk snapshot hit mode=%s", mode)
        return disk

    t0 = time.monotonic()
    try:
        if mode == "memories":
            result = _build_memories_graph()
        elif mode == "topics":
            result = _build_topics_graph()
        elif mode == "usage":
            result = _build_usage_graph()
        else:
            result = _build_dreams_graph()

        result["mode"] = mode
        result["node_count"] = len(result.get("nodes") or [])
        result["link_count"] = len(result.get("links") or [])

        _cache_set(mode, result)
        _save_disk_snapshot(mode, result)
        logger.info(
            "[memory-graph] mode=%s nodes=%d links=%d elapsed_ms=%.0f",
            mode,
            result["node_count"],
            result["link_count"],
            (time.monotonic() - t0) * 1000,
        )
        return result
    except Exception as exc:
        logger.error("[memory-graph] export_memory_graph mode=%s failed: %s", mode, exc)
        return {"error": str(exc), "nodes": [], "links": [], "mode": mode}
