"""Keyword FAQ retrieval for customer-service workspaces."""

from __future__ import annotations

import re
from difflib import SequenceMatcher
from typing import Any, Dict, List, Optional, Tuple


def _normalize(text: str) -> str:
    cleaned = re.sub(r"[\s\u3000·•|/\\\-_.,，。!！?？:：;；'\"“”‘’（）()【】\[\]<>《》]", "", text or "")
    return cleaned.lower()


def _tokens(text: str) -> set[str]:
    raw = (text or "").lower()
    parts = re.findall(r"[\u4e00-\u9fff]|[a-z0-9]{2,}", raw)
    if not parts and raw.strip():
        return {raw.strip()}
    return set(parts)


def _score_faq_item(query: str, item: Dict[str, Any]) -> float:
    question = (item.get("question") or "").strip()
    answer = (item.get("answer") or "").strip()
    tags = " ".join(item.get("tags") or [])
    if not question and not answer:
        return 0.0

    q_norm = _normalize(query)
    q_lower = query.lower().strip()
    score = 0.0

    q_text = question.lower()
    if q_lower and q_lower in q_text:
        score += 45.0
    if q_norm and _normalize(question).find(q_norm) >= 0:
        score += 35.0

    tag_blob = tags.lower()
    for tok in _tokens(query):
        if len(tok) < 2:
            continue
        if tok in tag_blob:
            score += 12.0
        if tok in q_text:
            score += 8.0
        if tok in answer.lower():
            score += 3.0

    q_toks = _tokens(query)
    q_blob = _tokens(f"{question} {tags}")
    if q_toks and q_blob:
        overlap = len(q_toks & q_blob) / max(1, len(q_toks))
        score += overlap * 28.0

    ratio = SequenceMatcher(None, q_norm, _normalize(question)).ratio()
    score += ratio * 22.0

    if len(q_norm) >= 4 and question.startswith(query.strip()[1:]):
        score += 10.0

    return score


def search_faq_items(
    items: List[Dict[str, Any]],
    query: str,
    *,
    top_k: int = 5,
    min_score: float = 8.0,
) -> List[Tuple[Dict[str, Any], float]]:
    if not query.strip() or not items:
        return []
    scored: List[Tuple[Dict[str, Any], float]] = []
    for item in items:
        s = _score_faq_item(query, item)
        if s >= min_score:
            scored.append((item, s))
    scored.sort(key=lambda x: x[1], reverse=True)
    return scored[:top_k]


def _split_markdown_sections(body: str) -> List[str]:
    text = (body or "").strip()
    if not text:
        return []
    parts = re.split(r"\n(?=#{1,4}\s)", text)
    sections = [p.strip() for p in parts if p.strip()]
    if sections:
        return sections
    return [p.strip() for p in re.split(r"\n{2,}", text) if p.strip()]


def search_markdown_sections(
    body: str,
    query: str,
    *,
    top_k: int = 3,
    min_score: Optional[float] = None,
) -> List[Tuple[str, float, str]]:
    """Keyword-match Markdown sections for bound knowledge documents."""
    q = (query or "").strip()
    if not q or not (body or "").strip():
        return []

    threshold = min_score if min_score is not None else (4.0 if len(q) <= 3 else 8.0)
    q_lower = q.lower()
    scored: List[Tuple[str, float, str]] = []

    for section in _split_markdown_sections(body):
        title = ""
        match = re.match(r"^#{1,4}\s+(.+)", section)
        if match:
            title = match.group(1).strip()
        pseudo = {"question": title, "answer": section, "tags": []}
        score = _score_faq_item(q, pseudo)
        blob = section.lower()
        if q_lower and q_lower in blob:
            score += 35.0
        if q_lower and re.search(
            rf"(?<![a-z0-9]){re.escape(q_lower)}(?![a-z0-9])",
            blob,
        ):
            score += 25.0
        if score >= threshold:
            scored.append((section, score, title or section.split("\n", 1)[0][:80]))

    scored.sort(key=lambda x: x[1], reverse=True)
    return scored[:top_k]
