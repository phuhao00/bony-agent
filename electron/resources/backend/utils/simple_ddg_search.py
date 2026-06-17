"""
Lightweight DuckDuckGo HTML search (same strategy as duckduckgo-mcp-server).

Used as a fallback when MCP Streamable HTTP is down, unreachable, or not configured.
"""

from __future__ import annotations

import time
import urllib.parse
from typing import Any, Dict, List, Optional

import httpx
from bs4 import BeautifulSoup

from utils.logger import setup_logger

logger = setup_logger("simple_ddg_search")

DDG_HTML_URL = "https://html.duckduckgo.com/html"
_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    )
}


def ddg_html_search_structured(
    query: str,
    max_results: int = 10,
    region: str = "",
) -> Dict[str, Any]:
    """
    Structured DDG HTML search: items + LLM-readable text.

    Keys: ok, query, region, items [{title,url,snippet}], text, error (optional).
    """
    q = (query or "").strip()
    if not q:
        logger.warning("[ddg-html] reject_empty_query")
        return {
            "ok": False,
            "query": "",
            "region": (region or "").strip(),
            "items": [],
            "text": "Error: empty query",
            "error": "empty_query",
        }

    mr = max(1, min(20, int(max_results)))
    reg = (region or "").strip()

    t0 = time.perf_counter()
    logger.info(
        "[ddg-html] begin query_len=%d max_results=%s region=%r",
        len(q),
        mr,
        reg or "(default)",
    )

    form = {
        "q": q,
        "b": "",
        "kl": reg,
        "kp": "-1",
    }

    try:
        with httpx.Client(timeout=35.0, trust_env=False) as client:
            resp = client.post(DDG_HTML_URL, data=form, headers=_HEADERS)
            resp.raise_for_status()
            html = resp.text
        elapsed_ms = (time.perf_counter() - t0) * 1000
        logger.info(
            "[ddg-html] http_ok status=%s html_bytes=%d elapsed_ms=%.0f",
            resp.status_code,
            len(html),
            elapsed_ms,
        )
    except httpx.TimeoutException:
        logger.warning(
            "[ddg-html] timeout query_preview=%s elapsed_ms=%.0f",
            q[:80],
            (time.perf_counter() - t0) * 1000,
        )
        return {
            "ok": False,
            "query": q,
            "region": reg,
            "items": [],
            "text": "Error: DuckDuckGo search timed out.",
            "error": "timeout",
        }
    except httpx.HTTPError as e:
        logger.warning(
            "[ddg-html] http_exc query_preview=%s err=%s elapsed_ms=%.0f",
            q[:80],
            e,
            (time.perf_counter() - t0) * 1000,
        )
        return {
            "ok": False,
            "query": q,
            "region": reg,
            "items": [],
            "text": f"Error: DuckDuckGo search failed ({e})",
            "error": "http_error",
        }

    soup = BeautifulSoup(html, "html.parser")
    if soup is None:
        logger.warning("[ddg-html] BeautifulSoup parse returned None html_bytes=%d", len(html))
        msg = "No results were found for your search query. Try rephrasing or retry later."
        return {
            "ok": False,
            "query": q,
            "region": reg,
            "items": [],
            "text": msg,
            "error": "parse_none",
        }

    titles: List[str] = []
    snippets: List[str] = []
    links: List[str] = []

    for result in soup.select(".result"):
        title_elem = result.select_one(".result__title")
        if not title_elem:
            continue
        link_elem = title_elem.find("a")
        if not link_elem:
            continue

        title = link_elem.get_text(strip=True)
        link = link_elem.get("href", "")

        if "y.js" in link:
            continue

        if link.startswith("//duckduckgo.com/l/?uddg="):
            link = urllib.parse.unquote(link.split("uddg=")[1].split("&")[0])

        snippet_elem = result.select_one(".result__snippet")
        snippet = snippet_elem.get_text(strip=True) if snippet_elem else ""

        titles.append(title)
        snippets.append(snippet)
        links.append(link)

        if len(titles) >= mr:
            break

    if not titles:
        elapsed_ms = (time.perf_counter() - t0) * 1000
        snippet_preview = (
            (html[:280].replace("\n", " ").replace("\r", "")) if html else ""
        )
        logger.warning(
            "[ddg-html] zero_hit candidates=%s html_bytes=%d elapsed_ms=%.0f snippet=%r",
            len(soup.select(".result")),
            len(html),
            elapsed_ms,
            snippet_preview,
        )
        msg = (
            "No results were found for your search query. This could be due to "
            "DuckDuckGo bot filtering or empty matches — try changing wording or cn-zh region."
        )
        return {
            "ok": False,
            "query": q,
            "region": reg,
            "items": [],
            "text": msg,
            "error": "zero_hit",
        }

    elapsed_ms = (time.perf_counter() - t0) * 1000
    lines = [f"Found {len(titles)} search results:\n"]
    items: List[Dict[str, str]] = []
    for i in range(len(titles)):
        items.append(
            {"title": titles[i], "url": links[i], "snippet": snippets[i]}
        )
        lines.append(f"{i + 1}. {titles[i]}")
        lines.append(f" URL: {links[i]}")
        lines.append(f" Summary: {snippets[i]}")
        lines.append("")
    body = "\n".join(lines)
    logger.info(
        "[ddg-html] success hit_count=%d out_chars=%d elapsed_ms=%.0f",
        len(titles),
        len(body),
        elapsed_ms,
    )
    return {
        "ok": True,
        "query": q,
        "region": reg,
        "items": items,
        "text": body,
        "error": None,
    }


def ddg_html_search_sync(
    query: str,
    max_results: int = 10,
    region: str = "",
) -> str:
    """
    Return LLM-readable search result text.

    Mirrors duckduckgo-mcp-server DuckDuckGoSearcher behavior (moderate SafeSearch kp=-1).
    """
    return ddg_html_search_structured(query, max_results=max_results, region=region)[
        "text"
    ]


def ddg_html_search_research_artifact(
    query: str,
    max_results: int = 10,
    region: str = "",
    trace_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Build a research_artifact dict from DDG HTML results (see core.research_artifact)."""
    from core.research_artifact import make_research_artifact, make_research_item

    s = ddg_html_search_structured(query, max_results=max_results, region=region)
    if not s["ok"]:
        return make_research_artifact(
            "web_search",
            query=s["query"],
            title="Web search (no hits)",
            summary=s.get("text") or "",
            items=[],
            raw={"ok": False, "error": s.get("error"), "region": s.get("region")},
            trace_id=trace_id,
        )
    items = [
        make_research_item(title=it["title"], url=it["url"], snippet=it["snippet"])
        for it in s["items"]
    ]
    return make_research_artifact(
        "web_search",
        query=s["query"],
        title=f"Web: {s['query'][:120]}",
        summary=s["text"],
        items=items,
        raw={
            "ok": True,
            "hit_count": len(items),
            "region": s.get("region"),
        },
        trace_id=trace_id,
    )
