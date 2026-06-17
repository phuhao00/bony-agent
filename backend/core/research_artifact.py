"""
统一「多源检索/研究」结果的轻量结构化格式，供 Web Search、Computer Use、RAG、记忆等聚合使用。
"""

from __future__ import annotations

import time
import urllib.parse
import uuid
from typing import Any, Dict, List, Optional, Tuple

_TRACKING_QUERY_KEYS = frozenset(
    k.lower()
    for k in (
        "utm_source",
        "utm_medium",
        "utm_campaign",
        "utm_term",
        "utm_content",
        "utm_id",
        "fbclid",
        "gclid",
        "mc_eid",
        "ref",
        "yclid",
        "_ga",
    )
)

RESEARCH_SOURCES = frozenset(
    {"web_search", "computer_use", "rag", "memory", "platform_read", "custom"}
)


def make_research_item(
    *,
    title: str = "",
    url: str = "",
    snippet: str = "",
    confidence: Optional[float] = None,
    quote: str = "",
    extra: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    return {
        "id": str(uuid.uuid4())[:8],
        "title": (title or "")[:2000],
        "url": (url or "")[:4000],
        "snippet": (snippet or "")[:12000],
        "confidence": confidence,
        "quote": (quote or "")[:8000],
        "extra": extra or {},
    }


def make_research_artifact(
    source: str,
    *,
    query: str = "",
    title: str = "",
    summary: str = "",
    items: Optional[List[Dict[str, Any]]] = None,
    raw: Optional[Dict[str, Any]] = None,
    trace_id: Optional[str] = None,
    locale: str = "zh-CN",
) -> Dict[str, Any]:
    src = (source or "custom").strip().lower()
    if src not in RESEARCH_SOURCES:
        src = "custom"
    now = time.time()
    return {
        "schema_version": 1,
        "id": str(uuid.uuid4()),
        "source": src,
        "locale": locale,
        "query": (query or "")[:4000],
        "title": (title or "")[:2000],
        "summary": (summary or "")[:50000],
        "items": list(items or []),
        "raw": raw,
        "trace_id": trace_id,
        "retrieved_at": now,
        "retrieved_at_iso": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now)),
    }


def normalize_research_url_key(url: str) -> str:
    """
    归一化 URL，供 trace/合并时去重（忽略大小写、常见追踪参数、fragment）。
    无 URL 时返回空串，调用方需改用标题+摘要键。
    """
    raw = (url or "").strip()
    if not raw:
        return ""
    try:
        pr = urllib.parse.urlsplit(raw)
        host = (pr.netloc or "").lower()
        if host.startswith("www."):
            host = host[4:]
        path = (pr.path or "").rstrip("/") or "/"
        pairs = urllib.parse.parse_qsl(pr.query, keep_blank_values=True)
        keep = [(k, v) for k, v in pairs if (k or "").lower() not in _TRACKING_QUERY_KEYS]
        keep.sort(key=lambda kv: (kv[0].lower(), kv[1]))
        q = urllib.parse.urlencode(keep)
        return f"{host}{path}?{q}" if q else f"{host}{path}"
    except Exception:
        return raw.lower()[:800]


