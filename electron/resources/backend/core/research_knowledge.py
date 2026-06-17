"""
将 research_artifact 落盘为 Markdown 并导入知识库（RAG）。
"""

from __future__ import annotations

import re
from typing import Any, Dict, Optional


def research_artifact_to_markdown(artifact: Dict[str, Any]) -> str:
    """把 research_artifact 字典渲染为适合向量检索的 Markdown。"""
    if not isinstance(artifact, dict):
        return ""
    title = (artifact.get("title") or artifact.get("query") or "Research note").strip()
    src = artifact.get("source") or "custom"
    q = (artifact.get("query") or "").strip()
    summ = (artifact.get("summary") or "").strip()
    iso = artifact.get("retrieved_at_iso") or ""
    aid = artifact.get("id") or ""

    lines = [
        f"# {title}",
        "",
        f"- **artifact_id**: `{aid}`" if aid else "",
        f"- **source**: {src}",
        f"- **retrieved_at**: {iso}" if iso else "",
        f"- **query**: {q}" if q else "",
        "",
        "## 摘要",
        "",
        summ if summ else "_(无摘要)_",
        "",
    ]
    lines = [ln for ln in lines if ln != ""]

    items = artifact.get("items") or []
    if isinstance(items, list) and items:
        lines.extend(["", "## 参考条目", ""])
        for i, it in enumerate(items, 1):
            if not isinstance(it, dict):
                continue
            t = (it.get("title") or "").strip() or f"条目 {i}"
            url = (it.get("url") or "").strip()
            snip = (it.get("snippet") or "").strip()
            quote = (it.get("quote") or "").strip()
            conf = it.get("confidence")
            lines.append(f"### {i}. {t}")
            if url:
                lines.append(f"- **URL**: {url}")
            if conf is not None:
                lines.append(f"- **confidence**: {conf}")
            if snip:
                lines.extend(["", snip, ""])
            if quote:
                lines.extend(["", f"> {quote}", ""])
            lines.append("")

    return "\n".join(lines).strip() + "\n"


def safe_research_filename_base(artifact: Dict[str, Any], override: Optional[str] = None) -> str:
    base = (override or "").strip()
    if not base:
        base = (artifact.get("query") or artifact.get("title") or "").strip()
    if not base:
        raw_id = str(artifact.get("id") or "research")
        base = raw_id[:36]
    base = re.sub(r"[^\w\u4e00-\u9fff\-]+", "_", base)
    base = base.strip("_")[:72] or "research"
    return base


def ingest_research_artifact_to_knowledge(artifact: Dict[str, Any], *, filename_base: Optional[str] = None) -> Dict[str, Any]:
    """
    将 research_artifact 存为 .md 并调用 RAG ingest。
    返回 rag_manager.ingest_documents 风格的结果，并附带 path/filename。
    """
    from utils.rag_manager import get_rag_manager, save_knowledge_file

    if not isinstance(artifact, dict) or not artifact:
        return {"success": False, "error": "Invalid or empty artifact"}

    md_text = research_artifact_to_markdown(artifact)
    if not md_text.strip():
        return {"success": False, "error": "Empty markdown output"}

    base = safe_research_filename_base(artifact, filename_base)
    filename = f"{base}.md"
    content = md_text.encode("utf-8")

    filepath = save_knowledge_file(content, filename)
    if not filepath:
        return {"success": False, "error": "Failed to save knowledge file"}

    rag = get_rag_manager()
    if not rag:
        return {"success": False, "error": "RAG manager not initialized", "path": filepath}

    result = rag.ingest_documents([filepath])
    out = dict(result)
    out["path"] = filepath
    out["filename"] = filename
    return out
