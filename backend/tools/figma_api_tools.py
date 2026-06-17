"""Figma REST API / URL tools for Creative Desktop Agent.

Provides reliable inspection (read file, comments) and URL helpers. Note that
Figma's REST API is read-only for files; file creation is done through the
desktop app / web UI or the Figma Plugin API. The tools here support the
automation flow by verifying tokens, reading metadata, and opening new-file URLs.
"""

from __future__ import annotations

import json
import os
import urllib.request
from typing import Any, Dict, List, Optional

from langchain.tools import tool
from utils.logger import setup_logger

logger = setup_logger("figma_api_tools")

_BASE_URL = "https://api.figma.com/v1"


def _get_token() -> str:
    token = os.getenv("FIGMA_ACCESS_TOKEN", "").strip()
    if not token:
        raise RuntimeError(
            "未配置 FIGMA_ACCESS_TOKEN 环境变量。"
            "请在 .env 或系统环境中设置 Figma Personal Access Token。"
        )
    return token


def _request(method: str, path: str, body: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    token = _get_token()
    url = f"{_BASE_URL}{path}"
    headers = {
        "X-Figma-Token": token,
        "Accept": "application/json",
    }
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"

    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8")
            if not raw:
                return {"success": True}
            return json.loads(raw)
    except urllib.error.HTTPError as exc:
        err_body = exc.read().decode("utf-8", errors="ignore")
        logger.error("Figma API HTTP error %s %s: %s", method, path, err_body)
        try:
            detail = json.loads(err_body)
        except Exception:
            detail = {"message": err_body or str(exc)}
        return {
            "success": False,
            "error": detail.get("message") or detail.get("err") or str(exc),
            "status": exc.code,
            "detail": detail,
        }
    except Exception as exc:
        logger.error("Figma API error %s %s: %s", method, path, exc)
        return {"success": False, "error": str(exc)}


@tool
def figma_verify_token() -> str:
    """Verify the configured Figma access token and return the authenticated user."""
    result = _request("GET", "/me")
    return json.dumps(result, ensure_ascii=False, indent=2)


@tool
def figma_get_file(file_key: str) -> str:
    """Get metadata for an existing Figma file."""
    file_key = (file_key or "").strip()
    if not file_key:
        return json.dumps({"success": False, "error": "file_key is required"}, ensure_ascii=False)
    result = _request("GET", f"/files/{file_key}")
    return json.dumps(result, ensure_ascii=False, indent=2)


@tool
def figma_get_file_nodes(file_key: str, node_ids: List[str]) -> str:
    """Get specific nodes from a Figma file."""
    file_key = (file_key or "").strip()
    if not file_key:
        return json.dumps({"success": False, "error": "file_key is required"}, ensure_ascii=False)
    ids = ",".join(node_ids) if node_ids else ""
    result = _request("GET", f"/files/{file_key}/nodes?ids={ids}")
    return json.dumps(result, ensure_ascii=False, indent=2)


@tool
def figma_create_comment(file_key: str, message: str, x: float = 0, y: float = 0) -> str:
    """Create a comment on a Figma file (useful for leaving design notes)."""
    file_key = (file_key or "").strip()
    if not file_key:
        return json.dumps({"success": False, "error": "file_key is required"}, ensure_ascii=False)
    body = {
        "message": message,
        "client_meta": {"x": float(x), "y": float(y)},
    }
    result = _request("POST", f"/files/{file_key}/comments", body=body)
    return json.dumps(result, ensure_ascii=False, indent=2)


@tool
def figma_open_new_file_url(editor_type: str = "design") -> str:
    """Return a URL that opens a new blank Figma file in the browser/desktop app.

    Note: This only opens the new-file page; actual content creation must be done
    via native desktop automation or by the user.
    """
    editor_type = (editor_type or "design").strip().lower()
    if editor_type == "figjam":
        url = "https://www.figma.com/board/new"
    else:
        url = "https://www.figma.com/design/new"
    return json.dumps(
        {
            "success": True,
            "url": url,
            "desktop_deep_link": f"figma://{editor_type}/new",
            "message": f"在浏览器或 Figma 桌面端打开新 {editor_type} 文件",
        },
        ensure_ascii=False,
        indent=2,
    )


FIGMA_API_TOOLS = [
    figma_verify_token,
    figma_get_file,
    figma_get_file_nodes,
    figma_create_comment,
    figma_open_new_file_url,
]
