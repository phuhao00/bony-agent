"""Knowledge base API routes."""

from __future__ import annotations

import asyncio
import os
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from core.security_deps import require_auth_when_enabled
from utils.knowledge_faq import try_parse_faq_file
from utils.logger import setup_logger
from utils.rag_manager import (
    SUPPORTED_EXTENSIONS,
    get_rag_manager,
    save_temp_knowledge_upload,
)

logger = setup_logger("knowledge_router")

router = APIRouter(prefix="/knowledge", tags=["知识库"])


class KnowledgeQueryRequest(BaseModel):
    query: str
    top_k: int = 3
    category: Optional[str] = None
    doc_id: Optional[str] = None


class KnowledgeCategoryRequest(BaseModel):
    id: str = Field(..., max_length=80, pattern=r"^[a-z0-9_-]+$")
    name: str = Field(..., max_length=60)
    description: str = Field(default="", max_length=200)
    color: str = Field(default="#6B7280", max_length=20)
    icon: str = Field(default="📁", max_length=10)


class KnowledgeDocumentPatchRequest(BaseModel):
    category: Optional[str] = Field(None, max_length=80)
    tags: Optional[List[str]] = None
    description: Optional[str] = Field(None, max_length=500)


class KnowledgeDocumentAppendRequest(BaseModel):
    content: str = Field(..., min_length=1, max_length=50000)
    section_title: str = Field(default="", max_length=120)


class KnowledgeDocumentContentUpdateRequest(BaseModel):
    content: str = Field(..., min_length=1, max_length=500000)


class KnowledgeDocumentOptimizeRequest(BaseModel):
    use_llm: bool = Field(default=True, description="是否使用 LLM 进一步整理 Markdown 结构")


_AUTO_OPTIMIZE_SOURCE_TYPES = frozenset(
    {"pdf", "doc", "docx", "ppt", "pptx", "url", "html", "htm"}
)


class KnowledgeTextCreateRequest(BaseModel):
    title: str = Field(default="未命名笔记", max_length=120)
    content: str = Field(..., min_length=1, max_length=50000)
    category: str = Field(default="uncategorized", max_length=80)
    tags: List[str] = Field(default_factory=list)
    description: str = Field(default="", max_length=500)


class KnowledgeUrlImportRequest(BaseModel):
    url: str = Field(..., min_length=8, max_length=2048)
    title: str = Field(default="", max_length=120)
    category: str = Field(default="uncategorized", max_length=80)
    tags: List[str] = Field(default_factory=list)
    description: str = Field(default="", max_length=500)
    auto_category: bool = Field(default=True)
    auto_optimize: bool = Field(default=True)


class KnowledgeFaqItemRequest(BaseModel):
    id: Optional[str] = None
    question: str = Field(default="", max_length=2000)
    answer: str = Field(default="", max_length=20000)
    tags: List[str] = Field(default_factory=list)
    extra: Dict[str, str] = Field(default_factory=dict)
    order: int = Field(default=0)


class KnowledgeFaqUpdateRequest(BaseModel):
    title: Optional[str] = Field(None, max_length=120)
    items: List[KnowledgeFaqItemRequest] = Field(default_factory=list)


class KnowledgeFaqCreateRequest(BaseModel):
    title: str = Field(default="FAQ", max_length=120)
    category: str = Field(default="faq", max_length=80)
    tags: List[str] = Field(default_factory=list)
    description: str = Field(default="", max_length=500)
    items: List[KnowledgeFaqItemRequest] = Field(default_factory=list)


def _rag_or_500():
    rag_manager = get_rag_manager()
    if not rag_manager:
        raise HTTPException(status_code=500, detail="RAG manager not initialized")
    return rag_manager


def _should_auto_optimize_doc(meta: Dict[str, Any]) -> bool:
    if meta.get("content_optimized"):
        return False
    if meta.get("content_type") == "faq":
        return False
    source_type = (meta.get("source_type") or "").lower()
    if source_type in _AUTO_OPTIMIZE_SOURCE_TYPES:
        return True
    return bool(meta.get("converted") or meta.get("source_filename"))


