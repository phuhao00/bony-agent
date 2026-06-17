"""Clean and polish knowledge-base text extracted from PDF/OCR sources."""

from __future__ import annotations

import re
from typing import Any, Dict, Optional, Tuple

from langchain_core.messages import HumanMessage, SystemMessage
from utils.logger import setup_logger

logger = setup_logger("knowledge_content_optimizer")

_MAX_LLM_CHARS = 48_000
_CHUNK_SIZE = 9_000

_SYSTEM = """你是知识库文档整理专家。输入文本通常来自 PDF/OCR 自动提取，常见问题包括：
- 错误断行、连字符拆分（如 know- \\n ledge）
- 页眉页脚、孤立页码、目录点线（…… 12）
- 重复行、乱码空白、缺少 Markdown 结构

请整理为清晰、可检索的 Markdown 正文：
1. 用合理的 # / ## / ### 组织章节，保留原有信息层次
2. 合并被错误拆开的句子与段落；列表用 - 或 1. 格式
3. 删除页码、重复页眉页脚、无意义噪声；不要删除实质内容
4. 保留专有名词、数字、链接；不要编造或扩写原文没有的信息
5. 只输出整理后的 Markdown 正文，不要解释，不要用 ``` 包裹"""


def _normalize_unicode(text: str) -> str:
    t = text or ""
    t = t.replace("\ufeff", "").replace("\u00ad", "")
    t = t.replace("\u00a0", " ").replace("\u200b", "")
    t = t.replace("\r\n", "\n").replace("\r", "\n")
    return t


def _fix_hyphenation(text: str) -> str:
    return re.sub(r"(\w)-\n(\w)", r"\1\2", text)


def _remove_noise_lines(text: str) -> str:
    out: list[str] = []
    for line in text.split("\n"):
        stripped = line.strip()
        if not stripped:
            out.append("")
            continue
        if re.fullmatch(r"\d{1,4}", stripped):
            continue
        if re.fullmatch(r"(?i)(page\s*)?\d{1,4}(\s*\/\s*\d{1,4})?", stripped):
            continue
        if re.fullmatch(r"-\s*\d{1,4}\s*-", stripped):
            continue
        if re.fullmatch(r"第\s*\d{1,4}\s*页", stripped):
            continue
        if re.fullmatch(r"\.{4,}", stripped):
            continue
        out.append(line)
    return "\n".join(out)


def _strip_toc_dot_leaders(text: str) -> str:
    return re.sub(r"[ \t]*\.{3,}[ \t]*\d+\s*$", "", text, flags=re.MULTILINE)


def _collapse_spaces(text: str) -> str:
    lines = []
    for line in text.split("\n"):
        if line.strip().startswith("```"):
            lines.append(line.rstrip())
            continue
        lines.append(re.sub(r"[ \t]+", " ", line).rstrip())
    text = "\n".join(lines)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def _dedupe_consecutive_lines(text: str, *, min_len: int = 8) -> str:
    lines = text.split("\n")
    out: list[str] = []
    prev: str | None = None
    for line in lines:
        key = line.strip()
        if key and len(key) >= min_len and key == prev:
            continue
        out.append(line)
        prev = key if key else None
    return "\n".join(out)


def _merge_broken_paragraphs(text: str) -> str:
    lines = text.split("\n")
    result: list[str] = []
    buf = ""

    def flush() -> None:
        nonlocal buf
        if buf:
            result.append(buf)
            buf = ""

    for line in lines:
        stripped = line.strip()
        if not stripped:
            flush()
            result.append("")
            continue
        if re.match(r"^(#{1,6}\s|[-*+]\s|\d+\.\s|>|```)", stripped):
            flush()
            result.append(stripped)
            continue
        if buf:
            ends_sentence = bool(re.search(r"[.!?。！？:：;；)]\s*$", buf))
            starts_structural = stripped[0].isupper() or stripped[0].isdigit()
            if not ends_sentence and not starts_structural:
                buf = f"{buf} {stripped}"
            else:
                flush()
                buf = stripped
        else:
            buf = stripped
    flush()
    return "\n".join(result)


