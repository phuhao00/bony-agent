import os
import shutil
import logging
import json
import uuid
import time
from typing import List, Optional, Dict, Any
from pathlib import Path

from utils.knowledge_faq import (
    parse_faq_excel_bytes_detailed,
    FAQ_CONTENT_TYPE,
    FAQ_FILE_SUFFIX,
    faq_payload_to_index_text,
    make_faq_filepath,
    normalize_faq_item,
    read_faq_payload,
    try_parse_faq_file,
    write_faq_payload,
)

try:
    from llama_index.core import (
        VectorStoreIndex,
        SimpleDirectoryReader,
        StorageContext,
        load_index_from_storage,
        Settings,
        Document
    )
    from llama_index.llms.openai import OpenAI
    from llama_index.embeddings.langchain import LangchainEmbedding
    from langchain_community.embeddings import ZhipuAIEmbeddings
    LLAMA_INDEX_AVAILABLE = True
except ImportError as _llama_err:
    LLAMA_INDEX_AVAILABLE = False
    VectorStoreIndex = SimpleDirectoryReader = StorageContext = None
    load_index_from_storage = Settings = Document = OpenAI = None
    LangchainEmbedding = ZhipuAIEmbeddings = None
    import logging as _logging
    _logging.getLogger('rag_manager').warning(
        'llama_index not available: %s — RAG features disabled.', _llama_err
    )

try:
    from turbovec.llama_index import TurboQuantVectorStore
    TURBOVEC_VS_AVAILABLE = True
except ImportError:
    TURBOVEC_VS_AVAILABLE = False
    TurboQuantVectorStore = None
    logger_init = logging.getLogger("rag_manager")
    logger_init.warning("turbovec[llama-index] not installed — RAG will use legacy vector store.")

# 注册各供应商模型到 LlamaIndex 的模型列表，避免模型名验证失败
try:
    from llama_index.llms.openai.utils import ALL_AVAILABLE_MODELS, CHAT_MODELS
    _extra_models = {
        # 智谱 AI
        "glm-4-plus": 128000,
        "glm-4": 128000,
        "glm-4-flash": 128000,
        "glm-3-turbo": 128000,
        # DeepSeek
        "deepseek-chat": 128000,
        "deepseek-reasoner": 128000,
        # Google Gemini
        "gemini-2.0-flash": 1048576,
        "gemini-2.0-flash-lite": 1048576,
        "gemini-1.5-pro": 2097152,
        "gemini-1.5-flash": 1048576,
        # 阿里通义
        "qwen-plus": 131072,
        "qwen-turbo": 131072,
        "qwen-max": 32768,
        # 字节豆包
        "doubao-1.5-pro-32k": 32768,
        "doubao-1.5-pro-256k": 262144,
        "doubao-pro-32k": 32768,
    }
    ALL_AVAILABLE_MODELS.update(_extra_models)
    CHAT_MODELS.update(_extra_models)
    logger_init = logging.getLogger("rag_manager")
    logger_init.info("Registered multi-provider models in LlamaIndex model registry.")
except Exception:
    pass


def _ensure_llamaindex_chat_model(model: str, context_window: int = 128000) -> None:
    """Register unknown model ids (e.g. OpenRouter slugs) for LlamaIndex OpenAI LLM."""
    try:
        from llama_index.llms.openai.utils import ALL_AVAILABLE_MODELS, CHAT_MODELS
        if model not in ALL_AVAILABLE_MODELS:
            ALL_AVAILABLE_MODELS[model] = context_window
            CHAT_MODELS[model] = context_window
    except Exception:
        pass


# 初始化日志
logger = logging.getLogger("rag_manager")

# 数据持久化目录
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PERSIST_DIR = os.path.join(PROJECT_ROOT, "storage", "rag")
UPLOAD_DIR = os.path.join(PROJECT_ROOT, "storage", "uploads")
KNOWLEDGE_DIR = os.path.join(PROJECT_ROOT, "storage", "knowledge")  # 知识库专用上传目录
TEMP_KNOWLEDGE_UPLOAD_DIR = os.path.join(PROJECT_ROOT, "storage", "temp", "knowledge_uploads")
DOCUMENTS_META_FILE = os.path.join(PERSIST_DIR, "documents_meta.json")
CATEGORIES_FILE = os.path.join(PERSIST_DIR, "categories.json")

# 内置默认分类
DEFAULT_CATEGORIES = [
    {"id": "uncategorized", "name": "未分类", "description": "默认分类", "color": "#6B7280", "icon": "📄"},
    {"id": "product-docs", "name": "产品文档", "description": "产品说明、需求、规格", "color": "#3B82F6", "icon": "📋"},
    {"id": "technical", "name": "技术文档", "description": "API、架构、开发指南", "color": "#8B5CF6", "icon": "⚙️"},
    {"id": "marketing", "name": "营销素材", "description": "品牌、文案、活动材料", "color": "#EC4899", "icon": "📣"},
    {"id": "knowledge", "name": "知识沉淀", "description": "行业知识、研究报告", "color": "#10B981", "icon": "🧠"},
    {"id": "faq", "name": "FAQ", "description": "常见问题与解答", "color": "#F59E0B", "icon": "❓"},
]

# 确保目录存在
os.makedirs(PERSIST_DIR, exist_ok=True)
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(KNOWLEDGE_DIR, exist_ok=True)
os.makedirs(TEMP_KNOWLEDGE_UPLOAD_DIR, exist_ok=True)

# 支持的文档格式
SUPPORTED_EXTENSIONS = {
    ".txt", ".md", ".pdf", ".docx", ".doc", ".json", ".csv", ".xlsx", ".xls",
}
EXCEL_EXTENSIONS = {".xlsx", ".xls"}
PLAIN_TEXT_EXTENSIONS = {".txt", ".md", ".json", ".csv"}


