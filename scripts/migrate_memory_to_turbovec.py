#!/usr/bin/env python3
"""一次性将 storage/memory/memories.json 批量迁移到 TurboVec 索引。"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "backend"))

from utils.vector_store import (  # noqa: E402
    LOCAL_MEMORY_FILE,
    MEMORY_INDEX_FILE,
    MEMORY_META_FILE,
    get_vector_store,
    reset_vector_store,
)


def main() -> int:
    parser = argparse.ArgumentParser(description="Migrate or rebuild agent memory TurboVec index")
    parser.add_argument(
        "--force",
        action="store_true",
        help="Rebuild embeddings from agent_memory.meta.json (or memories.json.bak)",
    )
    parser.add_argument(
        "--source",
        choices=("auto", "meta", "json"),
        default="auto",
        help="Data source for --force rebuild (default: auto)",
    )
    args = parser.parse_args()

    if args.force:
        if not MEMORY_META_FILE.exists() and not LOCAL_MEMORY_FILE.exists():
            bak = LOCAL_MEMORY_FILE.with_suffix(".json.bak")
            if not bak.exists():
                print("No meta/json source found — nothing to rebuild.")
                return 1
        reset_vector_store()
        store = get_vector_store()
        if store is None:
            print("ERROR: vector store unavailable")
            return 1
        result = store.rebuild_turbovec_embeddings(source=args.source)
        print(
            f"Rebuilt {result.get('rebuilt', 0)} memories → {result.get('index_path')} "
            f"(embedding={result.get('embedding', 'unknown')})"
        )
        return 0

    if not LOCAL_MEMORY_FILE.exists() and not MEMORY_INDEX_FILE.exists():
        print("No memories.json or existing TurboVec index found — nothing to migrate.")
        return 0

    if MEMORY_INDEX_FILE.exists():
        print(f"TurboVec index already exists at {MEMORY_INDEX_FILE}")
        print("Use --force to rebuild embeddings (e.g. after installing sentence-transformers).")
        return 0

    reset_vector_store()
    store = get_vector_store()
    if store is None:
        print("ERROR: vector store unavailable")
        return 1

    result = store.migrate_json_to_turbovec()
    print(f"Migrated {result.get('migrated', 0)} memories → {result.get('index_path')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