async def _optimize_document_by_id(
    rag_manager,
    doc_id: str,
    *,
    use_llm: bool = True,
    mark_optimized: bool = True,
) -> Dict[str, Any]:
    from services.knowledge_content_optimizer import optimize_knowledge_content

    current = await asyncio.to_thread(rag_manager.get_document_content, doc_id)
    if not current.get("success"):
        return current

    original = current.get("content") or ""
    title = (current.get("filename") or "").replace(".md", "")
    optimized = await optimize_knowledge_content(
        original,
        title=title,
        source_type=current.get("source_type") or "",
        use_llm=use_llm,
    )
    new_content = (optimized.get("content") or "").strip()
    if not new_content:
        return {"success": False, "error": "优化结果为空"}

    method = optimized.get("method") or "rules"
    if new_content == original.strip():
        if mark_optimized:
            await asyncio.to_thread(
                rag_manager.mark_content_optimized,
                doc_id,
                method=method,
                unchanged=True,
            )
        return {
            "success": True,
            "unchanged": True,
            "message": "内容已较整洁，无需进一步优化",
            "method": method,
            "char_count": len(new_content),
            "llm_applied": optimized.get("llm_applied"),
            "llm_skipped": optimized.get("llm_skipped"),
            "llm_error": optimized.get("llm_error"),
        }

    result = await asyncio.to_thread(
        rag_manager.update_document_content,
        doc_id,
        new_content,
    )
    if not result.get("success"):
        return result

    if mark_optimized:
        await asyncio.to_thread(
            rag_manager.mark_content_optimized,
            doc_id,
            method=method,
        )

    return {
        **result,
        "method": method,
        "rules": optimized.get("rules"),
        "llm_applied": optimized.get("llm_applied"),
        "llm_skipped": optimized.get("llm_skipped"),
        "llm_error": optimized.get("llm_error"),
        "llm": optimized.get("llm"),
    }


async def _auto_optimize_ingested_documents(
    rag_manager,
    documents: List[Dict[str, Any]],
    *,
    use_llm: bool = True,
) -> Optional[Dict[str, Any]]:
    for doc in documents or []:
        doc_id = doc.get("id")
        if not doc_id:
            continue
        meta = rag_manager.documents_meta.get(doc_id) or doc
        if not _should_auto_optimize_doc(meta):
            continue
        try:
            return await _optimize_document_by_id(
                rag_manager,
                doc_id,
                use_llm=use_llm,
            )
        except Exception as exc:
            logger.warning("Auto optimize failed for %s: %s", doc_id, exc)
            return {"success": False, "error": str(exc)}
    return None


