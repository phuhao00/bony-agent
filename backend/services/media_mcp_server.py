"""AI Media Agent MCP Server — expose media/knowledge tools to Hermes and other MCP clients."""

from __future__ import annotations

import os
import sys
from pathlib import Path

# Ensure backend package root is importable when run as script
_BACKEND = Path(__file__).resolve().parents[1]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from mcp.server.fastmcp import FastMCP

from utils.logger import setup_logger

logger = setup_logger("media_mcp_server")

MCP_PORT = int(os.environ.get("MEDIA_MCP_PORT", "36850"))
MCP_HOST = os.environ.get("MEDIA_MCP_HOST", "127.0.0.1")

mcp = FastMCP("ai_media_agent")
mcp.settings.host = MCP_HOST
mcp.settings.port = MCP_PORT


@mcp.tool()
def generate_image_tool(prompt: str) -> str:
    """Generate an image from a text prompt using configured media providers."""
    from tools.image_tools import generate_image

    return generate_image.invoke({"prompt": prompt})


@mcp.tool()
def generate_video_tool(prompt: str) -> str:
    """Generate a short video from a text prompt."""
    from tools.video_tools import generate_video

    return generate_video.invoke({"prompt": prompt})


@mcp.tool()
def search_knowledge_base_tool(query: str, category: str = "") -> str:
    """Search the private RAG knowledge base."""
    from tools.rag_tools import search_knowledge_base

    kwargs: dict = {"query": query}
    if category.strip():
        kwargs["category"] = category.strip()
    return search_knowledge_base.invoke(kwargs)


@mcp.tool()
def publish_content_tool(
    platform: str,
    title: str,
    content: str,
    media_path: str = "",
) -> str:
    """
    Publish content to a connected social platform.
    Requires platform credentials configured in AI Media Agent.
    High-risk action — may require approval in the main app.
    """
    import asyncio

    from tools.publisher_tools import publish_content_tool as _publish

    media_urls = [media_path] if media_path.strip() else None
    return asyncio.run(
        _publish.ainvoke(
            {
                "platform": platform,
                "title": title,
                "content": content,
                "media_urls": media_urls,
            }
        )
    )


def main() -> None:
    logger.info("Starting AI Media MCP server on %s:%s/mcp", MCP_HOST, MCP_PORT)
    mcp.run(transport="streamable-http")


if __name__ == "__main__":
    main()
