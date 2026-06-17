"""
Unified web search for multi-agent paths.

MCP DuckDuckGo preset first, then built-in DuckDuckGo HTML fallback.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

from langchain.tools import tool

from utils.logger import setup_logger
from utils.simple_ddg_search import ddg_html_search_structured

logger = setup_logger("web_search_tools")

DEFAULT_MCP_WEB_SERVER_ID = "mcp-preset-duckduckgo"
_MCP_CONFIG = Path(__file__).resolve().parent.parent.parent / "storage" / "mcp_servers.json"


def _load_mcp_servers() -> List[Dict[str, Any]]:
    if not _MCP_CONFIG.exists():
        return []
    try:
        return json.loads(_MCP_CONFIG.read_text()).get("servers", [])
    except Exception:
        return []


def _resolve_duckduckgo_mcp_url(server_id: str = "") -> str:
    sid = (server_id or os.getenv("MCP_WEB_SEARCH_SERVER_ID") or DEFAULT_MCP_WEB_SERVER_ID).strip()
    servers = _load_mcp_servers()
    for row in servers:
        if row.get("enabled") is False:
            continue
        rid = str(row.get("id") or "")
        preset = str(row.get("preset_id") or "")
        if rid == sid or preset == "duckduckgo" or rid == DEFAULT_MCP_WEB_SERVER_ID:
            url = str(row.get("url") or "").strip()
            if url:
                return url
    for row in servers:
        if row.get("enabled") is False:
            continue
        name = str(row.get("name") or "").lower()
        desc = str(row.get("description") or "").lower()
        preset = str(row.get("preset_id") or "").lower()
        if "duckduckgo" in name or "duckduckgo" in desc or preset == "duckduckgo":
            url = str(row.get("url") or "").strip()
            if url:
                return url
    return ""


def _region_for_query(query: str, region: str) -> str:
    reg = (region or "").strip()
    if reg:
        return reg
    if any("\u4e00" <= c <= "\u9fff" for c in query):
        return "cn-zh"
    return ""


def _search_via_mcp(query: str, max_results: int, region: str) -> Optional[str]:
    url = _resolve_duckduckgo_mcp_url()
    if not url:
        return None
    try:
        from services.mcp_client import invoke_mcp_tool_sync

        args: Dict[str, Any] = {"query": query, "max_results": max_results}
        if region:
            args["region"] = region
        result = invoke_mcp_tool_sync(url, "search", args)
        if not result.get("success"):
            logger.warning("[web_search] MCP search failed: %s", result.get("error"))
            return None
        text = str(result.get("result") or "").strip()
        return text or None
    except Exception as exc:
        logger.warning("[web_search] MCP search exception: %s", exc)
        return None


def _search_via_ddg(query: str, max_results: int, region: str) -> str:
    structured = ddg_html_search_structured(query, max_results=max_results, region=region)
    return structured.get("text") or "No search results."


def execute_web_search_sync(
    query: str,
    max_results: int = 10,
    region: str = "",
) -> str:
    """
    Core search used by LangChain tool and orchestrator pre-flight injection.
    """
    q = (query or "").strip()
    if not q:
        return "Error: empty query"

    mr = max(1, min(20, int(max_results)))
    reg = _region_for_query(q, region)

    mcp_text = _search_via_mcp(q, mr, reg)
    if mcp_text:
        logger.info("[web_search] path=mcp result_len=%d", len(mcp_text))
        return mcp_text

    if not reg and any("\u4e00" <= c <= "\u9fff" for c in q):
        mcp_text = _search_via_mcp(q, mr, "cn-zh")
        if mcp_text:
            logger.info("[web_search] path=mcp_cn_zh result_len=%d", len(mcp_text))
            return mcp_text

    ddg_text = _search_via_ddg(q, mr, reg or _region_for_query(q, ""))
    logger.info("[web_search] path=ddg_html result_len=%d", len(ddg_text))
    return ddg_text


@tool
def search_web(query: str, max_results: int = 10, region: str = "") -> str:
    """
    Search the web via DuckDuckGo for real-time information.

    Use for weather, news, stock prices, exchange rates, and any up-to-date facts.
    Always call this before answering questions that need current external data.

    Args:
        query: Search keywords (e.g. "深圳 今天 天气")
        max_results: Number of results (1-20, default 10)
        region: Optional region code (e.g. cn-zh for Chinese results)
    """
    return execute_web_search_sync(query, max_results=max_results, region=region)
