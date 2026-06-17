"""Map last30days JSON Report → research_artifact."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from core.research_artifact import make_research_artifact, make_research_item


def _safe_str(value: Any, limit: int = 8000) -> str:
    if value is None:
        return ""
    return str(value).strip()[:limit]


def _engagement_label(engagement: Any) -> str:
    if not isinstance(engagement, dict):
        if engagement is not None:
            return str(engagement)
        return ""
    parts: List[str] = []
    for key in ("score", "upvotes", "likes", "comments", "views", "points"):
        if key in engagement and engagement[key] is not None:
            parts.append(f"{key}={engagement[key]}")
    if not parts:
        for key, val in list(engagement.items())[:4]:
            parts.append(f"{key}={val}")
    return ", ".join(parts)


def _candidate_to_item(candidate: Dict[str, Any]) -> Dict[str, Any]:
    source = _safe_str(candidate.get("source") or "unknown", 32)
    title = _safe_str(candidate.get("title") or "条目", 500)
    url = _safe_str(candidate.get("url"), 4000)
    snippet = _safe_str(
        candidate.get("snippet")
        or candidate.get("explanation")
        or candidate.get("body"),
        4000,
    )
    quote = _safe_str(candidate.get("explanation") or candidate.get("snippet"), 2000)
    score = candidate.get("final_score") or candidate.get("rerank_score")
    confidence = float(score) if isinstance(score, (int, float)) else None
    engagement = candidate.get("engagement")
    return make_research_item(
        title=title,
        url=url,
        snippet=snippet,
        quote=quote,
        confidence=confidence,
        extra={
            "source": source,
            "engagement": engagement if isinstance(engagement, dict) else {"raw": engagement},
            "engagement_label": _engagement_label(engagement),
            "cluster_id": candidate.get("cluster_id"),
            "candidate_id": candidate.get("candidate_id"),
        },
    )


def _source_item_to_research_item(item: Dict[str, Any]) -> Dict[str, Any]:
    source = _safe_str(item.get("source") or "unknown", 32)
    title = _safe_str(item.get("title") or "条目", 500)
    url = _safe_str(item.get("url"), 4000)
    snippet = _safe_str(item.get("snippet") or item.get("body") or item.get("why_relevant"), 4000)
    quote = _safe_str(item.get("why_relevant") or item.get("body"), 2000)
    score = item.get("local_rank_score") or item.get("relevance_hint")
    confidence = float(score) if isinstance(score, (int, float)) else None
    return make_research_item(
        title=title,
        url=url,
        snippet=snippet,
        quote=quote,
        confidence=confidence,
        extra={
            "source": source,
            "engagement": item.get("engagement") if isinstance(item.get("engagement"), dict) else {},
            "engagement_label": _engagement_label(item.get("engagement")),
            "author": item.get("author"),
            "published_at": item.get("published_at"),
        },
    )


def build_summary_from_report(report: Dict[str, Any]) -> str:
    """Build markdown summary from last30days JSON report."""
    topic = _safe_str(report.get("topic") or "调研主题", 500)
    range_from = _safe_str(report.get("range_from"), 32)
    range_to = _safe_str(report.get("range_to"), 32)
    lines = [f"# {topic}", ""]
    if range_from or range_to:
        lines.append(f"时间范围：{range_from or '?'} → {range_to or '?'}")
        lines.append("")

    clusters = report.get("clusters") or []
    if isinstance(clusters, list) and clusters:
        lines.append("## 核心主题簇")
        for cluster in clusters[:8]:
            if not isinstance(cluster, dict):
                continue
            title = _safe_str(cluster.get("title") or "主题", 300)
            score = cluster.get("score")
            sources = cluster.get("sources") or []
            src_label = ", ".join(_safe_str(s, 24) for s in sources[:5]) if sources else ""
            suffix = f" · {src_label}" if src_label else ""
            if isinstance(score, (int, float)):
                lines.append(f"- **{title}** (score {score:.2f}){suffix}")
            else:
                lines.append(f"- **{title}**{suffix}")
        lines.append("")

    candidates = report.get("ranked_candidates") or []
    if isinstance(candidates, list) and candidates:
        lines.append("## 高互动引用")
        sorted_cands = sorted(
            [c for c in candidates if isinstance(c, dict)],
            key=lambda c: float(c.get("final_score") or c.get("rerank_score") or 0),
            reverse=True,
        )
        for cand in sorted_cands[:12]:
            title = _safe_str(cand.get("title") or "条目", 200)
            source = _safe_str(cand.get("source"), 24)
            snippet = _safe_str(cand.get("snippet") or cand.get("explanation"), 280)
            eng = _engagement_label(cand.get("engagement"))
            eng_part = f" · {eng}" if eng else ""
            lines.append(f"- [{source}] **{title}**{eng_part}")
            if snippet:
                lines.append(f"  {snippet}")
        lines.append("")

    warnings = report.get("warnings") or []
    if isinstance(warnings, list) and warnings:
        lines.append("## 数据质量提示")
        for w in warnings[:5]:
            lines.append(f"- {_safe_str(w, 400)}")
        lines.append("")

    errors = report.get("errors_by_source") or {}
    if isinstance(errors, dict) and errors:
        failed = [f"{k}: {_safe_str(v, 120)}" for k, v in errors.items() if v]
        if failed:
            lines.append("## 部分数据源不可用")
            for line in failed[:6]:
                lines.append(f"- {line}")

    return "\n".join(lines).strip()


def collect_research_items(report: Dict[str, Any], *, max_items: int = 24) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    seen_urls: set[str] = set()

    candidates = report.get("ranked_candidates") or []
    if isinstance(candidates, list):
        sorted_cands = sorted(
            [c for c in candidates if isinstance(c, dict)],
            key=lambda c: float(c.get("final_score") or c.get("rerank_score") or 0),
            reverse=True,
        )
        for cand in sorted_cands:
            url = _safe_str(cand.get("url"), 4000)
            if url and url in seen_urls:
                continue
            if url:
                seen_urls.add(url)
            items.append(_candidate_to_item(cand))
            if len(items) >= max_items:
                return items

    by_source = report.get("items_by_source") or {}
    if isinstance(by_source, dict):
        for _source, source_items in by_source.items():
            if not isinstance(source_items, list):
                continue
            for raw in source_items:
                if not isinstance(raw, dict):
                    continue
                url = _safe_str(raw.get("url"), 4000)
                if url and url in seen_urls:
                    continue
                if url:
                    seen_urls.add(url)
                items.append(_source_item_to_research_item(raw))
                if len(items) >= max_items:
                    return items

    return items


def last30days_report_to_artifact(
    report: Dict[str, Any],
    *,
    query: str = "",
    mode: str = "quick",
    platform: str = "douyin",
    goal: str = "",
    trace_id: Optional[str] = None,
    local_paths: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    """Convert parsed last30days JSON report to research_artifact."""
    topic = _safe_str(report.get("topic") or query, 500)
    summary = build_summary_from_report(report)
    items = collect_research_items(report)

    sources_used = sorted(
        {
            _safe_str(k, 32)
            for k in (report.get("items_by_source") or {}).keys()
            if k
        }
    )
    raw_meta = {
        "engine": "last30days",
        "mode": mode,
        "platform": platform,
        "goal": goal,
        "sources_used": sources_used,
        "cluster_count": len(report.get("clusters") or []),
        "candidate_count": len(report.get("ranked_candidates") or []),
        "warnings": report.get("warnings") or [],
        "errors_by_source": report.get("errors_by_source") or {},
        "local_paths": local_paths or {},
        "generated_at": report.get("generated_at"),
    }

    return make_research_artifact(
        "custom",
        query=query or topic,
        title=f"{topic} · 近30天调研",
        summary=summary,
        items=items,
        raw={"last30days": report, **raw_meta},
        trace_id=trace_id,
    )