class RAGManager:
    """
    RAG 管理器，基于 LlamaIndex 实现私有知识库检索。
    支持文档管理：上传、列表、删除、状态查询。
    """
    def __init__(self, api_key: Optional[str] = None):
        from core.llm_provider import get_api_key, get_provider_config, get_embedding_config, get_rag_llm_model

        self.api_key = api_key or get_api_key()
        self.documents_meta: Dict[str, Dict] = {}
        self.categories: Dict[str, Dict] = {}
        self._load_documents_meta()
        self._load_categories()

        if not self.api_key:
            config = get_provider_config()
            logger.warning(f"{config.api_key_env} not found. RAG manager may fail to initialize.")
            self.index = None
            return

        # 1. 配置 LLM（跟随当前供应商 / LLM_MODEL，避免硬编码 OpenAI 模型名）
        config = get_provider_config()
        target_model = get_rag_llm_model()
        _ensure_llamaindex_chat_model(target_model)

        self.llm = OpenAI(
            model=target_model,
            api_key=self.api_key,
            api_base=config.base_url,
            temperature=0.1,
            max_tokens=1024,
        )
        logger.info("RAG query LLM: provider=%s model=%s", config.name, target_model)

        # 2. 配置 Embedding
        embed_config = get_embedding_config()
        if embed_config["provider"] == "zhipu":
            langchain_embed = ZhipuAIEmbeddings(
                api_key=embed_config["api_key"] or self.api_key,
                model=embed_config["model"]
            )
        else:
            # OpenAI 兼容网关（如 DashScope）不接受 tiktoken 分批后的整数 token 作 input，须传纯文本。
            from langchain_openai import OpenAIEmbeddings
            langchain_embed = OpenAIEmbeddings(
                openai_api_key=embed_config["api_key"] or self.api_key,
                openai_api_base=embed_config["base_url"],
                model=embed_config["model"],
                check_embedding_ctx_length=False,
            )
        self.embed_model = LangchainEmbedding(langchain_embed)

        # 3. 应用全局设置
        Settings.llm = self.llm
        Settings.embed_model = self.embed_model
        Settings.chunk_size = 512

        # 4. 加载或初始化索引
        self.index = self._load_or_create_index()

    def _load_documents_meta(self):
        """加载文档元数据"""
        if os.path.exists(DOCUMENTS_META_FILE):
            try:
                with open(DOCUMENTS_META_FILE, 'r', encoding='utf-8') as f:
                    self.documents_meta = json.load(f)
            except Exception as e:
                logger.error(f"Failed to load documents meta: {e}")
                self.documents_meta = {}
        else:
            self.documents_meta = {}

    def _save_documents_meta(self):
        """保存文档元数据"""
        try:
            with open(DOCUMENTS_META_FILE, 'w', encoding='utf-8') as f:
                json.dump(self.documents_meta, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.error(f"Failed to save documents meta: {e}")

    def _load_categories(self):
        """加载分类配置，不存在时初始化；补齐缺失的默认分类（如 faq）"""
        if os.path.exists(CATEGORIES_FILE):
            try:
                with open(CATEGORIES_FILE, "r", encoding="utf-8") as f:
                    self.categories = json.load(f)
            except Exception as e:
                logger.error(f"Failed to load categories: {e}")
                self.categories = {}
        else:
            self.categories = {}

        changed = False
        for cat in DEFAULT_CATEGORIES:
            if cat["id"] not in self.categories:
                self.categories[cat["id"]] = {
                    **cat,
                    "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
                }
                changed = True

        if not self.categories:
            self.categories = {cat["id"]: cat for cat in DEFAULT_CATEGORIES}
            changed = True

        if changed:
            self._save_categories()

    def _save_categories(self):
        """保存分类配置"""
        try:
            with open(CATEGORIES_FILE, 'w', encoding='utf-8') as f:
                json.dump(self.categories, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.error(f"Failed to save categories: {e}")

    def _build_vector_store(self):
        """创建 TurboVec 向量存储；不可用时回退 LlamaIndex 默认 SimpleVectorStore。"""
        if TURBOVEC_VS_AVAILABLE and TurboQuantVectorStore is not None:
            return TurboQuantVectorStore()
        return None

    def _create_storage_context(self, vector_store=None):
        if vector_store is None:
            vector_store = self._build_vector_store()
        if vector_store is not None:
            return StorageContext.from_defaults(vector_store=vector_store)
        return StorageContext.from_defaults()

    def _create_empty_index(self) -> VectorStoreIndex:
        return VectorStoreIndex([], storage_context=self._create_storage_context())

    def _load_or_create_index(self) -> VectorStoreIndex:
        """尝试从磁盘加载索引，如果不存在则创建空 TurboVec 索引。"""
        try:
            meta_files = {"documents_meta.json", "categories.json"}
            index_files = [f for f in os.listdir(PERSIST_DIR) if f not in meta_files]
            if not index_files:
                logger.info("No existing index found. Creating new TurboVec index.")
                return self._create_empty_index()

            tvim_path = os.path.join(PERSIST_DIR, "default__vector_store.tvim")
            if TURBOVEC_VS_AVAILABLE and os.path.exists(tvim_path):
                vector_store = TurboQuantVectorStore.from_persist_dir(PERSIST_DIR)
                storage_context = StorageContext.from_defaults(
                    persist_dir=PERSIST_DIR,
                    vector_store=vector_store,
                )
                index = load_index_from_storage(storage_context)
                logger.info("Loaded TurboVec index from storage.")
                return index

            storage_context = StorageContext.from_defaults(persist_dir=PERSIST_DIR)
            index = load_index_from_storage(storage_context)
            logger.info("Loaded legacy index from storage (re-index to migrate to TurboVec).")
            return index
        except Exception as e:
            logger.error(f"Failed to load index: {e}")
            return self._create_empty_index()

    @staticmethod
    def _is_excel_path(file_path: str) -> bool:
        return os.path.splitext(file_path)[1].lower() in EXCEL_EXTENSIONS

    @staticmethod
    def _load_excel_document(file_path: str) -> Optional[Document]:
        """将 Excel 各工作表转为 Markdown 风格文本供向量索引。"""
        if not LLAMA_INDEX_AVAILABLE:
            return None
        try:
            import pandas as pd
        except ImportError:
            logger.warning("pandas not installed, cannot parse Excel: %s", file_path)
            return None

        ext = os.path.splitext(file_path)[1].lower()
        engine = "openpyxl" if ext == ".xlsx" else "xlrd"
        try:
            sheets = pd.read_excel(file_path, sheet_name=None, engine=engine)
        except Exception as ex:
            logger.warning("Failed to read Excel %s: %s", file_path, ex)
            return None

        parts: List[str] = []
        for sheet_name, frame in sheets.items():
            if frame is None or getattr(frame, "empty", True):
                continue
            parts.append(f"## {sheet_name}")
            parts.append(frame.fillna("").astype(str).to_csv(index=False))
        text = "\n\n".join(parts).strip()
        if not text:
            return None
        abs_path = os.path.abspath(file_path)
        return Document(
            text=text,
            metadata={
                "file_path": abs_path,
                "file_name": os.path.basename(file_path),
            },
        )

    @staticmethod
    def _load_plain_text_document(file_path: str) -> Optional[Document]:
        """直接读取纯文本类文件，避免 SimpleDirectoryReader 对 JSON/CSV 解析为空。"""
        if not LLAMA_INDEX_AVAILABLE:
            return None
        try:
            with open(file_path, "r", encoding="utf-8", errors="replace") as f:
                text = f.read().strip()
        except OSError as ex:
            logger.warning("Plain-text read failed: %s err=%s", file_path, ex)
            return None
        if not text:
            return None
        abs_path = os.path.abspath(file_path)
        return Document(
            text=text,
            metadata={
                "file_path": abs_path,
                "file_name": os.path.basename(file_path),
            },
        )

    def _load_pdf_document(
        self, file_path: str, *, allow_ocr: bool = True
    ) -> Optional[Document]:
        """PDF 专用解析：文本层 → PyMuPDF/pypdf → 逐页 OCR（图片型 PDF）。"""
        if not LLAMA_INDEX_AVAILABLE:
            return None
        from pathlib import Path
        from tools.multimodal_tools import extract_pdf_text_for_rag

        text = extract_pdf_text_for_rag(
            Path(file_path), allow_ocr=allow_ocr
        ).strip()
        if not text:
            logger.warning("PDF parse yielded empty document: %s", file_path)
            return None
        abs_path = os.path.abspath(file_path)
        return Document(
            text=text,
            metadata={
                "file_path": abs_path,
                "file_name": os.path.basename(file_path),
            },
        )

    def _load_faq_document(self, file_path: str) -> Optional[Document]:
        payload = read_faq_payload(file_path)
        if not payload:
            return None
        abs_path = os.path.abspath(file_path)
        return Document(
            text=faq_payload_to_index_text(payload),
            metadata={
                "file_path": abs_path,
                "file_name": os.path.basename(file_path),
                "content_type": FAQ_CONTENT_TYPE,
            },
        )

    def _load_documents_from_paths(
        self, file_paths: List[str], *, allow_pdf_ocr: bool = True
    ) -> List[Document]:
        faq_paths = [p for p in file_paths if p.lower().endswith(FAQ_FILE_SUFFIX)]
        excel_paths = [
            p for p in file_paths
            if self._is_excel_path(p) and p not in faq_paths
        ]
        pdf_paths = [
            p for p in file_paths
            if p.lower().endswith(".pdf") and p not in faq_paths
        ]
        plain_paths = [
            p for p in file_paths
            if os.path.splitext(p)[1].lower() in PLAIN_TEXT_EXTENSIONS
            and p not in faq_paths
        ]
        other_paths = [
            p for p in file_paths
            if p not in faq_paths
            and p not in excel_paths
            and p not in pdf_paths
            and p not in plain_paths
        ]
        documents: List[Document] = []
        for path in faq_paths:
            doc = self._load_faq_document(path)
            if doc:
                documents.append(doc)
            else:
                logger.warning("FAQ parse yielded empty document: %s", path)
        for path in excel_paths:
            doc = self._load_excel_document(path)
            if doc:
                documents.append(doc)
            else:
                logger.warning("Excel parse yielded empty document: %s", path)
        for path in pdf_paths:
            doc = self._load_pdf_document(path, allow_ocr=allow_pdf_ocr)
            if doc:
                documents.append(doc)
        for path in plain_paths:
            doc = self._load_plain_text_document(path)
            if doc:
                documents.append(doc)
            else:
                logger.warning("Plain-text parse yielded empty document: %s", path)
        if other_paths:
            raw_docs = SimpleDirectoryReader(input_files=other_paths).load_data()
            documents.extend(raw_docs)
        return self._filter_nonempty_documents(documents)

    def is_faq_document(self, doc_id: str) -> bool:
        doc = self.documents_meta.get(doc_id) or {}
        if doc.get("content_type") == FAQ_CONTENT_TYPE:
            return True
        filepath = doc.get("filepath", "")
        return bool(filepath and filepath.lower().endswith(FAQ_FILE_SUFFIX))

    def get_faq_document(self, doc_id: str) -> Dict[str, Any]:
        if doc_id not in self.documents_meta:
            return {"success": False, "error": "Document not found"}
        if not self.is_faq_document(doc_id):
            return {"success": False, "error": "Document is not FAQ"}
        filepath = self.documents_meta[doc_id].get("filepath", "")
        payload = read_faq_payload(filepath) if filepath else None
        if payload is None and filepath and os.path.exists(filepath):
            return {"success": False, "error": "FAQ 文件损坏或无法读取"}
        if payload is None:
            return {"success": False, "error": "FAQ content not found"}
        return {
            "success": True,
            "document_id": doc_id,
            "title": payload.get("title") or self.documents_meta[doc_id].get("filename"),
            "items": payload.get("items") or [],
            "metadata": self.documents_meta[doc_id],
        }

    def _ingest_faq_payload(
        self,
        payload: Dict[str, Any],
        *,
        source_path: str,
        category: str = "faq",
        tags: Optional[List[str]] = None,
        description: str = "",
    ) -> Dict[str, Any]:
        if not self.index:
            return {"success": False, "error": "RAG index not initialized"}

        source_abs = os.path.abspath(source_path)
        if source_abs.lower().endswith(FAQ_FILE_SUFFIX):
            filepath = source_abs
        else:
            filepath = make_faq_filepath(payload.get("title") or "FAQ", knowledge_dir=KNOWLEDGE_DIR)
            write_faq_payload(filepath, payload)
            if source_abs != filepath and os.path.exists(source_abs):
                try:
                    os.remove(source_abs)
                except OSError:
                    logger.warning("Could not remove converted FAQ source: %s", source_abs)

        write_faq_payload(filepath, payload)
        doc_id = str(uuid.uuid4())
        file_name = os.path.basename(filepath)
        file_size = os.path.getsize(filepath) if os.path.exists(filepath) else 0
        faq_count = len(payload.get("items") or [])

        self.documents_meta[doc_id] = {
            "id": doc_id,
            "filename": file_name,
            "filepath": filepath,
            "size": file_size,
            "chunks": 1,
            "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            "updated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            "node_ids": [],
            "category": category,
            "tags": tags or [],
            "description": description or payload.get("title") or "FAQ",
            "content_type": FAQ_CONTENT_TYPE,
            "faq_count": faq_count,
        }

        doc = Document(
            text=faq_payload_to_index_text(payload),
            metadata={
                "file_path": filepath,
                "file_name": file_name,
                "kb_doc_id": doc_id,
                "category": category,
                "tags": ",".join(tags or []),
                "content_type": FAQ_CONTENT_TYPE,
            },
        )
        doc.doc_id = doc_id
        try:
            self.index.insert(doc)
        except Exception as ex:
            del self.documents_meta[doc_id]
            return {"success": False, "error": str(ex)}

        self.index.storage_context.persist(persist_dir=PERSIST_DIR)
        self._save_documents_meta()
        return {
            "success": True,
            "document": {
                "id": doc_id,
                "filename": file_name,
                "size": file_size,
                "content_type": FAQ_CONTENT_TYPE,
                "faq_count": faq_count,
            },
        }

    def import_faq_from_excel(
        self,
        doc_id: str,
        content: bytes,
        *,
        filename: str,
        mode: str = "append",
    ) -> Dict[str, Any]:
        if doc_id not in self.documents_meta:
            return {"success": False, "error": "Document not found"}
        if not self.is_faq_document(doc_id):
            return {"success": False, "error": "Document is not FAQ"}

        payload, parse_err = parse_faq_excel_bytes_detailed(content, filename=filename)
        if not payload:
            return {
                "success": False,
                "error": parse_err or "无法解析 Excel，请确认至少有一行有效 FAQ 数据",
            }

        imported_items = payload.get("items") or []
        if not imported_items:
            return {"success": False, "error": "Excel 中未找到有效问答行"}

        merge_mode = (mode or "append").strip().lower()
        if merge_mode == "replace":
            return self.update_faq_document(doc_id, items=imported_items)

        current = self.get_faq_document(doc_id)
        if not current.get("success"):
            return current

        existing = current.get("items") or []
        base_order = len(existing)
        merged: List[Dict[str, Any]] = list(existing)
        for idx, item in enumerate(imported_items):
            merged.append(
                {
                    **item,
                    "id": str(uuid.uuid4()),
                    "order": base_order + idx,
                }
            )
        result = self.update_faq_document(doc_id, items=merged)
        if result.get("success"):
            result["imported_count"] = len(imported_items)
            result["mode"] = "append"
        return result

    def update_faq_document(
        self,
        doc_id: str,
        *,
        title: Optional[str] = None,
        items: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        if doc_id not in self.documents_meta:
            return {"success": False, "error": "Document not found"}
        if not self.is_faq_document(doc_id):
            return {"success": False, "error": "Document is not FAQ"}

        meta = self.documents_meta[doc_id]
        filepath = meta.get("filepath", "")
        if not filepath:
            return {"success": False, "error": "FAQ file path missing"}

        current = read_faq_payload(filepath) or {"title": meta.get("filename", "FAQ"), "items": []}
        if title is not None:
            current["title"] = title.strip() or current.get("title") or "FAQ"
        if items is not None:
            normalized_items = []
            for idx, raw in enumerate(items):
                if not isinstance(raw, dict):
                    continue
                item = normalize_faq_item(raw, order=idx)
                if item:
                    normalized_items.append(item)
            current["items"] = normalized_items

        write_faq_payload(filepath, current)
        meta["faq_count"] = len(current.get("items") or [])
        meta["updated_at"] = time.strftime("%Y-%m-%d %H:%M:%S")
        meta["size"] = os.path.getsize(filepath) if os.path.exists(filepath) else meta.get("size", 0)
        if title:
            meta["description"] = title
        self._save_documents_meta()
        self._reindex_document(doc_id)
        return {
            "success": True,
            "document_id": doc_id,
            "title": current.get("title"),
            "items": current.get("items") or [],
            "faq_count": meta["faq_count"],
        }

    def create_faq_document(
        self,
        title: str,
        *,
        items: Optional[List[Dict[str, Any]]] = None,
        category: str = "faq",
        tags: Optional[List[str]] = None,
        description: str = "",
    ) -> Dict[str, Any]:
        payload = {
            "title": (title or "FAQ").strip() or "FAQ",
            "version": 1,
            "items": items or [],
        }
        filepath = make_faq_filepath(payload["title"], knowledge_dir=KNOWLEDGE_DIR)
        write_faq_payload(filepath, payload)
        return self._ingest_faq_payload(
            payload,
            source_path=filepath,
            category=category,
            tags=tags,
            description=description or payload["title"],
        )

    @staticmethod
    def _filter_nonempty_documents(documents: List[Document]) -> List[Document]:
        """跳过解析后无正文的文档，避免 Embedding API（如 DashScope）对空 input 报 InvalidParameter。"""
        out: List[Document] = []
        for doc in documents:
            text = (getattr(doc, "text", None) or "").strip()
            if not text:
                fp = doc.metadata.get("file_path", "?")
                logger.warning("Skipping document with empty text after parse: %s", fp)
                continue
            # LlamaIndex 新版 Document.text 只读，需新建实例以传入 strip 后的正文
            meta = dict(doc.metadata) if doc.metadata else {}
            out.append(Document(text=text, metadata=meta))
        return out

    # -------------------------
    # 分类管理方法
    # -------------------------

    def get_categories(self) -> List[Dict]:
        """获取所有分类，附带每类文档数量（含文档中使用但未注册的分类）"""
        counts: Dict[str, int] = {}
        for doc in self.documents_meta.values():
            cat = doc.get("category", "uncategorized")
            counts[cat] = counts.get(cat, 0) + 1

        result: List[Dict] = []
        seen: set[str] = set()
        for cat in self.categories.values():
            cat_id = cat["id"]
            seen.add(cat_id)
            result.append({**cat, "document_count": counts.get(cat_id, 0)})

        for cat_id, count in counts.items():
            if cat_id in seen or count <= 0:
                continue
            default = next((c for c in DEFAULT_CATEGORIES if c["id"] == cat_id), None)
            if default:
                result.append({**default, "document_count": count})
            else:
                result.append({
                    "id": cat_id,
                    "name": cat_id,
                    "description": "",
                    "color": "#6B7280",
                    "icon": "📁",
                    "document_count": count,
                })
        return result

    def create_category(self, category_id: str, name: str, description: str = "", color: str = "#6B7280", icon: str = "📁") -> Dict[str, Any]:
        """创建新分类"""
        if category_id in self.categories:
            return {"success": False, "error": f"Category '{category_id}' already exists"}
        self.categories[category_id] = {
            "id": category_id,
            "name": name,
            "description": description,
            "color": color,
            "icon": icon,
            "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        }
        self._save_categories()
        return {"success": True, "category": self.categories[category_id]}

    def delete_category(self, category_id: str) -> Dict[str, Any]:
        """删除分类，该分类下文档移入 uncategorized"""
        if category_id not in self.categories:
            return {"success": False, "error": "Category not found"}
        if category_id == "uncategorized":
            return {"success": False, "error": "Cannot delete default category"}
        moved = 0
        moved_ids: List[str] = []
        for doc in self.documents_meta.values():
            if doc.get("category") == category_id:
                doc["category"] = "uncategorized"
                moved += 1
                doc_id = doc.get("id")
                if doc_id:
                    moved_ids.append(doc_id)
        del self.categories[category_id]
        self._save_categories()
        if moved > 0:
            self._save_documents_meta()
            for doc_id in moved_ids:
                self._reindex_document(doc_id)
        return {"success": True, "moved_documents": moved}

    def get_documents_by_category(self, category_id: str) -> List[Dict]:
        """获取指定分类下的所有文档"""
        return [
            doc for doc in self.documents_meta.values()
            if doc.get("category", "uncategorized") == category_id
        ]

    def update_document_metadata(self, doc_id: str, category: Optional[str] = None,
                                  tags: Optional[List[str]] = None,
                                  description: Optional[str] = None) -> Dict[str, Any]:
        """更新文档的分类/标签/描述"""
        if doc_id not in self.documents_meta:
            return {"success": False, "error": "Document not found"}
        doc = self.documents_meta[doc_id]
        old_category = doc.get("category")
        if category is not None:
            doc["category"] = category
        if tags is not None:
            doc["tags"] = tags
        if description is not None:
            doc["description"] = description
        self._save_documents_meta()
        if category is not None and category != old_category:
            self._reindex_document(doc_id)
        return {"success": True, "document": doc}

    def append_document_content(
        self,
        doc_id: str,
        content: str,
        *,
        section_title: str = "",
    ) -> Dict[str, Any]:
        """向已有文档动态追加文本内容，并重建索引。"""
        if doc_id not in self.documents_meta:
            return {"success": False, "error": "Document not found"}

        normalized = (content or "").strip()
        if not normalized:
            return {"success": False, "error": "Content is empty"}

        doc_info = self.documents_meta[doc_id]
        filepath = doc_info.get("filepath", "")
        ext = os.path.splitext(filepath)[1].lower() if filepath else ""
        timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
        heading = (section_title or "追加内容").strip()
        block = f"\n\n---\n\n## {heading} ({timestamp})\n\n{normalized}\n"
        append_target = filepath
        sidecar_created = False

        text_like = ext in {".txt", ".md", ".json", ".csv"}
        if text_like and filepath and os.path.exists(filepath):
            with open(filepath, "a", encoding="utf-8") as f:
                f.write(block)
            try:
                doc_info["size"] = os.path.getsize(filepath)
            except OSError:
                pass
        else:
            base_name = (
                os.path.splitext(os.path.basename(filepath))[0]
                if filepath
                else doc_id[:8]
            )
            sidecar_name = f"{base_name}_append_{time.strftime('%Y%m%d_%H%M%S')}.md"
            sidecar_path = os.path.join(KNOWLEDGE_DIR, sidecar_name)
            parent_label = doc_info.get("filename") or doc_id
            with open(sidecar_path, "w", encoding="utf-8") as f:
                f.write(
                    f"> 关联文档: {parent_label} (`{doc_id}`)\n\n"
                    f"{block.strip()}\n"
                )
            append_target = sidecar_path
            sidecar_created = True
            linked_tags = list(doc_info.get("tags") or [])
            if f"parent:{doc_id}" not in linked_tags:
                linked_tags.append(f"parent:{doc_id}")
            sidecar_result = self.ingest_documents(
                [sidecar_path],
                category=doc_info.get("category", "uncategorized"),
                tags=linked_tags,
                description=f"追加片段 · 关联 {parent_label}",
            )
            if not sidecar_result.get("success"):
                if os.path.exists(sidecar_path):
                    os.remove(sidecar_path)
                return sidecar_result

        doc_info["append_count"] = int(doc_info.get("append_count") or 0) + 1
        doc_info["updated_at"] = timestamp
        self._save_documents_meta()

        if text_like and filepath and os.path.exists(filepath):
            self._reindex_document(doc_id)

        return {
            "success": True,
            "message": "Content appended successfully",
            "document": doc_info,
            "append_target": append_target,
            "sidecar_created": sidecar_created,
        }

    @staticmethod
    def _split_markdown_frontmatter(text: str) -> tuple[Dict[str, str], str]:
        if not text.startswith("---\n"):
            return {}, text
        end = text.find("\n---\n", 4)
        if end < 0:
            return {}, text
        fm_block = text[4:end]
        body = text[end + 5 :]
        frontmatter: Dict[str, str] = {}
        for line in fm_block.splitlines():
            if ":" not in line:
                continue
            key, value = line.split(":", 1)
            frontmatter[key.strip()] = value.strip()
        return frontmatter, body

    @staticmethod
    def _compose_markdown_with_frontmatter(
        frontmatter: Dict[str, str],
        body: str,
    ) -> str:
        normalized = (body or "").strip()
        if not frontmatter:
            return normalized + "\n"
        fm_lines = "\n".join(f"{k}: {v}" for k, v in frontmatter.items())
        return f"---\n{fm_lines}\n---\n\n{normalized}\n"

    def get_document_content(self, doc_id: str) -> Dict[str, Any]:
        """读取知识库文档正文（FAQ 除外）。"""
        if doc_id not in self.documents_meta:
            return {"success": False, "error": "Document not found"}
        if self.is_faq_document(doc_id):
            return {"success": False, "error": "FAQ 文档请使用 FAQ 编辑器"}

        doc_info = self.documents_meta[doc_id]
        filepath = doc_info.get("filepath", "")
        if not filepath or not os.path.exists(filepath):
            return {"success": False, "error": "Document file not found on disk"}

        ext = os.path.splitext(filepath)[1].lower()
        if ext not in {".txt", ".md", ".json", ".csv"}:
            return {
                "success": False,
                "error": "该文档类型暂不支持正文编辑，请删除后重新上传转化",
                "editable": False,
            }

        try:
            with open(filepath, "r", encoding="utf-8", errors="replace") as f:
                raw = f.read()
        except OSError as ex:
            return {"success": False, "error": f"Failed to read document: {ex}"}

        frontmatter, body = self._split_markdown_frontmatter(raw)
        content = body.strip()
        return {
            "success": True,
            "doc_id": doc_id,
            "filename": doc_info.get("filename"),
            "content": content,
            "raw_content": raw,
            "frontmatter": frontmatter,
            "editable": True,
            "char_count": len(content),
            "source_filename": doc_info.get("source_filename") or "",
            "source_type": doc_info.get("source_type") or "",
        }

    def update_document_content(self, doc_id: str, content: str) -> Dict[str, Any]:
        """覆盖更新文档正文并重建向量索引。"""
        if doc_id not in self.documents_meta:
            return {"success": False, "error": "Document not found"}
        if self.is_faq_document(doc_id):
            return {"success": False, "error": "FAQ 文档请使用 FAQ 编辑器"}

        normalized = (content or "").strip()
        if not normalized:
            return {"success": False, "error": "Content is empty"}

        doc_info = self.documents_meta[doc_id]
        filepath = doc_info.get("filepath", "")
        ext = os.path.splitext(filepath)[1].lower() if filepath else ""
        if ext not in {".txt", ".md", ".json", ".csv"}:
            return {"success": False, "error": "该文档类型不支持正文编辑"}

        if not filepath or not os.path.exists(filepath):
            return {"success": False, "error": "Document file not found on disk"}

        try:
            with open(filepath, "r", encoding="utf-8", errors="replace") as f:
                current_raw = f.read()
        except OSError as ex:
            return {"success": False, "error": f"Failed to read document: {ex}"}

        frontmatter, _ = self._split_markdown_frontmatter(current_raw)
        new_raw = self._compose_markdown_with_frontmatter(frontmatter, normalized)
        try:
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(new_raw)
        except OSError as ex:
            return {"success": False, "error": f"Failed to write document: {ex}"}

        timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
        doc_info["char_count"] = len(normalized)
        try:
            doc_info["size"] = os.path.getsize(filepath)
        except OSError:
            pass
        doc_info["updated_at"] = timestamp
        self._save_documents_meta()
        self._reindex_document(doc_id)

        return {
            "success": True,
            "message": "Document content updated",
            "document": doc_info,
            "char_count": len(normalized),
        }

    def mark_content_optimized(
        self,
        doc_id: str,
        *,
        method: str = "",
        unchanged: bool = False,
    ) -> None:
        """标记文档已完成正文优化，避免重复触发自动优化。"""
        if doc_id not in self.documents_meta:
            return
        doc_info = self.documents_meta[doc_id]
        doc_info["content_optimized"] = True
        doc_info["content_optimized_at"] = time.strftime("%Y-%m-%d %H:%M:%S")
        if method:
            doc_info["content_optimize_method"] = method
        if unchanged:
            doc_info["content_optimize_unchanged"] = True
        self._save_documents_meta()

    def create_text_document(
        self,
        title: str,
        content: str,
        *,
        category: str = "uncategorized",
        tags: Optional[List[str]] = None,
        description: str = "",
    ) -> Dict[str, Any]:
        """从纯文本快速创建 Markdown 知识条目。"""
        normalized_title = (title or "").strip() or "未命名笔记"
        normalized_content = (content or "").strip()
        if not normalized_content:
            return {"success": False, "error": "Content is empty"}

        safe_base = "".join(
            ch if ch.isalnum() or ch in "-_" else "_"
            for ch in normalized_title[:40]
        ).strip("_") or "note"
        filename = f"{safe_base}_{time.strftime('%Y%m%d_%H%M%S')}.md"
        filepath = os.path.join(KNOWLEDGE_DIR, filename)
        body = f"# {normalized_title}\n\n{normalized_content}\n"
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(body)

        return self.ingest_documents(
            [filepath],
            category=category,
            tags=tags or [],
            description=description or normalized_title,
        )

    def find_document_by_source_url(self, source_url: str) -> Optional[Dict[str, Any]]:
        """查找是否已导入相同来源 URL 的文档。"""
        needle = (source_url or "").strip().rstrip("/")
        if not needle:
            return None
        for doc in self.documents_meta.values():
            existing = (doc.get("source_url") or doc.get("source_filename") or "").strip().rstrip("/")
            if existing and existing == needle:
                return doc
        return None

    def ingest_from_url(
        self,
        url: str,
        *,
        category: str = "uncategorized",
        tags: Optional[List[str]] = None,
        description: str = "",
        title: str = "",
        auto_category: bool = False,
    ) -> Dict[str, Any]:
        """抓取公开网页并导入知识库。"""
        from services.knowledge_content_optimizer import cleanup_extracted_text
        from utils.knowledge_url_fetch import fetch_url_content, normalize_knowledge_url

        normalized_url = normalize_knowledge_url(url)
        if not normalized_url:
            return {"success": False, "error": "请输入有效的 http(s) 链接"}

        existing = self.find_document_by_source_url(normalized_url)
        if existing:
            return {
                "success": False,
                "error": f"该链接已导入：{existing.get('filename') or existing.get('id')}",
                "existing_document_id": existing.get("id"),
            }

        fetched = fetch_url_content(normalized_url)
        if not fetched.get("success"):
            return fetched

        page_title = (title or fetched.get("title") or "").strip() or "网页摘录"
        body = cleanup_extracted_text((fetched.get("content") or "").strip())
        if not body:
            return {"success": False, "error": "页面正文清理后为空，无法写入知识库"}

        final_url = (fetched.get("final_url") or normalized_url).strip()
        safe_base = self._sanitize_knowledge_basename(page_title) or "web_page"
        timestamp = time.strftime("%Y%m%d_%H%M%S")
        md_name = f"{safe_base}_{timestamp}.md"
        converted_path = os.path.join(KNOWLEDGE_DIR, md_name)
        converted_at = time.strftime("%Y-%m-%d %H:%M:%S")

        frontmatter = (
            f"---\n"
            f"source_url: {final_url}\n"
            f"source_type: url\n"
            f"imported_at: {converted_at}\n"
            f"---\n\n"
        )
        if body.startswith("#"):
            markdown_body = frontmatter + body + "\n"
        else:
            markdown_body = frontmatter + f"# {page_title}\n\n{body}\n"

        with open(converted_path, "w", encoding="utf-8") as f:
            f.write(markdown_body)

        use_auto = auto_category or category in ("auto", "")
        category_resolution = self.resolve_upload_category(
            converted_path,
            f"{page_title}.md",
            category,
            auto_category=use_auto,
        )
        resolved_category = category_resolution["category_id"]
        merged_tags = list(tags or [])
        if f"url:{final_url}" not in merged_tags:
            merged_tags.append(f"url:{final_url}")

        result = self.ingest_documents(
            [converted_path],
            resolved_category,
            merged_tags,
            description or page_title,
            source_filename=final_url,
            source_type="url",
            display_filename=f"{page_title}.md",
        )
        if not result.get("success"):
            return result

        for doc in result.get("documents") or []:
            doc_id = doc.get("id")
            if doc_id and doc_id in self.documents_meta:
                self.documents_meta[doc_id]["source_url"] = final_url
                self.documents_meta[doc_id]["converted"] = True
        self._save_documents_meta()

        return {
            **result,
            "message": f"已将网页「{page_title}」导入知识库",
            "assigned_category": resolved_category,
            "auto_assigned": category_resolution.get("auto_assigned", False),
            "category_confidence": category_resolution.get("confidence"),
            "category_reason": category_resolution.get("reason"),
            "source_url": final_url,
            "title": page_title,
            "char_count": fetched.get("char_count"),
        }

    # -------------------------
    # 智能分类
    # -------------------------

    def extract_preview_text(self, file_path: str, max_chars: int = 2000) -> str:
        """轻量提取文档预览文本，用于分类（避免完整 OCR）。"""
        if not file_path or not os.path.exists(file_path):
            return ""
        ext = os.path.splitext(file_path)[1].lower()
        try:
            if ext in PLAIN_TEXT_EXTENSIONS:
                with open(file_path, "r", encoding="utf-8", errors="replace") as f:
                    return f.read(max_chars).strip()
            if ext in EXCEL_EXTENSIONS:
                doc = self._load_excel_document(file_path)
                return (doc.text[:max_chars] if doc and doc.text else "").strip()
            if file_path.lower().endswith(FAQ_FILE_SUFFIX):
                payload = read_faq_payload(file_path)
                if payload:
                    return faq_payload_to_index_text(payload)[:max_chars].strip()
            if ext == ".pdf":
                try:
                    import fitz  # PyMuPDF

                    parts: List[str] = []
                    with fitz.open(file_path) as pdf:
                        for page in pdf[:3]:
                            parts.append(page.get_text("text"))
                            if sum(len(p) for p in parts) >= max_chars:
                                break
                    return "\n".join(parts)[:max_chars].strip()
                except Exception:
                    try:
                        from pypdf import PdfReader

                        reader = PdfReader(file_path)
                        parts = []
                        for page in reader.pages[:3]:
                            parts.append(page.extract_text() or "")
                            if sum(len(p) for p in parts) >= max_chars:
                                break
                        return "\n".join(parts)[:max_chars].strip()
                    except Exception:
                        return ""
            if ext in {".docx", ".doc"}:
                raw_docs = SimpleDirectoryReader(input_files=[file_path]).load_data()
                if raw_docs:
                    return (raw_docs[0].text or "")[:max_chars].strip()
        except Exception as ex:
            logger.debug("Preview extract failed for %s: %s", file_path, ex)
        return ""

    def suggest_category(self, filename: str, content_preview: str = "") -> Dict[str, Any]:
        """根据文件名与内容预览推荐知识库分类。"""
        ext = os.path.splitext(filename)[1].lower()
        name_lower = filename.lower()
        preview = (content_preview or "").strip()
        combined = f"{filename}\n{preview[:800]}".lower()

        if ext == ".json" and ("faq" in name_lower or "问答" in filename):
            return {"category_id": "faq", "confidence": "high", "reason": "filename"}
        if preview and ("\"items\"" in preview or "'items'" in preview) and (
            "question" in combined or "answer" in combined or "问题" in combined
        ):
            return {"category_id": "faq", "confidence": "high", "reason": "content"}

        keyword_rules = [
            (["api", "架构", "技术", "开发", "code", "dev", "technical", "sdk", "接口"], "technical"),
            (["产品", "需求", "prd", "product", "规格", "功能说明"], "product-docs"),
            (["营销", "品牌", "文案", "活动", "marketing", "推广", "社媒"], "marketing"),
            (["调研", "研究", "报告", "行业", "分析", "白皮书"], "knowledge"),
            (["faq", "问答", "常见问题", "q&a"], "faq"),
        ]
        for keywords, cat_id in keyword_rules:
            if any(kw in combined for kw in keywords) and cat_id in self.categories:
                return {"category_id": cat_id, "confidence": "medium", "reason": "keyword"}

        valid_ids = {c["id"] for c in self.get_categories()}
        if not self.llm or not preview:
            return {"category_id": "uncategorized", "confidence": "low", "reason": "fallback"}

        cat_lines = "\n".join(
            f"- {c['id']}: {c['name']}（{c.get('description', '')}）"
            for c in self.get_categories()
            if c["id"] != "uncategorized"
        )
        prompt = (
            "你是知识库分类助手。根据文档文件名与内容摘要，从下列分类中选出最合适的一个。\n"
            "只回复分类 id（如 technical），不要解释。若无合适分类则回复 uncategorized。\n\n"
            f"可选分类：\n{cat_lines}\n\n"
            f"文件名：{filename}\n"
            f"内容摘要：\n{preview[:1200]}\n\n"
            "分类 id："
        )
        try:
            response = self.llm.complete(prompt)
            raw = str(getattr(response, "text", response) or "").strip().lower()
            raw = raw.split()[0].strip("\"'`.,;:")
            if raw in valid_ids:
                return {"category_id": raw, "confidence": "high", "reason": "llm"}
        except Exception as ex:
            logger.warning("Category suggestion LLM failed: %s", ex)

        return {"category_id": "uncategorized", "confidence": "low", "reason": "fallback"}

    def resolve_upload_category(
        self,
        file_path: str,
        filename: str,
        category: str,
        *,
        auto_category: bool = False,
    ) -> Dict[str, Any]:
        """解析上传使用的分类；auto_category 时自动分析。"""
        if not auto_category and category and category not in ("auto", "uncategorized"):
            return {
                "category_id": category,
                "auto_assigned": False,
                "confidence": None,
                "reason": "manual",
            }

        preview = self.extract_preview_text(file_path)
        suggestion = self.suggest_category(filename, preview)
        return {
            "category_id": suggestion["category_id"],
            "auto_assigned": True,
            "confidence": suggestion.get("confidence"),
            "reason": suggestion.get("reason"),
        }

    # -------------------------
    # 上传转化
    # -------------------------

    @staticmethod
    def _sanitize_knowledge_basename(name: str, max_len: int = 48) -> str:
        base = os.path.splitext(os.path.basename(name or "document"))[0]
        safe = "".join(
            ch if ch.isalnum() or ch in "-_ " else "_"
            for ch in base
        ).strip()
        safe = "_".join(safe.split())[:max_len].strip("_")
        return safe or "document"

    @staticmethod
    def _display_title_from_basename(safe_base: str) -> str:
        return safe_base.replace("_", " ").strip() or "未命名文档"

    def convert_upload_to_knowledge_markdown(
        self,
        source_path: str,
        original_filename: str,
    ) -> Dict[str, Any]:
        """
        将上传源文件解析为 Markdown 知识条目。
        源文件仅作临时输入，转化成功后删除，知识库落盘为 .md 文本。
        """
        if not source_path or not os.path.exists(source_path):
            return {"success": False, "error": "源文件不存在或已失效"}

        faq_payload = try_parse_faq_file(source_path)
        if faq_payload:
            return {
                "success": False,
                "error": "FAQ 文件请走 FAQ 导入流程",
                "is_faq": True,
            }

        documents = self._load_documents_from_paths([source_path])
        if not documents:
            ext = os.path.splitext(original_filename)[1].lower()
            hint = ""
            if ext == ".pdf":
                hint = "（扫描版 PDF 需配置 OCR / 视觉模型 Key）"
            return {
                "success": False,
                "error": f"未能从源文件提取可用文本{hint}",
            }

        text = (documents[0].text or "").strip()
        if not text:
            return {"success": False, "error": "源文件解析结果为空，无法写入知识库"}

        from services.knowledge_content_optimizer import cleanup_extracted_text

        text = cleanup_extracted_text(text)
        if not text:
            return {"success": False, "error": "清理后正文为空，无法写入知识库"}

        safe_base = self._sanitize_knowledge_basename(original_filename)
        display_title = self._display_title_from_basename(safe_base)
        timestamp = time.strftime("%Y%m%d_%H%M%S")
        md_name = f"{safe_base}_{timestamp}.md"
        converted_path = os.path.join(KNOWLEDGE_DIR, md_name)

        source_ext = os.path.splitext(original_filename)[1].lower().lstrip(".") or "unknown"
        converted_at = time.strftime("%Y-%m-%d %H:%M:%S")
        frontmatter = (
            f"---\n"
            f"source_file: {original_filename}\n"
            f"source_type: {source_ext}\n"
            f"converted_at: {converted_at}\n"
            f"---\n\n"
        )
        if text.startswith("#"):
            body = frontmatter + text + "\n"
        else:
            body = frontmatter + f"# {display_title}\n\n{text}\n"

        with open(converted_path, "w", encoding="utf-8") as f:
            f.write(body)

        try:
            if os.path.abspath(source_path) != os.path.abspath(converted_path):
                os.remove(source_path)
        except OSError as ex:
            logger.warning("Failed to remove upload source %s: %s", source_path, ex)

        logger.info(
            "Converted upload %s -> %s (%s chars)",
            original_filename,
            converted_path,
            len(text),
        )
        return {
            "success": True,
            "converted_path": os.path.abspath(converted_path),
            "display_filename": f"{display_title}.md",
            "source_filename": original_filename,
            "source_type": source_ext,
            "char_count": len(text),
        }

    # -------------------------
    # 文档摄取
    # -------------------------

    def ingest_documents(self, file_paths: List[str], category: str = "uncategorized",
                          tags: Optional[List[str]] = None,
                          description: str = "",
                          *,
                          source_filename: Optional[str] = None,
                          source_type: Optional[str] = None,
                          display_filename: Optional[str] = None,
                          persist: bool = True,
                          allow_pdf_ocr: bool = True) -> Dict[str, Any]:
        """
        读取文件并更新索引。
        返回导入结果信息。
        """
        if not file_paths:
            return {"success": False, "error": "No files provided"}

        if not self.index:
            return {"success": False, "error": "RAG index not initialized"}

        try:
            logger.info(f"Ingesting {len(file_paths)} files...")
            ingest_errors: List[str] = []
            ingested_docs: List[Dict[str, Any]] = []
            generic_paths: List[str] = []

            for path in file_paths:
                faq_payload = try_parse_faq_file(path)
                if faq_payload:
                    faq_result = self._ingest_faq_payload(
                        faq_payload,
                        source_path=path,
                        category=category if category != "uncategorized" else "faq",
                        tags=tags,
                        description=description or faq_payload.get("title") or "FAQ",
                    )
                    if faq_result.get("success"):
                        ingested_docs.append(faq_result["document"])
                    else:
                        ingest_errors.append(
                            f"{os.path.basename(path)}: {faq_result.get('error', 'FAQ ingest failed')}"
                        )
                else:
                    generic_paths.append(path)

            documents = (
                self._load_documents_from_paths(generic_paths, allow_pdf_ocr=allow_pdf_ocr)
                if generic_paths
                else []
            )

            if not documents and not ingested_docs:
                hints: List[str] = []
                if any(p.lower().endswith(".pdf") for p in file_paths):
                    hints.append(
                        "纯图片/扫描 PDF 需 OCR（视觉模型 API Key）；请确认 ALIBABA/DASHSCOPE 等 Key 已配置"
                    )
                if any(
                    os.path.splitext(p)[1].lower() == ".json"
                    for p in file_paths
                ):
                    hints.append("JSON FAQ 需包含 items 数组，每项含 question/answer 字段")
                msg = (
                    "所有文件解析后均无可用文本（空文件、损坏或解析为空），无法写入向量索引。"
                    + (" " + "；".join(hints) if hints else " FAQ 文件需包含 items/question/answer 字段。")
                )
                if ingest_errors:
                    msg += f" 详情: {'; '.join(ingest_errors[:3])}"
                logger.warning(msg)
                return {"success": False, "error": msg, "ingest_errors": ingest_errors or None}

            for doc in documents:
                doc_id = str(uuid.uuid4())
                file_path = doc.metadata.get("file_path", "unknown")
                file_name = os.path.basename(file_path)
                file_size = os.path.getsize(file_path) if os.path.exists(file_path) else 0
                stored_filename = display_filename or file_name
                merged_tags = list(tags or [])
                if source_filename and f"source:{source_filename}" not in merged_tags:
                    merged_tags.append(f"source:{source_filename}")

                self.documents_meta[doc_id] = {
                    "id": doc_id,
                    "filename": stored_filename,
                    "filepath": file_path,
                    "size": file_size,
                    "chunks": 1,
                    "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
                    "node_ids": [],
                    "category": category,
                    "tags": merged_tags,
                    "description": description or stored_filename,
                    "content_type": doc.metadata.get("content_type", "document"),
                    "source_filename": source_filename or "",
                    "source_type": source_type or "",
                    "converted": bool(source_filename),
                    "char_count": len(doc.text or ""),
                }

                doc.doc_id = doc_id
                doc.metadata["kb_doc_id"] = doc_id
                doc.metadata["category"] = category
                doc.metadata["tags"] = ",".join(tags or [])

                try:
                    self.index.insert(doc)
                except Exception as ex:
                    del self.documents_meta[doc_id]
                    err = f"{file_name}: {ex}"
                    ingest_errors.append(err)
                    logger.warning("Ingest insert failed for %s: %s", file_path, ex)
                    continue

                ingested_docs.append({
                    "id": doc_id,
                    "filename": stored_filename,
                    "size": file_size,
                    "content_type": self.documents_meta[doc_id].get("content_type", "document"),
                    "source_filename": source_filename or "",
                    "source_type": source_type or "",
                    "converted": bool(source_filename),
                    "char_count": len(doc.text or ""),
                })

            if not ingested_docs:
                detail = ingest_errors[0] if ingest_errors else "未知错误"
                return {
                    "success": False,
                    "error": f"未能写入任何文档（Embedding/索引失败）。首条错误: {detail}",
                    "ingest_errors": ingest_errors,
                }

            if persist:
                self.index.storage_context.persist(persist_dir=PERSIST_DIR)
                self._save_documents_meta()

            logger.info(
                "Ingested %s documents (%s generic parsed, %s errors)",
                len(ingested_docs),
                len(documents),
                len(ingest_errors),
            )
            msg = f"Successfully ingested {len(ingested_docs)} documents"
            if ingest_errors:
                msg += f"; {len(ingest_errors)} file(s) failed (see logs)"
            return {
                "success": True,
                "message": msg,
                "documents": ingested_docs,
                "ingest_errors": ingest_errors or None,
            }
        except Exception as e:
            logger.error(f"Failed to ingest documents: {e}")
            return {"success": False, "error": str(e)}

    def retrieve(
        self,
        question: str,
        top_k: int = 3,
        category: Optional[str] = None,
        doc_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Vector retrieval only (no LLM synthesis)."""
        if not self.index:
            return {"success": False, "error": "RAG index not initialized", "sources": []}

        try:
            filter_category = category if (category and category != "all") else None
            filter_doc_id = doc_id.strip() if doc_id else None
            similarity_top_k = max(top_k * 3, 5) if (filter_category or filter_doc_id) else top_k

            retriever_kwargs: Dict[str, Any] = {"similarity_top_k": similarity_top_k}
            try:
                from llama_index.core.vector_stores import MetadataFilters, ExactMatchFilter

                if filter_category:
                    retriever_kwargs["filters"] = MetadataFilters(
                        filters=[ExactMatchFilter(key="category", value=filter_category)]
                    )
                elif filter_doc_id:
                    retriever_kwargs["filters"] = MetadataFilters(
                        filters=[ExactMatchFilter(key="kb_doc_id", value=filter_doc_id)]
                    )
            except Exception:
                pass

            retriever = self.index.as_retriever(**retriever_kwargs)
            nodes = retriever.retrieve(question)

            sources = []
            for node in nodes:
                node_meta = node.metadata or {}
                node_category = node_meta.get("category", "uncategorized")
                node_doc_id = node_meta.get("kb_doc_id") or node_meta.get("doc_id")
                if filter_category and node_category != filter_category:
                    continue
                if filter_doc_id and node_doc_id != filter_doc_id:
                    continue
                text = node.get_content() if hasattr(node, "get_content") else getattr(node, "text", "")
                file_name = node_meta.get("file_name") or node_meta.get("filename") or ""
                score = float(node.score) if getattr(node, "score", None) is not None else 0.0
                sources.append({
                    "text": text[:200] + "..." if len(text) > 200 else text,
                    "score": score,
                    "metadata": node_meta,
                    "category": node_category,
                    "doc_id": node_doc_id,
                    "file_name": file_name,
                })
                if len(sources) >= top_k:
                    break

            return {
                "success": True,
                "sources": sources,
                "category": filter_category,
                "doc_id": filter_doc_id,
            }
        except Exception as e:
            logger.error("Retrieve failed: %s", e)
            return {"success": False, "error": str(e), "sources": []}

    def query(
        self,
        question: str,
        top_k: int = 3,
        category: Optional[str] = None,
        doc_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        查询知识库，返回结构化结果。
        当 category 非空且非 'all' 时，仅在该分类下检索。
        doc_id 非空时，仅检索指定文档。
        """
        if not self.index:
            return {"success": False, "error": "RAG index not initialized", "answer": ""}

        try:
            # 尝试使用 MetadataFilters 按分类过滤
            filter_category = category if (category and category != "all") else None
            filter_doc_id = doc_id.strip() if doc_id else None

            if filter_category:
                try:
                    from llama_index.core.vector_stores import MetadataFilters, ExactMatchFilter
                    filters = MetadataFilters(
                        filters=[ExactMatchFilter(key="category", value=filter_category)]
                    )
                    query_engine = self.index.as_query_engine(
                        similarity_top_k=top_k * 3,  # 扩大候选集以确保过滤后有足够结果
                        filters=filters,
                        streaming=False,
                    )
                except Exception:
                    # 降级：不过滤，检索后手动按 category 筛选
                    query_engine = self.index.as_query_engine(
                        similarity_top_k=top_k * 5,
                        streaming=False,
                    )
            elif filter_doc_id:
                try:
                    from llama_index.core.vector_stores import MetadataFilters, ExactMatchFilter
                    filters = MetadataFilters(
                        filters=[ExactMatchFilter(key="kb_doc_id", value=filter_doc_id)]
                    )
                    query_engine = self.index.as_query_engine(
                        similarity_top_k=max(top_k * 3, 5),
                        filters=filters,
                        streaming=False,
                    )
                except Exception:
                    query_engine = self.index.as_query_engine(
                        similarity_top_k=top_k * 5,
                        streaming=False,
                    )
            else:
                query_engine = self.index.as_query_engine(
                    similarity_top_k=top_k,
                    streaming=False,
                )

            response = query_engine.query(question)

            # 提取源文档信息
            sources = []
            if hasattr(response, 'source_nodes'):
                for node in response.source_nodes:
                    node_meta = node.metadata or {}
                    node_category = node_meta.get("category", "uncategorized")
                    node_doc_id = node_meta.get("kb_doc_id") or node_meta.get("doc_id")
                    # 手动后置过滤（MetadataFilters 不支持时的兜底）
                    if filter_category and node_category != filter_category:
                        continue
                    if filter_doc_id and node_doc_id != filter_doc_id:
                        continue
                    file_name = node_meta.get("file_name") or node_meta.get("filename") or ""
                    sources.append({
                        "text": node.text[:200] + "..." if len(node.text) > 200 else node.text,
                        "score": float(node.score) if hasattr(node, 'score') else 0.0,
                        "metadata": node_meta,
                        "category": node_category,
                        "doc_id": node_doc_id,
                        "file_name": file_name,
                    })
                    if len(sources) >= top_k:
                        break

            return {
                "success": True,
                "answer": str(response),
                "sources": sources,
                "category": filter_category,
                "doc_id": filter_doc_id,
            }
        except Exception as e:
            logger.error(f"Query failed: {e}")
            return {"success": False, "error": str(e), "answer": ""}

    def get_documents_info(self, category: Optional[str] = None) -> List[Dict]:
        """获取已导入文档的元数据，可按分类过滤"""
        docs = list(self.documents_meta.values())
        if category and category != "all":
            docs = [d for d in docs if d.get("category", "uncategorized") == category]
        return docs

    def _reindex_document(self, doc_id: str) -> bool:
        """Incrementally re-index a single document (remove + insert)."""
        if doc_id not in self.documents_meta or not self.index:
            return False

        self._remove_doc_from_index(doc_id)
        meta = self.documents_meta[doc_id]
        filepath = meta.get("filepath", "")
        if not filepath or not os.path.exists(filepath):
            if self.index:
                self.index.storage_context.persist(persist_dir=PERSIST_DIR)
            return True

        try:
            if self.is_faq_document(doc_id):
                payload = read_faq_payload(filepath)
                if not payload:
                    return False
                doc = Document(
                    text=faq_payload_to_index_text(payload),
                    metadata={
                        "file_path": filepath,
                        "file_name": os.path.basename(filepath),
                        "kb_doc_id": doc_id,
                        "category": meta.get("category", "uncategorized"),
                        "tags": ",".join(meta.get("tags") or []),
                        "content_type": FAQ_CONTENT_TYPE,
                    },
                )
                doc.doc_id = doc_id
                self.index.insert(doc)
            else:
                documents = self._load_documents_from_paths([filepath])
                if not documents:
                    return False
                for doc in documents:
                    doc.doc_id = doc_id
                    doc.metadata["kb_doc_id"] = doc_id
                    doc.metadata["category"] = meta.get("category", "uncategorized")
                    doc.metadata["tags"] = ",".join(meta.get("tags") or [])
                    self.index.insert(doc)

            self.index.storage_context.persist(persist_dir=PERSIST_DIR)
            logger.info("Re-indexed document %s", doc_id)
            return True
        except Exception as ex:
            logger.warning("Re-index failed for %s: %s", doc_id, ex)
            return False

    def _remove_doc_from_index(self, doc_id: str) -> bool:
        """从向量索引中移除单个文档，避免全量重建。"""
        if not self.index:
            logger.warning("Index not initialized; skip vector removal for %s", doc_id)
            return False
        try:
            self.index.delete_ref_doc(doc_id, delete_from_docstore=True)
            self.index.storage_context.persist(persist_dir=PERSIST_DIR)
            logger.info("Removed document %s from vector index", doc_id)
            return True
        except Exception as e:
            logger.warning(
                "delete_ref_doc failed for %s (%s); falling back to rebuild",
                doc_id,
                e,
            )
            return False

    def delete_document(self, doc_id: str) -> Dict[str, Any]:
        """从知识库删除指定文档（优先增量删索引，失败时才全量重建）。"""
        if doc_id not in self.documents_meta:
            return {"success": False, "error": "Document not found"}

        try:
            doc_info = self.documents_meta[doc_id]
            index_removed = self._remove_doc_from_index(doc_id)

            filepath = doc_info.get("filepath", "")
            if filepath and KNOWLEDGE_DIR in filepath and os.path.exists(filepath):
                os.remove(filepath)
                logger.info(f"Deleted source file: {filepath}")

            del self.documents_meta[doc_id]
            self._save_documents_meta()

            if not index_removed:
                self._rebuild_index()

            return {"success": True, "message": f"Document {doc_id} deleted"}
        except Exception as e:
            logger.error(f"Failed to delete document: {e}")
            return {"success": False, "error": str(e)}

    def _rebuild_index(self):
        """重建索引（删除/更新文档后调用），恢复每份文档的完整元数据"""
        try:
            # 构建 filepath -> meta 映射，用于重建时恢复 category/tags
            filepath_to_meta: Dict[str, Dict] = {}
            for doc_meta in self.documents_meta.values():
                fp = doc_meta.get("filepath", "")
                if fp:
                    filepath_to_meta[fp] = doc_meta

            remaining_files = [
                fp for fp in filepath_to_meta
                if os.path.exists(fp)
            ]

            # 清空旧索引
            self.index = self._create_empty_index()

            if remaining_files:
                documents = self._load_documents_from_paths(remaining_files)
                for doc in documents:
                    fp = doc.metadata.get("file_path", "")
                    meta = filepath_to_meta.get(fp, {})
                    doc_id = meta.get("id", str(uuid.uuid4()))
                    doc.doc_id = doc_id
                    doc.metadata["kb_doc_id"] = doc_id
                    doc.metadata["category"] = meta.get("category", "uncategorized")
                    doc.metadata["tags"] = ",".join(meta.get("tags") or [])
                    try:
                        self.index.insert(doc)
                    except Exception as ex:
                        logger.warning("Rebuild insert failed for %s: %s", fp, ex)

            # 持久化
            self.index.storage_context.persist(persist_dir=PERSIST_DIR)
            logger.info("Index rebuilt successfully with %d files", len(remaining_files))
        except Exception as e:
            logger.error(f"Failed to rebuild index: {e}")

    def delete_documents_batch(self, doc_ids: List[str]) -> Dict[str, Any]:
        """
        批量从索引中删除文档（用于本地文件夹管理）。
        不删除源文件（源文件是用户本机文件）。
        """
        if not doc_ids:
            return {"success": True, "removed_count": 0}

        removed = 0
        index_ok = True
        for doc_id in doc_ids:
            if doc_id in self.documents_meta:
                if not self._remove_doc_from_index(doc_id):
                    index_ok = False
                del self.documents_meta[doc_id]
                removed += 1

        if removed > 0:
            self._save_documents_meta()
            if not index_ok:
                self._rebuild_index()
            elif self.index:
                self.index.storage_context.persist(persist_dir=PERSIST_DIR)

        logger.info(f"Batch deleted {removed} docs from RAG index")
        return {"success": True, "removed_count": removed}

    def clear_all(self) -> Dict[str, Any]:
        """清空整个知识库（文档和索引），保留分类定义"""
        try:
            # 清空元数据
            self.documents_meta = {}
            self._save_documents_meta()

            # 清空索引目录（保留元数据文件和分类文件）
            preserved = {"documents_meta.json", "categories.json"}
            for f in os.listdir(PERSIST_DIR):
                if f in preserved:
                    continue
                fpath = os.path.join(PERSIST_DIR, f)
                if os.path.isfile(fpath):
                    os.remove(fpath)
                elif os.path.isdir(fpath):
                    shutil.rmtree(fpath)

            # 清空知识库上传目录
            for f in os.listdir(KNOWLEDGE_DIR):
                fpath = os.path.join(KNOWLEDGE_DIR, f)
                if os.path.isfile(fpath):
                    os.remove(fpath)

            # 重建空索引
            self.index = self._create_empty_index()

            logger.info("Knowledge base cleared")
            return {"success": True, "message": "Knowledge base cleared"}
        except Exception as e:
            logger.error(f"Failed to clear knowledge base: {e}")
            return {"success": False, "error": str(e)}

    def get_status(self) -> Dict[str, Any]:
        """获取知识库状态"""
        try:
            doc_count = len(self.documents_meta)

            # 计算总文件大小
            total_size = sum(
                doc.get("size", 0) for doc in self.documents_meta.values()
            )

            # 检查索引是否已初始化
            index_ready = self.index is not None

            # 获取持久化目录大小
            persist_size = 0
            for f in os.listdir(PERSIST_DIR):
                fpath = os.path.join(PERSIST_DIR, f)
                if os.path.isfile(fpath):
                    persist_size += os.path.getsize(fpath)

            # 按分类统计文档数
            category_counts: Dict[str, int] = {}
            for doc in self.documents_meta.values():
                cat = doc.get("category", "uncategorized")
                category_counts[cat] = category_counts.get(cat, 0) + 1

            return {
                "success": True,
                "status": {
                    "initialized": index_ready,
                    "document_count": doc_count,
                    "total_file_size": total_size,
                    "total_file_size_human": self._format_size(total_size),
                    "index_size": persist_size,
                    "index_size_human": self._format_size(persist_size),
                    "persist_dir": PERSIST_DIR,
                    "knowledge_dir": KNOWLEDGE_DIR,
                    "category_count": len(self.categories),
                    "category_counts": category_counts,
                }
            }
        except Exception as e:
            logger.error(f"Failed to get status: {e}")
            return {"success": False, "error": str(e)}

    @staticmethod
    def _format_size(size_bytes: int) -> str:
        """格式化文件大小"""
        for unit in ['B', 'KB', 'MB', 'GB']:
            if size_bytes < 1024:
                return f"{size_bytes:.1f} {unit}"
            size_bytes /= 1024
        return f"{size_bytes:.1f} TB"


# 全局单例
_rag_instance = None
_rag_instance_model: Optional[str] = None


def get_rag_manager(api_key: str = None) -> Optional[RAGManager]:
    global _rag_instance, _rag_instance_model
    from core.llm_provider import get_rag_llm_model

    current_model = get_rag_llm_model()
    if _rag_instance is not None and _rag_instance_model != current_model:
        logger.info(
            "RAG LLM model changed (%s -> %s), reinitializing",
            _rag_instance_model,
            current_model,
        )
        _rag_instance = None

    if _rag_instance is None:
        _rag_instance = RAGManager(api_key)
        _rag_instance_model = current_model
    return _rag_instance


def reset_rag_manager():
    """重置 RAG 管理器实例"""
    global _rag_instance, _rag_instance_model
    _rag_instance = None
    _rag_instance_model = None


def save_uploaded_file(uploaded_file) -> str:
    """
    保存上传的文件到临时目录，并返回绝对路径。
    """
    try:
        file_path = os.path.join(UPLOAD_DIR, uploaded_file.name)
        with open(file_path, "wb") as f:
            f.write(uploaded_file.getbuffer())
        return os.path.abspath(file_path)
    except Exception as e:
        logger.error(f"Failed to save uploaded file: {e}")
        return ""


def save_temp_knowledge_upload(content: bytes, filename: str) -> str:
    """保存上传源文件到 storage/temp/knowledge_uploads（仅作解析输入）。"""
    try:
        os.makedirs(TEMP_KNOWLEDGE_UPLOAD_DIR, exist_ok=True)
        base, ext = os.path.splitext(filename or "document")
        timestamp = time.strftime("%Y%m%d_%H%M%S")
        safe_filename = f"{base}_{timestamp}{ext}"
        file_path = os.path.join(TEMP_KNOWLEDGE_UPLOAD_DIR, safe_filename)
        with open(file_path, "wb") as f:
            f.write(content)
        logger.info("Saved temp knowledge upload: %s", file_path)
        return os.path.abspath(file_path)
    except Exception as e:
        logger.error(f"Failed to save temp knowledge upload: {e}")
        return ""


def save_knowledge_file(content: bytes, filename: str) -> str:
    """
    保存知识库文档到专用目录。
    返回绝对路径。
    """
    try:
        # 确保文件扩展名受支持
        ext = os.path.splitext(filename)[1].lower()
        if ext not in SUPPORTED_EXTENSIONS:
            logger.warning(f"Unsupported file extension: {ext}")

        # 添加时间戳避免重名
        base, ext = os.path.splitext(filename)
        timestamp = time.strftime("%Y%m%d_%H%M%S")
        safe_filename = f"{base}_{timestamp}{ext}"

        file_path = os.path.join(KNOWLEDGE_DIR, safe_filename)
        with open(file_path, "wb") as f:
            f.write(content)

        logger.info(f"Saved knowledge file: {file_path}")
        return os.path.abspath(file_path)
    except Exception as e:
        logger.error(f"Failed to save knowledge file: {e}")
        return ""
