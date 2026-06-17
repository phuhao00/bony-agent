"""
本地向量数据库管理器
使用 TurboVec (TurboQuant) + 本地 Sentence Transformers Embedding
完全本地化，不依赖 ChromaDB 或任何云端 API
"""
import hashlib
import json
import logging
import os
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

logger = logging.getLogger("vector_store")

try:
    from turbovec import IdMapIndex

    TURBOVEC_AVAILABLE = True
except ImportError:
    TURBOVEC_AVAILABLE = False
    IdMapIndex = None  # type: ignore
    logger.warning("turbovec not installed, falling back to local JSON")

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MEMORY_DIR = Path(PROJECT_ROOT) / "storage" / "memory"
MEMORY_DIR.mkdir(parents=True, exist_ok=True)

LOCAL_MEMORY_FILE = MEMORY_DIR / "memories.json"
LOCAL_MEMORY_BACKUP = MEMORY_DIR / "memories.json.bak"
MEMORY_INDEX_BASE = MEMORY_DIR / "agent_memory"
MEMORY_INDEX_FILE = MEMORY_INDEX_BASE.with_suffix(".tvim")
MEMORY_META_FILE = MEMORY_INDEX_BASE.with_suffix(".meta.json")

DEFAULT_EMBEDDING_DIM = 384
DEFAULT_BIT_WIDTH = 4
MIGRATION_BATCH_SIZE = 32


class LocalEmbeddingFunction:
    """本地 Embedding：sentence-transformers，不可用时降级为 hash 向量（lazy load）。"""

    def __init__(self, dim: int = DEFAULT_EMBEDDING_DIM):
        self.dim = dim
        self._model = None
        self._use_simple: Optional[bool] = None

    def _ensure_model(self) -> None:
        if self._use_simple is not None:
            return
        try:
            from sentence_transformers import SentenceTransformer

            self._model = SentenceTransformer("paraphrase-multilingual-MiniLM-L12-v2")
            self._use_simple = False
            logger.info("Loaded SentenceTransformer for embeddings")
        except ImportError:
            logger.warning("sentence-transformers not installed, using simple embedding")
            self._use_simple = True
        except Exception as e:
            logger.warning("Failed to load SentenceTransformer: %s, using simple embedding", e)
            self._use_simple = True

    def embed(self, texts: List[str]) -> np.ndarray:
        self._ensure_model()
        if self._use_simple:
            return np.asarray(self._simple_embedding(texts), dtype=np.float32)
        try:
            vectors = self._model.encode(texts, convert_to_numpy=True)
            return np.asarray(vectors, dtype=np.float32)
        except Exception as e:
            logger.error("Embedding failed: %s", e)
            return np.asarray(self._simple_embedding(texts), dtype=np.float32)

    def embed_batch(self, texts: List[str], batch_size: int = MIGRATION_BATCH_SIZE) -> np.ndarray:
        if not texts:
            return np.zeros((0, self.dim), dtype=np.float32)
        chunks: List[np.ndarray] = []
        for i in range(0, len(texts), batch_size):
            chunks.append(self.embed(texts[i : i + batch_size]))
        return np.vstack(chunks)

    def __call__(self, input: List[str]) -> List[List[float]]:
        return self.embed(input).tolist()

    def _simple_embedding(self, texts: List[str]) -> List[List[float]]:
        embeddings: List[List[float]] = []
        for text in texts:
            hash_bytes = hashlib.sha256(text.encode("utf-8")).digest()
            vector = [(hash_bytes[i] / 255.0) * 2 - 1 for i in range(min(len(hash_bytes), 48))]
            while len(vector) < self.dim:
                vector.append(0.0)
            embeddings.append(vector[: self.dim])
        return embeddings


def _content_hash(content: str) -> str:
    normalized = (content or "").strip().casefold()
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def _invalidate_graph_snapshots() -> None:
    try:
        from services.memory_graph_export import invalidate_graph_snapshots

        invalidate_graph_snapshots()
    except Exception:
        pass


