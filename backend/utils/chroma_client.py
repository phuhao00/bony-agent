"""
TurboVec 向量库状态模块（原 ChromaDB 客户端，已迁移至 TurboVec）

知识库向量索引由 rag_manager 通过 turbovec.llama_index.TurboQuantVectorStore 管理，
持久化在 storage/rag/ 目录（*.tvim + *.nodes.json）。
"""

import json
import logging
import os
from pathlib import Path
from typing import Any, Dict, Optional

logger = logging.getLogger("turbovec_client")

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RAG_PERSIST_DIR = os.path.join(PROJECT_ROOT, "storage", "rag")
VECTOR_STORE_NAMESPACE = "default"
VECTOR_STORE_STEM = f"{VECTOR_STORE_NAMESPACE}__vector_store"
TURBOVEC_INDEX_FILE = os.path.join(RAG_PERSIST_DIR, f"{VECTOR_STORE_STEM}.tvim")
TURBOVEC_NODES_FILE = os.path.join(RAG_PERSIST_DIR, f"{VECTOR_STORE_STEM}.nodes.json")
COLLECTION_NAME = os.getenv("TURBOVEC_COLLECTION_NAME", os.getenv("CHROMA_COLLECTION_NAME", "knowledge_base"))

os.makedirs(RAG_PERSIST_DIR, exist_ok=True)


def _count_nodes() -> int:
    if not os.path.exists(TURBOVEC_NODES_FILE):
        return 0
    try:
        with open(TURBOVEC_NODES_FILE, "r", encoding="utf-8") as f:
            state = json.load(f)
        return len(state.get("nodes", {}))
    except Exception:
        return 0


def get_chroma_client():
    """兼容旧接口：返回 TurboVec 索引路径信息（不再连接 ChromaDB 服务）。"""
    logger.info("TurboVec knowledge base at %s", RAG_PERSIST_DIR)
    return {
        "backend": "turbovec",
        "persist_dir": RAG_PERSIST_DIR,
        "index_file": TURBOVEC_INDEX_FILE,
        "nodes_file": TURBOVEC_NODES_FILE,
        "collection": COLLECTION_NAME,
    }


def get_or_create_collection(client=None, collection_name: str = COLLECTION_NAME):
    """兼容旧接口：返回 TurboVec 存储描述。"""
    info = client or get_chroma_client()
    return {
        **info,
        "collection": collection_name,
        "node_count": _count_nodes(),
    }


def get_chroma_status() -> Dict[str, Any]:
    """获取 TurboVec 知识库状态（兼容原 get_chroma_status 接口）。"""
    try:
        index_exists = os.path.exists(TURBOVEC_INDEX_FILE)
        nodes_exists = os.path.exists(TURBOVEC_NODES_FILE)
        node_count = _count_nodes() if nodes_exists else 0

        persist_files = []
        if os.path.isdir(RAG_PERSIST_DIR):
            persist_files = sorted(os.listdir(RAG_PERSIST_DIR))

        return {
            "success": True,
            "backend": "turbovec",
            "mode": "local",
            "persist_directory": RAG_PERSIST_DIR,
            "collections": [COLLECTION_NAME] if index_exists else [],
            "default_collection": COLLECTION_NAME,
            "document_count": node_count,
            "index_ready": index_exists and nodes_exists,
            "index_file": TURBOVEC_INDEX_FILE,
            "nodes_file": TURBOVEC_NODES_FILE,
            "persist_files": persist_files,
        }
    except Exception as e:
        logger.error("Failed to get TurboVec status: %s", e)
        return {"success": False, "error": str(e)}


def reset_chroma_db() -> Dict[str, Any]:
    """重置 TurboVec 知识库索引文件（保留 documents_meta.json / categories.json）。"""
    try:
        removed = []
        for name in (f"{VECTOR_STORE_STEM}.tvim", f"{VECTOR_STORE_STEM}.nodes.json"):
            path = os.path.join(RAG_PERSIST_DIR, name)
            if os.path.exists(path):
                os.remove(path)
                removed.append(name)

        legacy_json = os.path.join(RAG_PERSIST_DIR, f"{VECTOR_STORE_STEM}.json")
        if os.path.exists(legacy_json):
            os.remove(legacy_json)
            removed.append(os.path.basename(legacy_json))

        logger.info("Removed TurboVec index files: %s", removed)
        return {
            "success": True,
            "message": "TurboVec knowledge index reset successfully",
            "removed": removed,
        }
    except Exception as e:
        logger.error("Failed to reset TurboVec index: %s", e)
        return {"success": False, "error": str(e)}


# 新接口别名
get_turbovec_status = get_chroma_status
reset_turbovec_db = reset_chroma_db