@router.post("/upload")
async def api_upload_knowledge(
    file: UploadFile = File(...),
    category: str = Form("uncategorized"),
    tags: str = Form(""),
    description: str = Form(""),
    auto_category: bool = Form(False),
    auto_optimize: bool = Form(True),
    _: Optional[dict] = Depends(require_auth_when_enabled),
):
    """上传文档到知识库"""
    try:
        filename = file.filename or "document"
        ext = os.path.splitext(filename)[1].lower()
        if ext not in SUPPORTED_EXTENSIONS:
            raise HTTPException(
                status_code=400,
                detail=f"不支持的文件类型: {ext}。支持的类型: {', '.join(SUPPORTED_EXTENSIONS)}",
            )

        content = await file.read()
        if len(content) > 20 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="文件大小不能超过 20MB")

        temp_path = save_temp_knowledge_upload(content, filename)
        if not temp_path:
            raise HTTPException(status_code=500, detail="文件保存失败")

        rag_manager = _rag_or_500()
        use_auto = auto_category or category in ("auto", "")
        category_resolution = await asyncio.to_thread(
            rag_manager.resolve_upload_category,
            temp_path,
            filename,
            category,
            auto_category=use_auto,
        )
        resolved_category = category_resolution["category_id"]
        tags_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else []

        if try_parse_faq_file(temp_path):
            result = await asyncio.to_thread(
                rag_manager.ingest_documents,
                [temp_path],
                resolved_category if resolved_category != "uncategorized" else "faq",
                tags_list,
                description,
            )
            if result.get("success"):
                return {
                    "success": True,
                    "message": f"FAQ {filename} 已成功导入知识库",
                    "documents": result.get("documents", []),
                    "assigned_category": resolved_category,
                    "auto_assigned": category_resolution.get("auto_assigned", False),
                    "category_confidence": category_resolution.get("confidence"),
                    "category_reason": category_resolution.get("reason"),
                    "converted": False,
                }
            raise HTTPException(status_code=500, detail=result.get("error", "FAQ 导入失败"))

        convert_result = await asyncio.to_thread(
            rag_manager.convert_upload_to_knowledge_markdown,
            temp_path,
            filename,
        )
        if not convert_result.get("success"):
            raise HTTPException(
                status_code=500,
                detail=convert_result.get("error", "文档转化失败"),
            )

        result = await asyncio.to_thread(
            rag_manager.ingest_documents,
            [convert_result["converted_path"]],
            resolved_category,
            tags_list,
            description or convert_result.get("display_filename", filename),
            source_filename=convert_result.get("source_filename"),
            source_type=convert_result.get("source_type"),
            display_filename=convert_result.get("display_filename"),
        )

        if result.get("success"):
            display_name = convert_result.get("display_filename") or filename
            optimize_result = None
            if auto_optimize:
                optimize_result = await _auto_optimize_ingested_documents(
                    rag_manager,
                    result.get("documents") or [],
                    use_llm=True,
                )
            response: Dict[str, Any] = {
                "success": True,
                "message": f"已将 {filename} 解析并转化为知识条目「{display_name}」",
                "documents": result.get("documents", []),
                "assigned_category": resolved_category,
                "auto_assigned": category_resolution.get("auto_assigned", False),
                "category_confidence": category_resolution.get("confidence"),
                "category_reason": category_resolution.get("reason"),
                "converted": True,
                "display_filename": display_name,
                "source_filename": convert_result.get("source_filename"),
                "source_type": convert_result.get("source_type"),
                "char_count": convert_result.get("char_count"),
                "auto_optimize": auto_optimize,
            }
            if optimize_result:
                response["optimize"] = optimize_result
                if optimize_result.get("success") and not optimize_result.get("unchanged"):
                    response["char_count"] = optimize_result.get("char_count")
                    response["message"] = (
                        f"已将 {filename} 解析、优化并导入知识条目「{display_name}」"
                    )
            return response
        raise HTTPException(status_code=500, detail=result.get("error", "导入失败"))
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Knowledge upload error: %s", e)
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/documents")
async def api_list_knowledge_documents(
    category: Optional[str] = None,
    _: Optional[dict] = Depends(require_auth_when_enabled),
):
    try:
        rag_manager = get_rag_manager()
        if not rag_manager:
            return {"success": False, "error": "RAG manager not initialized", "documents": []}
        documents = await asyncio.to_thread(rag_manager.get_documents_info, category)
        return {"success": True, "count": len(documents), "documents": documents}
    except Exception as e:
        logger.error("List knowledge documents error: %s", e)
        return {"success": False, "error": str(e), "documents": []}


