from typing import Optional
from langchain.tools import tool
from utils.rag_manager import get_rag_manager
from utils.logger import setup_logger

logger = setup_logger("rag_tools")


@tool
def search_knowledge_base(
    query: str,
    category: Optional[str] = None,
    doc_id: Optional[str] = None,
) -> str:
    """
    检索私有知识库/文档库。
    当用户的问题涉及上传的文档内容、特定领域的知识或私有信息时，**必须**使用此工具。
    不要编造信息，应优先依据此工具返回的结果回答。

    Args:
        query: 具体的搜索查询或问题。
        category: 可选，限定在某个分类内搜索。常见分类：
                  'product-docs'（产品文档）、'technical'（技术文档）、
                  'marketing'（营销素材）、'knowledge'（知识沉淀）、
                  'uncategorized'（未分类）。
                  不填则搜索全部知识库。
        doc_id: 可选，限定在指定文档 id 内搜索（与 category 二选一或组合使用）。
    """
    logger.info(
        f"Searching knowledge base with query={query!r}, category={category!r}, doc_id={doc_id!r}"
    )
    rag_manager = get_rag_manager()
    if not rag_manager:
        return "Error: RAG manager not initialized. Please ensure API Key is set."

    try:
        result = rag_manager.query(query, category=category, doc_id=doc_id)
        if isinstance(result, dict):
            if result.get("success"):
                answer = result.get("answer", "")
                sources = result.get("sources", [])
                if sources:
                    source_lines = []
                    for s in sources[:3]:
                        cat_label = f" [{s.get('category', '')}]" if s.get("category") else ""
                        source_lines.append(f"- {s['text']}{cat_label}")
                    source_texts = "\n\n参考来源：\n" + "\n".join(source_lines)
                    return answer + source_texts
                return answer
            else:
                return f"Error: {result.get('error', 'Unknown error')}"
        logger.info("RAG query successful.")
        return str(result)
    except Exception as e:
        logger.error(f"RAG query failed: {e}")
        return f"Error querying knowledge base: {str(e)}"


@tool
def list_knowledge_categories() -> str:
    """
    列出知识库中所有可用的分类及其文档数量。
    在调用 search_knowledge_base 指定分类前，先用此工具了解有哪些分类可用。
    """
    rag_manager = get_rag_manager()
    if not rag_manager:
        return "Error: RAG manager not initialized."
    try:
        categories = rag_manager.get_categories()
        if not categories:
            return "知识库暂无分类。"
        lines = ["知识库分类列表："]
        for cat in categories:
            count = cat.get("document_count", 0)
            lines.append(f"- {cat['icon']} {cat['name']} (id: {cat['id']}, 文档数: {count}): {cat.get('description', '')}")
        return "\n".join(lines)
    except Exception as e:
        logger.error(f"List categories failed: {e}")
        return f"Error listing categories: {str(e)}"

