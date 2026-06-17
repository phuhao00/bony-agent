"""
MCP (Model Context Protocol) HTTP Client
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Supports MCP-over-HTTP (Streamable HTTP transport, spec 2024-11-05).
Falls back gracefully on SSE responses or connection errors.
"""

from __future__ import annotations

import asyncio
import json
import time
import uuid
from typing import Any, Dict, List, Optional

import httpx

from utils.logger import setup_logger

logger = setup_logger("mcp_client")

PROTOCOL_VERSION = "2024-11-05"
CLIENT_INFO = {"name": "ai-media-agent", "version": "1.0.0"}
CONNECT_TIMEOUT = 8.0
CALL_TIMEOUT = 55.0


def _redact_endpoint(url: str, max_len: int = 88) -> str:
    """Log-friendly URL truncation (still shows host/path prefix)."""
    u = (url or "").strip()
    return u[:max_len] + ("…" if len(u) > max_len else "")


def _arg_shape_for_log(tool_name: str, args: dict) -> str:
    if tool_name == "search":
        q = args.get("query")
        qlen = len(q) if isinstance(q, str) else 0
        return (
            f"query_len={qlen}"
            f" max_results={args.get('max_results')}"
            f" region={args.get('region')!r}"
        )
    if tool_name == "fetch_content":
        u = args.get("url")
        ulen = len(u) if isinstance(u, str) else 0
        return f"url_len={ulen}"
    keys = ",".join(sorted(str(k) for k in list(args.keys())[:24]))
    return f"keys=[{keys}]"


# ─── JSON-RPC helpers ────────────────────────────────────────────────────────

def _req(method: str, params: Any = None, req_id: Any = 1) -> dict:
    msg: Dict[str, Any] = {"jsonrpc": "2.0", "method": method, "id": req_id}
    if params is not None:
        msg["params"] = params
    return msg


def _extract_data(resp: httpx.Response) -> Any:
    """Parse JSON from a direct JSON or SSE response."""
    ct = resp.headers.get("content-type", "")
    if "text/event-stream" in ct:
        for line in resp.text.splitlines():
            if line.startswith("data:"):
                payload = line[5:].strip()
                if payload and payload != "[DONE]":
                    try:
                        return json.loads(payload)
                    except json.JSONDecodeError:
                        pass
        return {}
    try:
        return resp.json()
    except Exception:
        return {}


# ─── Sync helpers (called via asyncio.to_thread) ────────────────────────────

def _post_sync(url: str, body: dict, session_id: str = "", timeout: float = CONNECT_TIMEOUT) -> tuple[httpx.Response, dict]:
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
    }
    if session_id:
        headers["Mcp-Session-Id"] = session_id
    with httpx.Client(timeout=timeout, trust_env=False) as client:
        resp = client.post(url, json=body, headers=headers)
    return resp, _extract_data(resp)