def cleanup_extracted_text(text: str) -> str:
    """Deterministic cleanup for PDF/OCR extracted plain text."""
    t = _normalize_unicode(text)
    t = _fix_hyphenation(t)
    t = _remove_noise_lines(t)
    t = _strip_toc_dot_leaders(t)
    t = _dedupe_consecutive_lines(t)
    t = _merge_broken_paragraphs(t)
    t = _collapse_spaces(t)
    return t.strip()


def cleanup_extracted_text_with_stats(text: str) -> Tuple[str, Dict[str, Any]]:
    original = (text or "").strip()
    cleaned = cleanup_extracted_text(original)
    return cleaned, {
        "original_chars": len(original),
        "cleaned_chars": len(cleaned),
        "chars_removed": max(0, len(original) - len(cleaned)),
        "changed": cleaned != original,
    }


def _split_for_llm(text: str, chunk_size: int = _CHUNK_SIZE) -> list[str]:
    paragraphs = [p.strip() for p in re.split(r"\n{2,}", text) if p.strip()]
    if not paragraphs:
        return [text] if text.strip() else []
    chunks: list[str] = []
    buf: list[str] = []
    size = 0
    for para in paragraphs:
        plen = len(para) + 2
        if buf and size + plen > chunk_size:
            chunks.append("\n\n".join(buf))
            buf = [para]
            size = plen
        else:
            buf.append(para)
            size += plen
    if buf:
        chunks.append("\n\n".join(buf))
    return chunks


def _strip_llm_fences(text: str) -> str:
    raw = (text or "").strip()
    if "```" in raw:
        m = re.search(r"```(?:markdown|md)?\s*([\s\S]*?)\s*```", raw, re.IGNORECASE)
        if m:
            return m.group(1).strip()
    return raw


async def llm_polish_markdown(
    text: str,
    *,
    title: str = "",
    source_type: str = "",
) -> Tuple[Optional[str], Optional[str]]:
    """Return (polished_text, error). None text means skip/fallback to rules-only."""
    from core.llm_provider import get_api_key, get_chat_llm

    normalized = (text or "").strip()
    if not normalized:
        return None, "empty_content"
    if not get_api_key():
        return None, "missing_api_key"

    if len(normalized) > _MAX_LLM_CHARS:
        chunks = _split_for_llm(normalized)
    else:
        chunks = [normalized]

    llm = get_chat_llm(temperature=0.2, streaming=False)
    polished_parts: list[str] = []

    for idx, chunk in enumerate(chunks):
        meta = []
        if title:
            meta.append(f"文档标题: {title}")
        if source_type:
            meta.append(f"来源类型: {source_type}")
        if len(chunks) > 1:
            meta.append(f"片段: {idx + 1}/{len(chunks)}")
        user = "\n".join(meta + ["", "待整理正文:", chunk])
        try:
            resp = await llm.ainvoke(
                [SystemMessage(content=_SYSTEM), HumanMessage(content=user)]
            )
            part = _strip_llm_fences(str(getattr(resp, "content", "") or ""))
            if not part.strip():
                return None, "empty_llm_response"
            polished_parts.append(part.strip())
        except Exception as exc:
            logger.warning("LLM polish chunk %s failed: %s", idx + 1, exc)
            return None, str(exc)

    return "\n\n".join(polished_parts).strip(), None


async def optimize_knowledge_content(
    text: str,
    *,
    title: str = "",
    source_type: str = "",
    use_llm: bool = True,
) -> Dict[str, Any]:
    cleaned, rule_stats = cleanup_extracted_text_with_stats(text)
    result: Dict[str, Any] = {
        "content": cleaned,
        "method": "rules",
        "rules": rule_stats,
        "llm_applied": False,
    }

    if not use_llm:
        return result

    polished, llm_error = await llm_polish_markdown(
        cleaned,
        title=title,
        source_type=source_type,
    )
    if polished:
        result["content"] = polished
        result["method"] = "rules+llm"
        result["llm_applied"] = True
        result["llm"] = {
            "chars_before": rule_stats["cleaned_chars"],
            "chars_after": len(polished),
        }
    elif llm_error == "missing_api_key":
        result["llm_skipped"] = "missing_api_key"
    elif llm_error:
        result["llm_error"] = llm_error

    return result