def dedupe_research_items(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """按 normalize_research_url_key 去重；无 URL 时用 title+snippet 前缀做键。保留首次出现顺序。"""
    seen: set[str] = set()
    out: List[Dict[str, Any]] = []
    for it in items:
        if not isinstance(it, dict):
            continue
        url = str(it.get("url") or "").strip()
        if url:
            key = normalize_research_url_key(url)
        else:
            key = "t:" + str(it.get("title") or "")[:200] + "\n" + str(it.get("snippet") or "")[:200]
        if key in seen:
            continue
        seen.add(key)
        out.append(it)
    return out


def _heuristic_confidence(item: Dict[str, Any], *, source: str) -> float:
    snippet = str(item.get("snippet") or "")
    quote = str(item.get("quote") or "")
    url = str(item.get("url") or "")
    base_map = {
        "web_search": 0.52,
        "rag": 0.62,
        "memory": 0.48,
        "computer_use": 0.55,
        "platform_read": 0.6,
    }
    score = float(base_map.get((source or "custom").strip().lower(), 0.5))
    if url.lower().startswith(("http://", "https://")):
        score += 0.06
    if len(quote.strip()) >= 12:
        score += 0.12
    elif len(snippet.strip()) >= 40:
        score += 0.07
    if len(snippet.strip()) >= 120:
        score += 0.04
    return round(min(0.92, max(0.35, score)), 4)


def resolve_trace_confidence(item: Dict[str, Any], *, source: str) -> Tuple[float, str]:
    """返回 (confidence, basis)；basis 为 reported 或 heuristic。"""
    raw = item.get("confidence")
    if raw is not None:
        try:
            v = float(raw)
            if 0.0 <= v <= 1.0:
                return round(min(1.0, max(0.0, v)), 4), "reported"
        except (TypeError, ValueError):
            pass
    return _heuristic_confidence(item, source=source), "heuristic"


def merge_research_summaries(artifacts: List[Dict[str, Any]], *, max_items: int = 50) -> Dict[str, Any]:
    """将多篇研究片段合成一个总卡片（不落库，仅用于响应拼装）。"""
    all_items: List[Dict[str, Any]] = []
    sources: List[str] = []
    for art in artifacts:
        if not isinstance(art, dict):
            continue
        s = art.get("source")
        if s:
            sources.append(str(s))
        for it in art.get("items") or []:
            if isinstance(it, dict):
                all_items.append(it)
    all_items = dedupe_research_items(all_items)
    return {
        "schema_version": 1,
        "kind": "merged",
        "sources": list(dict.fromkeys(sources)),
        "item_count": len(all_items),
        "items": all_items[:max_items],
        "merged_at": time.time(),
    }


def research_trace_previews(
    artifact: Dict[str, Any],
    *,
    items_limit: int = 12,
    summary_max: int = 1200,
    title_max: int = 240,
    url_max: int = 800,
    snippet_max: int = 500,
    quote_max: int = 400,
    dedupe_items: bool = True,
    fill_quote_from_snippet: bool = True,
    calibrate_confidence: bool = True,
) -> Dict[str, Any]:
    """
    供 trace 事件使用的摘要与条目预览（截断）。
    items 每条可含 title/url/snippet/quote/confidence，便于审计检索来源与片段。
    可选：按 URL 归一化去重；无 quote 时用 snippet 头部补全引用预览；置信度 reported 优先否则启发式。
    """
    if not isinstance(artifact, dict):
        return {"summary_preview": "", "items_preview": []}
    summ = (artifact.get("summary") or "").strip()
    summary_preview = (summ[:summary_max] + "…") if len(summ) > summary_max else summ
    src = str(artifact.get("source") or "web_search").strip().lower()
    items_list: List[Dict[str, Any]] = [it for it in (artifact.get("items") or []) if isinstance(it, dict)]
    if dedupe_items:
        items_list = dedupe_research_items(items_list)
    items_out: List[Dict[str, Any]] = []
    for it in items_list[:items_limit]:
        row: Dict[str, Any] = {
            "title": (str(it.get("title") or ""))[:title_max],
            "url": (str(it.get("url") or ""))[:url_max],
            "snippet": (str(it.get("snippet") or ""))[:snippet_max],
        }
        quote = (str(it.get("quote") or "")).strip()
        snippet_full = (str(it.get("snippet") or "")).strip()
        if not quote and fill_quote_from_snippet and snippet_full:
            quote = snippet_full[:quote_max]
            row["quote"] = quote
            row["quote_source"] = "snippet"
        elif quote:
            row["quote"] = quote[:quote_max]
        if calibrate_confidence:
            oc = dict(it)
            oc["quote"] = quote
            oc["snippet"] = snippet_full
            conf, basis = resolve_trace_confidence(oc, source=src)
            row["confidence"] = conf
            row["confidence_basis"] = basis
        else:
            if it.get("confidence") is not None:
                try:
                    row["confidence"] = float(it["confidence"])
                except (TypeError, ValueError):
                    pass
        items_out.append(row)
    return {"summary_preview": summary_preview, "items_preview": items_out}
