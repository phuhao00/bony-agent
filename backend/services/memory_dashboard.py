"""聚合 MemoryPanel 首屏所需数据，减少重复全量扫描。"""

from __future__ import annotations

from typing import Any, Dict, List

from services.evolution_signals import list_signals, summarize_signals
from services.memory_evaluation import list_memory_hit_records
from utils.vector_store import get_vector_store


def build_memory_dashboard(
    *,
    hits_limit: int = 200,
    signals_limit: int = 1000,
) -> Dict[str, Any]:
    store = get_vector_store()
    memories: List[Dict[str, Any]] = store.get_all_memories() if store else []
    memory_ids = [str(m.get("id") or "") for m in memories if m.get("id")]

    hits = list_memory_hit_records(limit=hits_limit, memories=memories)
    signals = list_signals(target_type="memory", limit=signals_limit)
    signal_summary = summarize_signals("memory", memory_ids)

    return {
        "success": True,
        "memories": memories,
        "hits": hits,
        "signals": signals,
        "signal_summary": signal_summary,
        "total": len(memories),
    }
