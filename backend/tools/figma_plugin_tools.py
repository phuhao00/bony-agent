"""LangChain tools that control Figma through the local plugin bridge.

These tools require the AI Media Agent Figma Bridge plugin to be running inside
an open Figma file.  The plugin connects to the local WebSocket bridge and
executes Figma Plugin API commands on behalf of the agent.
"""

from __future__ import annotations

import base64
import json
import re
from typing import Any, Dict, List, Optional

import httpx
from langchain_core.tools import tool

from services.figma_plugin_bridge import get_figma_plugin_bridge
from utils.logger import setup_logger

logger = setup_logger("figma_plugin_tools")


# ─── helpers ─────────────────────────────────────────────────────────────────


def _send(method: str, params: Optional[Dict[str, Any]] = None, timeout: float = 30.0) -> Dict[str, Any]:
    bridge = get_figma_plugin_bridge()
    return bridge.send_command(method, params=params, timeout=timeout)


def _tool_result(raw: Dict[str, Any]) -> str:
    # Normalize plugin response shape { success, result, error } -> { ok, ... }
    normalized = dict(raw)
    if "success" in normalized and "ok" not in normalized:
        normalized["ok"] = normalized.pop("success")
    return json.dumps(normalized, ensure_ascii=False, indent=2)


# ─── status ──────────────────────────────────────────────────────────────────


@tool
def figma_plugin_status() -> str:
    """Check whether the Figma plugin bridge is connected to an open Figma file.

    Returns bridge connection info plus the current page name and selection count
    reported by the plugin (when connected).
    """
    bridge = get_figma_plugin_bridge()
    status = dict(bridge.status())
    plugin_info: Dict[str, Any] = {}
    if status.get("connected"):
        try:
            plugin_info = _send("get_status", timeout=5.0)
        except Exception as exc:
            logger.debug("[figma_plugin_status] get_status failed: %s", exc)
    return _tool_result({"ok": True, **status, "plugin": plugin_info})


# ─── creation ────────────────────────────────────────────────────────────────


@tool
def figma_create_frame(
    name: str = "Frame",
    width: float = 1440,
    height: float = 900,
    x: float = 0,
    y: float = 0,
    fill_hex: str = "#FFFFFF",
) -> str:
    """Create a frame on the current Figma page via the plugin bridge."""
    fills: List[Dict[str, Any]] = []
    if fill_hex:
        fills.append({"type": "SOLID", "color": _hex_to_rgb(fill_hex)})
    return _tool_result(
        _send(
            "create_frame",
            {
                "name": name,
                "width": width,
                "height": height,
                "x": x,
                "y": y,
                "fills": fills,
            },
        )
    )


@tool
def figma_create_rectangle(
    name: str = "Rectangle",
    width: float = 100,
    height: float = 100,
    x: float = 0,
    y: float = 0,
    fill_hex: str = "#E5E5E5",
    corner_radius: float = 0,
    parent_id: str = "",
) -> str:
    """Create a rectangle inside the current Figma page or a given parent node."""
    params: Dict[str, Any] = {
        "name": name,
        "width": width,
        "height": height,
        "x": x,
        "y": y,
        "cornerRadius": corner_radius,
    }
    if fill_hex:
        params["fills"] = [{"type": "SOLID", "color": _hex_to_rgb(fill_hex)}]
    if parent_id:
        params["parentId"] = parent_id
    return _tool_result(_send("create_rectangle", params))


@tool
def figma_create_text(
    content: str,
    name: str = "Text",
    x: float = 0,
    y: float = 0,
    font_size: float = 24,
    fill_hex: str = "#000000",
    parent_id: str = "",
) -> str:
    """Create a text layer on the current Figma page or inside a parent node."""
    params: Dict[str, Any] = {
        "name": name,
        "content": content,
        "x": x,
        "y": y,
        "fontSize": font_size,
    }
    if fill_hex:
        params["fills"] = [{"type": "SOLID", "color": _hex_to_rgb(fill_hex)}]
    if parent_id:
        params["parentId"] = parent_id
    return _tool_result(_send("create_text", params))


# ─── layout & export ─────────────────────────────────────────────────────────


@tool
def figma_apply_auto_layout(
    node_id: str,
    direction: str = "VERTICAL",
    item_spacing: float = 16,
    padding: float = 24,
) -> str:
    """Apply auto layout to an existing frame node."""
    return _tool_result(
        _send(
            "apply_auto_layout",
            {
                "nodeId": node_id,
                "direction": direction,
                "itemSpacing": item_spacing,
                "padding": padding,
            },
        )
    )


@tool
def figma_export_node(
    node_id: str,
    file_format: str = "PNG",
    scale: float = 1,
) -> str:
    """Export an existing node as an image. Returns base64 bytes on success."""
    return _tool_result(
        _send(
            "export_node",
            {"nodeId": node_id, "format": file_format.upper(), "scale": scale},
        )
    )


# ─── advanced / escape hatch ─────────────────────────────────────────────────


@tool
def figma_run_plugin_code(code: str) -> str:
    """Run arbitrary JavaScript code inside the Figma plugin sandbox.

    Use with care — only run trusted code generated by the agent itself.
    """
    return _tool_result(_send("run_code", {"code": code}))


# ─── utilities ───────────────────────────────────────────────────────────────


