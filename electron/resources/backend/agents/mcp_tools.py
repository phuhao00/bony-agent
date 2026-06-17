"""
Shared MCP tool injection and agent cache refresh after MCP lifecycle changes.
"""

from __future__ import annotations

from typing import Any, List

from utils.logger import setup_logger

logger = setup_logger("mcp_tools")


def attach_mcp_tools(tools: List[Any]) -> List[Any]:
    """Append LangChain tools from all enabled MCP servers; skip on failure."""
    try:
        from services.mcp_client import get_all_enabled_mcp_tools

        mcp_tools = get_all_enabled_mcp_tools()
        if mcp_tools:
            logger.info("[MCP] Injected %d MCP tools", len(mcp_tools))
            return tools + mcp_tools
    except Exception as exc:
        logger.debug("[MCP] Tool injection skipped: %s", exc)
    return tools


def refresh_agents_after_mcp_change() -> None:
    """Invalidate cached agent instances and compiled multi-agent graph."""
    try:
        from agents.pet_tools_agent import clear_pet_tools_cache

        clear_pet_tools_cache()
    except Exception as exc:
        logger.debug("[MCP] pet tools cache invalidate skipped: %s", exc)
    try:
        from services.mcp_client import invalidate_mcp_tools_cache

        invalidate_mcp_tools_cache()
    except Exception as exc:
        logger.debug("[MCP] tools cache invalidate skipped: %s", exc)
    try:
        from agents.registry import AgentRegistry

        AgentRegistry().invalidate_all()
    except Exception as exc:
        logger.warning("[MCP] registry invalidate failed: %s", exc)

    try:
        from agents.orchestrator import clear_graph_cache

        clear_graph_cache()
    except Exception as exc:
        logger.warning("[MCP] graph cache clear failed: %s", exc)