class VectorStoreManager:
    """向量数据库管理器：TurboVec IdMapIndex + JSON 元数据 side-car。"""

    def __init__(self):
        self._embedding_fn: Optional[LocalEmbeddingFunction] = None
        self.embedding_dim = DEFAULT_EMBEDDING_DIM
        self.use_local_fallback = False
        self._index: Any = None
        self._memories: Dict[str, Dict[str, Any]] = {}
        self._id_to_u64: Dict[str, int] = {}
        self._u64_to_id: Dict[int, str] = {}
        self._next_u64 = 0
        self._json_cache: List[Dict[str, Any]] = []
        self._json_cache_loaded = False
        self._content_hash_index: Dict[str, str] = {}
        self._init_store()

    @property
    def embedding_fn(self) -> LocalEmbeddingFunction:
        if self._embedding_fn is None:
            self._embedding_fn = LocalEmbeddingFunction()
        return self._embedding_fn

    def _init_store(self) -> None:
        if not TURBOVEC_AVAILABLE:
            logger.warning("TurboVec not available, using local JSON fallback")
            self.use_local_fallback = True
            self._load_json_cache()
            return

        try:
            if MEMORY_INDEX_FILE.exists() and MEMORY_META_FILE.exists():
                self._load_from_disk()
            elif LOCAL_MEMORY_FILE.exists():
                self.use_local_fallback = True
                self._load_json_cache()
                logger.info(
                    "Loaded %d memories from JSON cache (run scripts/migrate_memory_to_turbovec.py to migrate)",
                    len(self._json_cache),
                )
            else:
                self._index = IdMapIndex(dim=self.embedding_dim, bit_width=DEFAULT_BIT_WIDTH)

            self._rebuild_content_hash_index()
            logger.info(
                "Memory store ready (mode=%s, count=%d)",
                "local_json" if self.use_local_fallback else "turbovec",
                self.count(),
            )
        except Exception as e:
            logger.warning("TurboVec init failed (%s), using local JSON fallback", e)
            self.use_local_fallback = True
            self._index = None
            self._load_json_cache()

    def count(self) -> int:
        if self.use_local_fallback:
            return len(self._json_cache)
        return len(self._memories)

    def _load_from_disk(self) -> None:
        self._index = IdMapIndex.load(str(MEMORY_INDEX_FILE))
        with open(MEMORY_META_FILE, "r", encoding="utf-8") as f:
            state = json.load(f)
        self._memories = state.get("memories", {})
        self._id_to_u64 = {mid: int(handle) for mid, handle in state.get("id_to_u64", [])}
        self._u64_to_id = {int(handle): mid for mid, handle in self._id_to_u64.items()}
        self._next_u64 = int(state.get("next_u64", 0))

    def _persist(self) -> None:
        if self.use_local_fallback or self._index is None:
            return
        self._index.write(str(MEMORY_INDEX_FILE))
        payload = {
            "memories": self._memories,
            "id_to_u64": list(self._id_to_u64.items()),
            "next_u64": self._next_u64,
        }
        with open(MEMORY_META_FILE, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)

    def _issue_handle(self) -> int:
        self._next_u64 += 1
        return self._next_u64

    def _rebuild_content_hash_index(self) -> None:
        self._content_hash_index = {}
        for mem in self.get_all_memories():
            mid = str(mem.get("id") or "")
            content = str(mem.get("content") or "")
            if mid and content:
                self._content_hash_index[_content_hash(content)] = mid

    def find_by_content_hash(self, content: str) -> Optional[str]:
        self._ensure_instance_state()
        return self._content_hash_index.get(_content_hash(content))

    def _ensure_instance_state(self) -> None:
        """Support tests that construct via __new__ without __init__."""
        if hasattr(self, "_json_cache_loaded"):
            return
        self._embedding_fn = getattr(self, "_embedding_fn", None)
        self.embedding_dim = getattr(self, "embedding_dim", DEFAULT_EMBEDDING_DIM)
        self.use_local_fallback = getattr(self, "use_local_fallback", False)
        self._index = getattr(self, "_index", None)
        self._memories = getattr(self, "_memories", {})
        self._id_to_u64 = getattr(self, "_id_to_u64", {})
        self._u64_to_id = getattr(self, "_u64_to_id", {})
        self._next_u64 = getattr(self, "_next_u64", 0)
        self._json_cache = getattr(self, "_json_cache", [])
        self._json_cache_loaded = False
        self._content_hash_index = getattr(self, "_content_hash_index", {})

    def _load_json_cache(self) -> None:
        self._ensure_instance_state()
        if self._json_cache_loaded:
            return
        if LOCAL_MEMORY_FILE.exists():
            try:
                with open(LOCAL_MEMORY_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                self._json_cache = data if isinstance(data, list) else []
            except Exception:
                self._json_cache = []
        else:
            self._json_cache = []
        self._json_cache_loaded = True

    def _save_local_memories(self, memories: List[Dict]) -> None:
        try:
            with open(LOCAL_MEMORY_FILE, "w", encoding="utf-8") as f:
                json.dump(memories, f, ensure_ascii=False, indent=2)
            self._json_cache = list(memories)
            self._json_cache_loaded = True
        except Exception as e:
            logger.error("Failed to save local memories: %s", e)

    def migrate_json_to_turbovec(self, *, batch_size: int = MIGRATION_BATCH_SIZE) -> Dict[str, Any]:
        """批量迁移 memories.json → TurboVec（CLI 专用，不在 HTTP 路径调用）。"""
        if not TURBOVEC_AVAILABLE:
            raise RuntimeError("turbovec not installed")

        self._load_json_cache()
        memories = [m for m in self._json_cache if str(m.get("content") or "").strip()]
        if not memories:
            return {"migrated": 0, "message": "no memories to migrate"}

        index = IdMapIndex(dim=self.embedding_dim, bit_width=DEFAULT_BIT_WIDTH)
        meta_memories: Dict[str, Dict[str, Any]] = {}
        id_to_u64: Dict[str, int] = {}
        u64_to_id: Dict[int, str] = {}
        next_u64 = 0

        texts: List[str] = []
        ids: List[str] = []
        metas: List[Dict[str, Any]] = []
        for mem in memories:
            memory_id = str(mem.get("id") or uuid.uuid4())
            text = str(mem.get("content") or "")
            metadata = mem.get("metadata") or {}
            texts.append(text)
            ids.append(memory_id)
            metas.append(metadata)

        vectors = self.embedding_fn.embed_batch(texts, batch_size=batch_size)
        handles = []
        for memory_id, text, metadata, vector in zip(ids, texts, metas, vectors):
            next_u64 += 1
            handle = next_u64
            handles.append(handle)
            id_to_u64[memory_id] = handle
            u64_to_id[handle] = memory_id
            meta_memories[memory_id] = {"content": text, "metadata": metadata}

        handle_arr = np.array(handles, dtype=np.uint64)
        index.add_with_ids(vectors, handle_arr)
        index.write(str(MEMORY_INDEX_FILE))
        payload = {
            "memories": meta_memories,
            "id_to_u64": list(id_to_u64.items()),
            "next_u64": next_u64,
        }
        with open(MEMORY_META_FILE, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)

        if LOCAL_MEMORY_FILE.exists():
            LOCAL_MEMORY_FILE.rename(LOCAL_MEMORY_BACKUP)

        self.use_local_fallback = False
        self._index = index
        self._memories = meta_memories
        self._id_to_u64 = id_to_u64
        self._u64_to_id = u64_to_id
        self._next_u64 = next_u64
        self._json_cache = []
        self._json_cache_loaded = True
        self._rebuild_content_hash_index()
        _invalidate_graph_snapshots()

        return {"migrated": len(ids), "index_path": str(MEMORY_INDEX_FILE)}

    def rebuild_turbovec_embeddings(
        self,
        *,
        batch_size: int = MIGRATION_BATCH_SIZE,
        source: str = "auto",
    ) -> Dict[str, Any]:
        """从 meta side-car 或 memories.json(.bak) 重新批量 embed，覆盖 TurboVec 索引。"""
        if not TURBOVEC_AVAILABLE:
            raise RuntimeError("turbovec not installed")

        memories: List[Dict[str, Any]] = []
        if source in {"auto", "meta"} and MEMORY_META_FILE.exists():
            with open(MEMORY_META_FILE, "r", encoding="utf-8") as f:
                state = json.load(f)
            for memory_id, data in (state.get("memories") or {}).items():
                memories.append(
                    {
                        "id": memory_id,
                        "content": data.get("content", ""),
                        "metadata": data.get("metadata") or {},
                    }
                )
        elif source in {"auto", "json"}:
            json_path = LOCAL_MEMORY_FILE if LOCAL_MEMORY_FILE.exists() else LOCAL_MEMORY_BACKUP
            if json_path.exists():
                with open(json_path, "r", encoding="utf-8") as f:
                    raw = json.load(f)
                memories = raw if isinstance(raw, list) else []
        else:
            raise ValueError(f"unknown rebuild source: {source}")

        memories = [m for m in memories if str(m.get("content") or "").strip()]
        if not memories:
            return {"rebuilt": 0, "message": "no memories to rebuild"}

        index = IdMapIndex(dim=self.embedding_dim, bit_width=DEFAULT_BIT_WIDTH)
        meta_memories: Dict[str, Dict[str, Any]] = {}
        id_to_u64: Dict[str, int] = {}
        u64_to_id: Dict[int, str] = {}
        next_u64 = 0

        texts: List[str] = []
        ids: List[str] = []
        metas: List[Dict[str, Any]] = []
        for mem in memories:
            memory_id = str(mem.get("id") or uuid.uuid4())
            text = str(mem.get("content") or "")
            metadata = mem.get("metadata") or {}
            texts.append(text)
            ids.append(memory_id)
            metas.append(metadata)

        vectors = self.embedding_fn.embed_batch(texts, batch_size=batch_size)
        handles = []
        for memory_id, text, metadata, vector in zip(ids, texts, metas, vectors):
            next_u64 += 1
            handle = next_u64
            handles.append(handle)
            id_to_u64[memory_id] = handle
            u64_to_id[handle] = memory_id
            meta_memories[memory_id] = {"content": text, "metadata": metadata}

        handle_arr = np.array(handles, dtype=np.uint64)
        index.add_with_ids(vectors, handle_arr)
        index.write(str(MEMORY_INDEX_FILE))
        payload = {
            "memories": meta_memories,
            "id_to_u64": list(id_to_u64.items()),
            "next_u64": next_u64,
        }
        with open(MEMORY_META_FILE, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)

        self.use_local_fallback = False
        self._index = index
        self._memories = meta_memories
        self._id_to_u64 = id_to_u64
        self._u64_to_id = u64_to_id
        self._next_u64 = next_u64
        self._json_cache = []
        self._json_cache_loaded = True
        self._rebuild_content_hash_index()
        _invalidate_graph_snapshots()

        return {
            "rebuilt": len(ids),
            "index_path": str(MEMORY_INDEX_FILE),
            "embedding": "sentence-transformers"
            if getattr(self.embedding_fn, "_use_simple", True) is False
            else "hash_fallback",
        }

    def _add_to_index(
        self,
        memory_id: str,
        text: str,
        metadata: Dict[str, Any],
        *,
        persist: bool = True,
    ) -> None:
        if memory_id in self._id_to_u64:
            self._remove_from_index(memory_id, invalidate=False)

        vector = self.embedding_fn.embed([text])
        if vector.ndim != 2 or vector.shape[1] != self.embedding_dim:
            raise ValueError(
                f"embedding dim mismatch: expected {self.embedding_dim}, got {vector.shape}"
            )
        handle = self._issue_handle()
        handles = np.array([handle], dtype=np.uint64)
        self._index.add_with_ids(vector, handles)
        self._id_to_u64[memory_id] = handle
        self._u64_to_id[handle] = memory_id
        self._memories[memory_id] = {"content": text, "metadata": metadata}
        self._content_hash_index[_content_hash(text)] = memory_id
        if persist:
            self._persist()
            _invalidate_graph_snapshots()

    def _remove_from_index(self, memory_id: str, *, invalidate: bool = True) -> bool:
        handle = self._id_to_u64.pop(memory_id, None)
        if handle is None:
            return False
        self._u64_to_id.pop(handle, None)
        mem = self._memories.pop(memory_id, None)
        if mem:
            self._content_hash_index.pop(_content_hash(str(mem.get("content") or "")), None)
        self._index.remove(handle)
        if invalidate:
            _invalidate_graph_snapshots()
        return True

    def add_memory(self, text: str, metadata: Dict[str, Any] = None) -> str:
        self._ensure_instance_state()
        memory_id = str(uuid.uuid4())
        metadata = metadata or {}
        metadata["timestamp"] = time.strftime("%Y-%m-%d %H:%M:%S")

        if self.use_local_fallback:
            self._load_json_cache()
            entry = {"id": memory_id, "content": text, "metadata": metadata}
            self._json_cache.append(entry)
            self._save_local_memories(self._json_cache)
            self._content_hash_index[_content_hash(text)] = memory_id
            _invalidate_graph_snapshots()
            logger.info("Memory added (local): %s...", text[:50])
            return memory_id

        try:
            self._add_to_index(memory_id, text, metadata)
            logger.info("Memory added (TurboVec): %s...", text[:50])
            return memory_id
        except Exception as e:
            logger.error("Failed to add memory to TurboVec: %s", e)
            self.use_local_fallback = True
            self._load_json_cache()
            return self.add_memory(text, metadata)

    def search_memory(self, query: str, k: int = 3) -> List[Dict[str, Any]]:
        self._ensure_instance_state()
        if self.use_local_fallback:
            return self._search_local(query, k)

        if not self._memories:
            return []

        try:
            query_vec = self.embedding_fn.embed([query])
            if not query_vec.flags["C_CONTIGUOUS"]:
                query_vec = np.ascontiguousarray(query_vec)
            top_k = min(k, len(self._index))
            scores, handles = self._index.search(query_vec, top_k)
            results: List[Dict[str, Any]] = []
            for score, handle in zip(scores[0], handles[0]):
                memory_id = self._u64_to_id.get(int(handle))
                if not memory_id:
                    continue
                mem = self._memories.get(memory_id)
                if not mem:
                    continue
                results.append(
                    {
                        "id": memory_id,
                        "content": mem["content"],
                        "metadata": mem.get("metadata", {}),
                        "score": float(score),
                    }
                )
            return results
        except Exception as e:
            logger.error("Failed to search TurboVec: %s", e)
            return []

    def _search_local(self, query: str, k: int) -> List[Dict[str, Any]]:
        self._load_json_cache()
        results: List[Dict[str, Any]] = []
        query_lower = query.lower()

        for mem in self._json_cache:
            content = mem.get("content", "").lower()
            if any(word in content for word in query_lower.split()):
                results.append(
                    {
                        "id": mem.get("id", ""),
                        "content": mem["content"],
                        "metadata": mem.get("metadata", {}),
                    }
                )
                if len(results) >= k:
                    break

        if not results and self._json_cache:
            for mem in reversed(self._json_cache[-k:]):
                results.append(
                    {
                        "id": mem.get("id", ""),
                        "content": mem["content"],
                        "metadata": mem.get("metadata", {}),
                    }
                )
        return results

    def get_all_memories(self) -> List[Dict[str, Any]]:
        self._ensure_instance_state()
        if self.use_local_fallback:
            self._load_json_cache()
            return list(self._json_cache)

        return [
            {"id": memory_id, "content": data["content"], "metadata": data.get("metadata", {})}
            for memory_id, data in self._memories.items()
        ]

    def get_memories_summary(
        self,
        offset: int = 0,
        limit: int = 50,
        *,
        content_preview: int = 80,
    ) -> Tuple[List[Dict[str, Any]], int]:
        all_mems = self.get_all_memories()
        total = len(all_mems)
        start = max(0, offset)
        end = min(total, start + max(1, limit))
        slice_mems = all_mems[start:end]
        summaries: List[Dict[str, Any]] = []
        for mem in slice_mems:
            metadata = mem.get("metadata") or {}
            content = str(mem.get("content") or "")
            summaries.append(
                {
                    "id": mem.get("id", ""),
                    "preview": content[:content_preview] + ("…" if len(content) > content_preview else ""),
                    "metadata": {
                        "timestamp": metadata.get("timestamp"),
                        "knowledge_layer": metadata.get("knowledge_layer") or metadata.get("type"),
                        "confidence": metadata.get("confidence"),
                        "source": metadata.get("source"),
                        "type": metadata.get("type"),
                    },
                }
            )
        return summaries, total

    def delete_memory(self, memory_id: str) -> bool:
        if self.use_local_fallback:
            self._load_json_cache()
            before = len(self._json_cache)
            self._json_cache = [m for m in self._json_cache if m.get("id") != memory_id]
            if len(self._json_cache) < before:
                self._save_local_memories(self._json_cache)
                self._content_hash_index = {
                    h: mid
                    for h, mid in self._content_hash_index.items()
                    if mid != memory_id
                }
                _invalidate_graph_snapshots()
                return True
            return False

        try:
            removed = self._remove_from_index(memory_id)
            if removed:
                self._persist()
            return removed
        except Exception as e:
            logger.error("Failed to delete memory: %s", e)
            return False

    def update_memory_metadata(self, memory_id: str, metadata_patch: Dict[str, Any]) -> bool:
        if self.use_local_fallback:
            self._load_json_cache()
            found = False
            for m in self._json_cache:
                if m.get("id") == memory_id:
                    m.setdefault("metadata", {}).update(metadata_patch)
                    found = True
                    break
            if found:
                self._save_local_memories(self._json_cache)
                _invalidate_graph_snapshots()
            return found

        if memory_id not in self._memories:
            logger.warning("update_memory_metadata: id not found: %s", memory_id)
            return False

        self._memories[memory_id].setdefault("metadata", {}).update(metadata_patch)
        self._persist()
        _invalidate_graph_snapshots()
        return True

    def clear_all_memories(self) -> bool:
        if self.use_local_fallback:
            self._save_local_memories([])
            self._content_hash_index = {}
            _invalidate_graph_snapshots()
            return True

        try:
            self._index = IdMapIndex(dim=self.embedding_dim, bit_width=DEFAULT_BIT_WIDTH)
            self._memories = {}
            self._id_to_u64 = {}
            self._u64_to_id = {}
            self._next_u64 = 0
            self._content_hash_index = {}
            self._persist()
            _invalidate_graph_snapshots()
            return True
        except Exception as e:
            logger.error("Failed to clear memories: %s", e)
            return False

    def get_status(self) -> Dict[str, Any]:
        if self.use_local_fallback:
            return {
                "mode": "local_json",
                "count": self.count(),
                "storage_path": str(LOCAL_MEMORY_FILE),
            }

        try:
            return {
                "mode": "turbovec",
                "count": len(self._memories),
                "index_path": str(MEMORY_INDEX_FILE),
                "meta_path": str(MEMORY_META_FILE),
                "dim": self.embedding_dim,
                "bit_width": DEFAULT_BIT_WIDTH,
            }
        except Exception:
            return {"mode": "unknown", "count": 0}


_store_instance: Optional[VectorStoreManager] = None


def get_vector_store(api_key: str = None) -> Optional[VectorStoreManager]:
    """获取向量存储实例（api_key 参数保留用于兼容，但不再使用）。"""
    global _store_instance
    if _store_instance is None:
        _store_instance = VectorStoreManager()
    return _store_instance


def reset_vector_store() -> None:
    """重置向量存储实例。"""
    global _store_instance
    _store_instance = None