def _hex_to_rgb(hex_color: str) -> Dict[str, float]:
    """Convert a hex color string to Figma's normalized RGB object."""
    h = hex_color.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    if len(h) != 6:
        return {"r": 1, "g": 1, "b": 1}
    r = int(h[0:2], 16) / 255.0
    g = int(h[2:4], 16) / 255.0
    b = int(h[4:6], 16) / 255.0
    return {"r": r, "g": g, "b": b}


# ─── inspection & cleanup ────────────────────────────────────────────────────


@tool
def figma_list_nodes() -> str:
    """List all top-level nodes on the current Figma page.

    Use this before creating a design to detect existing frames/elements and
    avoid duplicates.
    """
    return _tool_result(_send("list_nodes", timeout=10.0))


@tool
def figma_delete_node(node_id: str) -> str:
    """Delete a node by id. Use to clean up duplicate or stale frames."""
    return _tool_result(_send("delete_node", {"nodeId": node_id}, timeout=10.0))


@tool
def figma_clear_children(node_id: str) -> str:
    """Remove all children inside a frame/group while keeping the container."""
    return _tool_result(_send("clear_children", {"nodeId": node_id}, timeout=10.0))


# ─── image search & fill ─────────────────────────────────────────────────────


@tool
def figma_search_images(query: str, max_results: int = 4) -> str:
    """Search the web for images matching a query. Returns a list of image URLs.

    Use this to find template/photo/illustration images to place into a Figma
    design.  Prefer high-quality results from the first few items.
    """
    results = _search_images(query, max_results=max(1, min(10, int(max_results))))
    return _tool_result({"ok": len(results) > 0, "query": query, "results": results})


@tool
def figma_fill_image(node_id: str, image_url: str, scale_mode: str = "FILL") -> str:
    """Download an image from the web and apply it as the fill of a Figma node.

    The node must support fills (rectangle, frame, etc.).  This is useful for
    filling photo/template placeholders with real images.
    """
    image_bytes = _download_image_bytes(image_url)
    if not image_bytes:
        return _tool_result({"ok": False, "error": f"Failed to download image: {image_url}"})
    b64 = base64.b64encode(image_bytes).decode("ascii")
    return _tool_result(
        _send(
            "fill_image",
            {"nodeId": node_id, "base64": b64, "scaleMode": scale_mode.upper()},
            timeout=60.0,
        )
    )


# Tool list used by agents
FIGMA_PLUGIN_TOOLS = [
    figma_plugin_status,
    figma_list_nodes,
    figma_create_frame,
    figma_create_rectangle,
    figma_create_text,
    figma_apply_auto_layout,
    figma_export_node,
    figma_run_plugin_code,
    figma_delete_node,
    figma_clear_children,
    figma_search_images,
    figma_fill_image,
]


# ─── internal helpers ────────────────────────────────────────────────────────


_DDG_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}


def _search_images(query: str, max_results: int = 4) -> List[Dict[str, Any]]:
    """Search images via DuckDuckGo. Returns list of {url, title, source}."""
    q = (query or "").strip()
    if not q:
        return []
    try:
        with httpx.Client(timeout=25.0, trust_env=False) as client:
            home = client.get("https://duckduckgo.com/", params={"q": q}, headers=_DDG_HEADERS)
            home.raise_for_status()
            vqd_match = re.search(r'vqd=["\']([^"\']+)["\']', home.text)
            vqd = vqd_match.group(1) if vqd_match else ""
            if not vqd:
                vqd_match = re.search(r'vqd=([^&\s]+)', home.text)
                vqd = vqd_match.group(1) if vqd_match else ""
            if not vqd:
                logger.warning("[figma_search_images] Could not extract DDG vqd token")
                return []

            resp = client.get(
                "https://duckduckgo.com/i.js",
                params={"q": q, "vqd": vqd, "o": "json", "f": ",,,,", "p": "1"},
                headers={**_DDG_HEADERS, "Referer": "https://duckduckgo.com/", "X-Requested-With": "XMLHttpRequest"},
            )
            resp.raise_for_status()
            data = resp.json()
            items: List[Dict[str, Any]] = []
            for r in data.get("results", [])[:max_results]:
                url = r.get("image") or r.get("image_url") or r.get("thumbnail")
                if url:
                    items.append({"url": url, "title": r.get("title", ""), "source": r.get("url", "")})
            return items
    except Exception as exc:
        logger.warning("[figma_search_images] search failed: %s", exc)
        return []


def _download_image_bytes(url: str) -> bytes:
    """Download an image URL and return raw bytes."""
    try:
        with httpx.Client(timeout=60.0, trust_env=False, follow_redirects=True) as client:
            resp = client.get(url, headers={"User-Agent": _DDG_HEADERS["User-Agent"]})
            resp.raise_for_status()
            content_type = resp.headers.get("content-type", "")
            if not content_type.startswith("image/"):
                # Some hosts return generic binary; still try if extension looks like image
                lower_url = url.lower()
                if not any(lower_url.endswith(ext) for ext in [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"]):
                    logger.warning("[figma_fill_image] URL does not appear to be an image: %s (%s)", url, content_type)
                    return b""
            return resp.content
    except Exception as exc:
        logger.warning("[figma_fill_image] download failed: %s", exc)
        return b""


# Re-export for creative_desktop_tools compatibility
__all__ = ["FIGMA_PLUGIN_TOOLS"]
