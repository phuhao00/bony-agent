"""Customer-service RAG context assembly."""

from __future__ import annotations

import asyncio
from typing import Any, Dict, List, Optional

from utils.cs_faq_retrieval import search_faq_items, search_markdown_sections
from utils.logger import setup_logger

logger = setup_logger("customer_service_retrieval")

# FAQ keyword scores (~8-80) vs vector cosine (~0-1) — scale vectors for hybrid sort
_VECTOR_SCORE_SCALE = 40.0


def _normalize_vector_score(score: float) -> float:
    return float(score or 0.0) * _VECTOR_SCORE_SCALE


def _format_faq_snippet(item: Dict[str, Any], score: float) -> Dict[str, Any]:
    return {
        "kind": "faq",
        "question": item.get("question") or "",
        "answer": item.get("answer") or "",
        "score": score,
        "text": f"Q: {item.get('question', '')}\nA: {item.get('answer', '')}",
    }


def _append_doc_keyword_snippets(
    snippets: List[Dict[str, Any]],
    *,
    rag_manager,
    doc_ids: List[str],
    query: str,
    limit: int,
) -> None:
    """Keyword search in bound Markdown/text documents (works without vector index)."""
    for doc_id in doc_ids:
        if rag_manager.is_faq_document(doc_id):
            continue
        content_result = rag_manager.get_document_content(doc_id)
        if not content_result.get("success"):
            continue
        body = content_result.get("content") or ""
        filename = content_result.get("filename") or ""
        for section, score, title in search_markdown_sections(body, query, top_k=limit):
            snippets.append({
                "kind": "doc",
                "doc_id": doc_id,
                "score": score,
                "title": title,
                "text": section,
                "file_name": filename,
            })


async def retrieve_workspace_context_async(
    workspace: Dict[str, Any],
    query: str,
    rag_manager,
    *,
    top_k: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """Async wrapper — runs sync retrieval in a thread pool."""
    return await asyncio.to_thread(
        retrieve_workspace_context,
        workspace,
        query,
        rag_manager,
        top_k=top_k,
    )


def retrieve_workspace_context(
    workspace: Dict[str, Any],
    query: str,
    rag_manager,
    *,
    top_k: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """Retrieve FAQ + vector snippets for a workspace query."""
    if rag_manager is None:
        return []

    mode = (workspace.get("retrieval_mode") or "hybrid").strip().lower()
    limit = top_k or int(workspace.get("top_k") or 5)
    doc_ids: List[str] = list(workspace.get("knowledge_doc_ids") or [])
    snippets: List[Dict[str, Any]] = []

    if mode in ("faq", "hybrid"):
        for doc_id in doc_ids:
            if not rag_manager.is_faq_document(doc_id):
                continue
            faq = rag_manager.get_faq_document(doc_id)
            if not faq.get("success"):
                continue
            for item, score in search_faq_items(faq.get("items") or [], query, top_k=limit):
                snippets.append(_format_faq_snippet(item, score))

        if not snippets and not doc_ids:
            generic = [
                {
                    "question": f"{workspace.get('domain') or workspace.get('name') or '本领域'}有哪些常见问题？",
                    "answer": (
                        workspace.get("welcome_message")
                        or "请描述你的具体问题，我会结合知识库为你解答。"
                    ),
                    "tags": ["通用"],
                }
            ]
            for item, score in search_faq_items(generic, query, top_k=limit, min_score=0):
                snippets.append(_format_faq_snippet(item, score))

    if mode in ("rag", "hybrid"):
        for doc_id in doc_ids:
            if rag_manager.is_faq_document(doc_id) and mode == "hybrid":
                continue

            # 1) 向量检索（语义）
            try:
                result = rag_manager.retrieve(query, top_k=limit, doc_id=doc_id)
            except Exception as exc:
                logger.warning("RAG retrieve failed doc=%s: %s", doc_id, exc)
                result = {"success": False}
            if result.get("success"):
                for src in result.get("sources") or []:
                    snippets.append({
                        "kind": "rag",
                        "doc_id": doc_id,
                        "score": _normalize_vector_score(float(src.get("score") or 0.0)),
                        "text": src.get("text") or "",
                        "file_name": src.get("file_name") or "",
                    })

    # 正文关键词检索：FAQ/短词查询兜底，不依赖向量索引
    _append_doc_keyword_snippets(
        snippets,
        rag_manager=rag_manager,
        doc_ids=doc_ids,
        query=query,
        limit=limit,
    )

    snippets.sort(key=lambda s: float(s.get("score") or 0.0), reverse=True)
    return snippets[:limit]


def build_context_block(snippets: List[Dict[str, Any]]) -> str:
    if not snippets:
        return "（未检索到相关知识库条目，请结合常识谨慎回答，并说明信息可能不完整。）"
    lines: List[str] = []
    for i, sn in enumerate(snippets, start=1):
        if sn.get("kind") == "faq":
            lines.append(f"[{i}] {sn.get('text', '')}")
        else:
            fname = sn.get("file_name") or sn.get("title") or "文档"
            lines.append(f"[{i}] （{fname}）\n{sn.get('text', '')}")
    return "\n\n".join(lines)


def estimate_confidence(snippets: List[Dict[str, Any]]) -> float:
    if not snippets:
        return 0.25
    top = float(snippets[0].get("score") or 0.0)
    if top >= 40:
        return 0.92
    if top >= 25:
        return 0.78
    if top >= 12:
        return 0.62
    return 0.45