def ping_server_sync(url: str) -> Dict[str, Any]:
    """
    Probe an MCP server: send `initialize`, return connection info.
    Stores status back into mcp_servers.json via caller.
    """
    try:
        resp, data = _post_sync(url, _req("initialize", {
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": CLIENT_INFO,
        }), timeout=CONNECT_TIMEOUT)

        if isinstance(data, dict) and "result" in data:
            result = data["result"]
            session_id = resp.headers.get("Mcp-Session-Id", "")
            return {
                "success": True,
                "protocol_version": result.get("protocolVersion", ""),
                "server_name": result.get("serverInfo", {}).get("name", ""),
                "server_version": result.get("serverInfo", {}).get("version", ""),
                "session_id": session_id,
                "capabilities": result.get("capabilities", {}),
            }

        if isinstance(data, dict) and "error" in data:
            return {"success": False, "error": data["error"].get("message", str(data["error"]))}

        # Some servers just respond 200 OK without JSON-RPC wrapper (health check)
        if resp.status_code < 400:
            return {"success": True, "protocol_version": "", "server_name": "", "session_id": ""}

        return {"success": False, "error": f"HTTP {resp.status_code}"}

    except httpx.ConnectError as e:
        return {"success": False, "error": f"Connection refused: {e}"}
    except httpx.TimeoutException:
        return {"success": False, "error": "Connection timed out"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def list_tools_sync(url: str, session_id: str = "") -> Dict[str, Any]:
    """Fetch the tool catalogue from an MCP server."""
    try:
        # Some servers require init before tools/list; try both
        if not session_id:
            try:
                init_resp, init_data = _post_sync(url, _req("initialize", {
                    "protocolVersion": PROTOCOL_VERSION,
                    "capabilities": {},
                    "clientInfo": CLIENT_INFO,
                }), timeout=CONNECT_TIMEOUT)
                session_id = init_resp.headers.get("Mcp-Session-Id", "")
            except Exception:
                pass

        _resp, data = _post_sync(url, _req("tools/list", {}, req_id=2), session_id=session_id)

        if isinstance(data, dict) and "result" in data:
            tools = data["result"].get("tools", [])
            logger.info(
                "[MCP] tools/list OK endpoint=%s count=%s session=%s",
                _redact_endpoint(url),
                len(tools),
                "yes" if session_id else "no",
            )
            return {"success": True, "tools": tools, "count": len(tools)}

        if isinstance(data, dict) and "error" in data:
            err = data["error"].get("message", str(data["error"]))
            logger.warning(
                "[MCP] tools/list JSON-RPC error endpoint=%s msg=%s",
                _redact_endpoint(url),
                err[:320],
            )
            return {"success": False, "tools": [], "error": err}

        logger.warning(
            "[MCP] tools/list unexpected endpoint=%s body_preview=%s",
            _redact_endpoint(url),
            str(data)[:280],
        )
        return {"success": False, "tools": [], "error": f"Unexpected response: {str(data)[:200]}"}

    except Exception as e:
        logger.warning(
            "[MCP] tools/list exception endpoint=%s err=%s",
            _redact_endpoint(url),
            e,
            exc_info=True,
        )
        return {"success": False, "tools": [], "error": str(e)}


def call_tool_sync(url: str, tool_name: str, args: dict, session_id: str = "") -> Dict[str, Any]:
    """Invoke a tool on a remote MCP server."""
    t0 = time.perf_counter()
    shape = _arg_shape_for_log(tool_name, args)
    try:
        resp, data = _post_sync(
            url,
            _req(
                "tools/call",
                {
                    "name": tool_name,
                    "arguments": args,
                },
                req_id=str(uuid.uuid4()),
            ),
            session_id=session_id,
            timeout=CALL_TIMEOUT,
        )
        elapsed_ms = (time.perf_counter() - t0) * 1000

        if isinstance(data, dict) and "result" in data:
            r = data["result"]
            content = r.get("content", [])
            if content:
                text = "\n".join(
                    c.get("text", str(c)) for c in content if isinstance(c, dict)
                )
                logger.info(
                    "[MCP] tools/call OK endpoint=%s tool=%s session=%s http_status=%s out_len=%d elapsed_ms=%.0f (%s)",
                    _redact_endpoint(url),
                    tool_name,
                    "yes" if session_id else "no",
                    resp.status_code,
                    len(text),
                    elapsed_ms,
                    shape,
                )
                return {"success": True, "result": text, "raw": r}
            logger.info(
                "[MCP] tools/call OK empty_content endpoint=%s tool=%s http_status=%s elapsed_ms=%.0f (%s)",
                _redact_endpoint(url),
                tool_name,
                resp.status_code,
                elapsed_ms,
                shape,
            )
            return {"success": True, "result": str(r), "raw": r}

        if isinstance(data, dict) and "error" in data:
            err = data["error"].get("message", str(data["error"]))
            logger.warning(
                "[MCP] tools/call RPC error endpoint=%s tool=%s http_status=%s elapsed_ms=%.0f (%s) msg=%s",
                _redact_endpoint(url),
                tool_name,
                resp.status_code,
                elapsed_ms,
                shape,
                err[:400],
            )
            return {"success": False, "error": err}

        logger.warning(
            "[MCP] tools/call unexpected endpoint=%s tool=%s http_status=%s elapsed_ms=%.0f preview=%s",
            _redact_endpoint(url),
            tool_name,
            resp.status_code,
            elapsed_ms,
            str(data)[:320],
        )
        return {"success": False, "error": f"Unexpected: {str(data)[:200]}"}
    except Exception as e:
        elapsed_ms = (time.perf_counter() - t0) * 1000
        logger.warning(
            "[MCP] tools/call exception endpoint=%s tool=%s elapsed_ms=%.0f (%s) err=%s",
            _redact_endpoint(url),
            tool_name,
            elapsed_ms,
            shape,
            e,
            exc_info=True,
        )
        return {"success": False, "error": str(e)}


def _session_header_from_response(resp: httpx.Response) -> str:
    return (
        resp.headers.get("Mcp-Session-Id")
        or resp.headers.get("mcp-session-id")
        or ""
    )


def invoke_mcp_tool_sync(url: str, tool_name: str, arguments: dict) -> Dict[str, Any]:
    """initialize + tools/call (Streamable HTTP session id when present)."""
    invoke_t0 = time.perf_counter()
    shape = _arg_shape_for_log(tool_name, arguments)
    try:
        init_resp, init_data = _post_sync(
            url,
            _req(
                "initialize",
                {
                    "protocolVersion": PROTOCOL_VERSION,
                    "capabilities": {},
                    "clientInfo": CLIENT_INFO,
                },
            ),
            timeout=CONNECT_TIMEOUT,
        )
        session_id = ""
        if isinstance(init_data, dict) and "result" in init_data:
            session_id = _session_header_from_response(init_resp)
            logger.info(
                "[MCP] invoke_chain init_ok endpoint=%s tool=%s http_status=%s session_header=%s (%s)",
                _redact_endpoint(url),
                tool_name,
                init_resp.status_code,
                "present" if session_id else "absent",
                shape,
            )
        elif isinstance(init_data, dict) and "error" in init_data:
            msg = init_data["error"].get("message", str(init_data["error"]))
            logger.warning(
                "[MCP] invoke_chain init_RPC_error endpoint=%s tool=%s http_status=%s msg=%s (%s)",
                _redact_endpoint(url),
                tool_name,
                init_resp.status_code,
                msg[:400],
                shape,
            )
            return {"success": False, "error": msg}
        elif init_resp.status_code >= 400:
            logger.warning(
                "[MCP] invoke_chain init_http_fail endpoint=%s tool=%s http_status=%s (%s)",
                _redact_endpoint(url),
                tool_name,
                init_resp.status_code,
                shape,
            )
            return {"success": False, "error": f"MCP initialize failed: HTTP {init_resp.status_code}"}
        else:
            preview = ""
            try:
                preview = json.dumps(init_data, ensure_ascii=False)[:260]
            except Exception:
                preview = str(init_data)[:260]
            logger.warning(
                "[MCP] invoke_chain init_nonstandard_endpoint=%s tool=%s http_status=%s preview=%s (%s)",
                _redact_endpoint(url),
                tool_name,
                init_resp.status_code,
                preview,
                shape,
            )

        out = call_tool_sync(url, tool_name, arguments, session_id=session_id)
        total_ms = (time.perf_counter() - invoke_t0) * 1000
        if isinstance(out, dict) and out.get("success") is False:
            logger.warning(
                "[MCP] invoke_chain done FAIL endpoint=%s tool=%s total_ms=%.0f err=%s",
                _redact_endpoint(url),
                tool_name,
                total_ms,
                str(out.get("error", ""))[:400],
            )
        else:
            rlen = len(str((out or {}).get("result", "")))
            logger.info(
                "[MCP] invoke_chain done OK endpoint=%s tool=%s total_ms=%.0f result_len=%s",
                _redact_endpoint(url),
                tool_name,
                total_ms,
                rlen,
            )
        return out
    except httpx.ConnectError as e:
        logger.warning(
            "[MCP] invoke_chain ConnectError endpoint=%s tool=%s err=%s",
            _redact_endpoint(url),
            tool_name,
            e,
            exc_info=True,
        )
        return {"success": False, "error": f"Connection refused: {e}"}
    except httpx.TimeoutException:
        logger.warning(
            "[MCP] invoke_chain Timeout endpoint=%s tool=%s",
            _redact_endpoint(url),
            tool_name,
        )
        return {"success": False, "error": "Connection timed out"}
    except Exception as e:
        logger.warning(
            "[MCP] invoke_chain exception endpoint=%s tool=%s err=%s",
            _redact_endpoint(url),
            tool_name,
            e,
            exc_info=True,
        )
        return {"success": False, "error": str(e)}


# ─── LangChain adapter ───────────────────────────────────────────────────────

def get_mcp_langchain_tools(url: str, server_id: str = "mcp") -> list:
    """
    Create LangChain StructuredTool instances for every tool exposed by the MCP server.
    Returns an empty list if the server is unreachable or has no tools.
    """
    try:
        from langchain.tools import StructuredTool
        from pydantic import BaseModel, create_model
        from typing import Any as TypingAny

        result = list_tools_sync(url)
        if not result.get("success") or not result.get("tools"):
            logger.warning(f"[MCP] No tools from {url}: {result.get('error', 'empty')}")
            return []

        lc_tools = []
        for t in result["tools"]:
            tool_name: str = t.get("name", "tool")
            tool_desc: str = t.get("description", "")
            schema: dict = t.get("inputSchema") or {}

            # Build pydantic model from JSON schema
            py_type_map = {
                "string": str, "integer": int, "number": float,
                "boolean": bool, "object": dict, "array": list,
            }
            fields: dict = {}
            props: dict = schema.get("properties", {})
            required: list = schema.get("required", [])
            for prop, pschema in props.items():
                pt = py_type_map.get(pschema.get("type", "string"), TypingAny)
                desc_field = pschema.get("description", "")
                from pydantic import Field
                if prop in required:
                    fields[prop] = (pt, Field(..., description=desc_field))
                else:
                    fields[prop] = (Optional[pt], Field(None, description=desc_field))

            if not fields:
                fields["input"] = (str, ...)

            ArgsModel: type = create_model(f"{server_id}__{tool_name}__args", **fields)

            # Capture url / tool_name in closure
            def _make_fn(t_url: str, t_name: str):
                def _fn(**kwargs):
                    r = call_tool_sync(t_url, t_name, kwargs)
                    return r["result"] if r.get("success") else f"[MCP Error] {r.get('error')}"
                _fn.__name__ = f"{server_id}__{t_name}"
                return _fn

            lc_tool = StructuredTool.from_function(
                func=_make_fn(url, tool_name),
                name=f"{server_id}__{tool_name}",
                description=f"[MCP:{server_id}] {tool_desc}",
                args_schema=ArgsModel,
            )
            lc_tools.append(lc_tool)
            logger.info(f"[MCP] Loaded tool: {server_id}__{tool_name}")

        return lc_tools

    except Exception as e:
        logger.error(f"[MCP] Failed to build LangChain tools from {url}: {e}", exc_info=True)
        return []


# ─── Public async wrappers ────────────────────────────────────────────────────

async def ping_server(url: str) -> Dict[str, Any]:
    return await asyncio.to_thread(ping_server_sync, url)


async def list_tools(url: str, session_id: str = "") -> Dict[str, Any]:
    return await asyncio.to_thread(list_tools_sync, url, session_id)


# ─── Registry helper (used by agents) ─────────────────────────────────────────

_MCP_TOOLS_CACHE: tuple[float, float, list] | None = None
_MCP_TOOLS_CACHE_TTL_SEC = 60.0


def invalidate_mcp_tools_cache() -> None:
    global _MCP_TOOLS_CACHE
    _MCP_TOOLS_CACHE = None


def get_all_enabled_mcp_tools() -> list:
    """
    Load tools from all *enabled* MCP servers stored in mcp_servers.json.
    Silently skips servers that are unreachable.
    Cached briefly to avoid reconnecting MCP on every pet chat turn.
    """
    global _MCP_TOOLS_CACHE
    from pathlib import Path
    import json as _json
    import time as _time

    config_path = Path(__file__).parent.parent.parent / "storage" / "mcp_servers.json"
    mtime = config_path.stat().st_mtime if config_path.exists() else 0.0
    now = _time.monotonic()
    if (
        _MCP_TOOLS_CACHE is not None
        and _MCP_TOOLS_CACHE[0] == mtime
        and (now - _MCP_TOOLS_CACHE[1]) < _MCP_TOOLS_CACHE_TTL_SEC
    ):
        return list(_MCP_TOOLS_CACHE[2])

    if not config_path.exists():
        _MCP_TOOLS_CACHE = (mtime, now, [])
        return []
    try:
        servers = _json.loads(config_path.read_text()).get("servers", [])
    except Exception:
        _MCP_TOOLS_CACHE = (mtime, now, [])
        return []

    all_tools: list = []
    for s in servers:
        if not s.get("enabled", True):
            continue
        url = s.get("url", "").strip()
        sid = s.get("id", "mcp")
        if not url:
            continue
        try:
            tools = get_mcp_langchain_tools(url, sid)
            all_tools.extend(tools)
            logger.info(f"[MCP] {sid}: loaded {len(tools)} tools")
        except Exception as e:
            logger.warning(f"[MCP] {sid}: skipped ({e})")

    _MCP_TOOLS_CACHE = (mtime, now, all_tools)
    return list(all_tools)