@router.delete("/documents/{doc_id}")
async def api_delete_knowledge_document(
    doc_id: str,
    _: Optional[dict] = Depends(require_auth_when_enabled),
):
    try:
        rag_manager = _rag_or_500()
        result = await asyncio.to_thread(rag_manager.delete_document, doc_id)
        if result.get("success"):
            return result
        raise HTTPException(status_code=404, detail=result.get("error", "Document not found"))
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Delete knowledge document error: %s", e)
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.patch("/documents/{doc_id}")
async def api_patch_knowledge_document(
    doc_id: str,
    req: KnowledgeDocumentPatchRequest,
    _: Optional[dict] = Depends(require_auth_when_enabled),
):
    try:
        rag_manager = _rag_or_500()
        result = await asyncio.to_thread(
            rag_manager.update_document_metadata,
            doc_id,
            category=req.category,
            tags=req.tags,
            description=req.description,
        )
        if result.get("success"):
            return result
        raise HTTPException(status_code=404, detail=result.get("error", "Document not found"))
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Patch knowledge document error: %s", e)
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/documents/{doc_id}/append")
async def api_append_knowledge_document(
    doc_id: str,
    req: KnowledgeDocumentAppendRequest,
    _: Optional[dict] = Depends(require_auth_when_enabled),
):
    try:
        rag_manager = _rag_or_500()
        result = await asyncio.to_thread(
            rag_manager.append_document_content,
            doc_id,
            req.content,
            section_title=req.section_title,
        )
        if result.get("success"):
            return result
        raise HTTPException(status_code=400, detail=result.get("error", "Append failed"))
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Append knowledge document error: %s", e)
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/documents/{doc_id}/content")
async def api_get_knowledge_document_content(doc_id: str):
    try:
        rag_manager = _rag_or_500()
        result = await asyncio.to_thread(rag_manager.get_document_content, doc_id)
        if result.get("success"):
            return result
        status = 404 if "not found" in str(result.get("error", "")).lower() else 400
        raise HTTPException(status_code=status, detail=result.get("error", "Read failed"))
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Get knowledge document content error: %s", e)
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.put("/documents/{doc_id}/content")
async def api_update_knowledge_document_content(
    doc_id: str,
    req: KnowledgeDocumentContentUpdateRequest,
    _: Optional[dict] = Depends(require_auth_when_enabled),
):
    try:
        rag_manager = _rag_or_500()
        result = await asyncio.to_thread(rag_manager.update_document_content, doc_id, req.content)
        if result.get("success"):
            return result
        status = 404 if "not found" in str(result.get("error", "")).lower() else 400
        raise HTTPException(status_code=status, detail=result.get("error", "Update failed"))
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Update knowledge document content error: %s", e)
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/documents/{doc_id}/optimize")
async def api_optimize_knowledge_document(
    doc_id: str,
    req: KnowledgeDocumentOptimizeRequest = KnowledgeDocumentOptimizeRequest(),
    _: Optional[dict] = Depends(require_auth_when_enabled),
):
    try:
        rag_manager = _rag_or_500()
        result = await _optimize_document_by_id(
            rag_manager,
            doc_id,
            use_llm=req.use_llm,
        )
        if not result.get("success"):
            status = 404 if "not found" in str(result.get("error", "")).lower() else 400
            raise HTTPException(status_code=status, detail=result.get("error", "Optimize failed"))
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Optimize knowledge document error: %s", e)
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/url")
async def api_import_knowledge_url(
    req: KnowledgeUrlImportRequest,
    _: Optional[dict] = Depends(require_auth_when_enabled),
):
    """从公开网页链接抓取正文并导入知识库。"""
    try:
        rag_manager = _rag_or_500()
        result = await asyncio.to_thread(
            rag_manager.ingest_from_url,
            req.url,
            category=req.category,
            tags=req.tags,
            description=req.description,
            title=req.title,
            auto_category=req.auto_category,
        )
        if not result.get("success"):
            status = 409 if result.get("existing_document_id") else 400
            raise HTTPException(status_code=status, detail=result.get("error", "Import failed"))

        if req.auto_optimize:
            optimize_result = await _auto_optimize_ingested_documents(
                rag_manager,
                result.get("documents") or [],
                use_llm=True,
            )
            if optimize_result:
                result["optimize"] = optimize_result
                result["auto_optimize"] = True
                if optimize_result.get("success") and not optimize_result.get("unchanged"):
                    result["char_count"] = optimize_result.get("char_count")
                    title = result.get("title") or "网页摘录"
                    result["message"] = f"已将网页「{title}」优化并导入知识库"
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Import knowledge URL error: %s", e)
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/text")
async def api_create_knowledge_text(
    req: KnowledgeTextCreateRequest,
    _: Optional[dict] = Depends(require_auth_when_enabled),
):
    try:
        rag_manager = _rag_or_500()
        result = await asyncio.to_thread(
            rag_manager.create_text_document,
            req.title,
            req.content,
            category=req.category,
            tags=req.tags,
            description=req.description,
        )
        if result.get("success"):
            return result
        raise HTTPException(status_code=400, detail=result.get("error", "Create failed"))
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Create knowledge text error: %s", e)
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/faq")
async def api_create_knowledge_faq(
    req: KnowledgeFaqCreateRequest,
    _: Optional[dict] = Depends(require_auth_when_enabled),
):
    try:
        rag_manager = _rag_or_500()
        items = [item.model_dump() for item in req.items]
        result = await asyncio.to_thread(
            rag_manager.create_faq_document,
            req.title,
            items=items,
            category=req.category,
            tags=req.tags,
            description=req.description,
        )
        if result.get("success"):
            return result
        raise HTTPException(status_code=400, detail=result.get("error", "Create failed"))
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Create knowledge FAQ error: %s", e)
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/documents/{doc_id}/faq")
async def api_get_knowledge_faq(doc_id: str):
    try:
        rag_manager = _rag_or_500()
        result = await asyncio.to_thread(rag_manager.get_faq_document, doc_id)
        if result.get("success"):
            return result
        raise HTTPException(status_code=404, detail=result.get("error", "FAQ not found"))
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Get knowledge FAQ error: %s", e)
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.put("/documents/{doc_id}/faq")
async def api_update_knowledge_faq(
    doc_id: str,
    req: KnowledgeFaqUpdateRequest,
    _: Optional[dict] = Depends(require_auth_when_enabled),
):
    try:
        rag_manager = _rag_or_500()
        items = [item.model_dump() for item in req.items] if req.items is not None else None
        result = await asyncio.to_thread(
            rag_manager.update_faq_document,
            doc_id,
            title=req.title,
            items=items,
        )
        if result.get("success"):
            return result
        raise HTTPException(status_code=400, detail=result.get("error", "Update failed"))
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Update knowledge FAQ error: %s", e)
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/documents/{doc_id}/faq/import")
async def api_import_knowledge_faq(
    doc_id: str,
    file: UploadFile = File(...),
    mode: str = Form("append"),
    _: Optional[dict] = Depends(require_auth_when_enabled),
):
    try:
        filename = file.filename or "import.xlsx"
        ext = os.path.splitext(filename)[1].lower()
        if ext not in {".xlsx", ".xls"}:
            raise HTTPException(status_code=400, detail="仅支持 .xlsx / .xls 文件")

        content = await file.read()
        if len(content) > 20 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="文件大小不能超过 20MB")

        merge_mode = (mode or "append").strip().lower()
        if merge_mode not in {"append", "replace"}:
            raise HTTPException(status_code=400, detail="mode 必须为 append 或 replace")

        rag_manager = _rag_or_500()
        result = await asyncio.to_thread(
            rag_manager.import_faq_from_excel,
            doc_id,
            content,
            filename=filename,
            mode=merge_mode,
        )
        if result.get("success"):
            return result
        raise HTTPException(status_code=400, detail=result.get("error", "Import failed"))
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Import knowledge FAQ error: %s", e)
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/categories")
async def api_list_knowledge_categories():
    try:
        rag_manager = _rag_or_500()
        categories = await asyncio.to_thread(rag_manager.get_categories)
        return {"success": True, "categories": categories}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("List categories error: %s", e)
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/categories")
async def api_create_knowledge_category(
    req: KnowledgeCategoryRequest,
    _: Optional[dict] = Depends(require_auth_when_enabled),
):
    try:
        rag_manager = _rag_or_500()
        result = await asyncio.to_thread(
            rag_manager.create_category,
            category_id=req.id,
            name=req.name,
            description=req.description,
            color=req.color,
            icon=req.icon,
        )
        if result.get("success"):
            return result
        raise HTTPException(status_code=409, detail=result.get("error"))
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Create category error: %s", e)
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.delete("/categories/{category_id}")
async def api_delete_knowledge_category(
    category_id: str,
    _: Optional[dict] = Depends(require_auth_when_enabled),
):
    try:
        rag_manager = _rag_or_500()
        result = await asyncio.to_thread(rag_manager.delete_category, category_id)
        if result.get("success"):
            return result
        raise HTTPException(status_code=404, detail=result.get("error"))
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Delete category error: %s", e)
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/query")
async def api_query_knowledge(req: KnowledgeQueryRequest):
    try:
        rag_manager = _rag_or_500()
        result = await asyncio.to_thread(
            rag_manager.query,
            req.query,
            top_k=req.top_k,
            category=req.category,
            doc_id=req.doc_id,
        )
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Knowledge query error: %s", e)
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/status")
async def api_knowledge_status():
    try:
        rag_manager = get_rag_manager()
        if not rag_manager:
            return {
                "success": False,
                "error": "RAG manager not initialized",
                "status": {"initialized": False},
            }
        return await asyncio.to_thread(rag_manager.get_status)
    except Exception as e:
        logger.error("Knowledge status error: %s", e)
        return {"success": False, "error": str(e)}


@router.delete("/clear")
async def api_clear_knowledge(_: Optional[dict] = Depends(require_auth_when_enabled)):
    try:
        rag_manager = _rag_or_500()
        result = await asyncio.to_thread(rag_manager.clear_all)
        if result.get("success"):
            return result
        raise HTTPException(status_code=500, detail=result.get("error", "Clear failed"))
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Clear knowledge error: %s", e)
        raise HTTPException(status_code=500, detail=str(e)) from e
