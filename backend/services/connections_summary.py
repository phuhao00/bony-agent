"""Read-only connections summary facade for settings and capabilities UI."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List

from core.platform_capabilities import list_platform_profiles
from services.hermes_runtime import build_hermes_health


PROJECT_ROOT = Path(__file__).resolve().parents[2]


def _credential_state(item: Dict[str, Any]) -> str:
    if item.get("connected"):
        return "verified"
    if item.get("has_credentials"):
        return "configured"
    status = item.get("status")
    if status in {"error", "expired"}:
        return "error"
    return "missing"


def _platform_deep_link(platform_id: str) -> str:
    return f"/platforms?platform={platform_id}"


def _load_mcp_items() -> List[Dict[str, Any]]:
    path = PROJECT_ROOT / "storage" / "mcp_servers.json"
    if not path.exists():
        return []
    try:
        import json

        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return [
            {
                "id": "mcp_config",
                "name": "MCP 配置",
                "status": "error",
                "credential_state": "error",
                "runtime_state": {"state": "error", "last_error": "配置文件无法解析"},
                "deep_link": "/settings/capabilities",
                "capabilities": ["mcp"],
            }
        ]
    servers = payload.get("servers") if isinstance(payload, dict) else payload
    if not isinstance(servers, list):
        return []
    return [
        {
            "id": f"mcp:{server.get('id') or server.get('name') or index}",
            "name": server.get("name") or server.get("id") or f"MCP {index + 1}",
            "status": "configured" if server.get("enabled", True) else "disabled",
            "credential_state": "configured",
            "runtime_state": {"state": "unknown", "last_error": ""},
            "deep_link": "/settings/capabilities",
            "capabilities": ["mcp"],
        }
        for index, server in enumerate(servers)
        if isinstance(server, dict)
    ]


def build_connections_summary(connector_manager: Any) -> Dict[str, Any]:
    platforms = connector_manager.get_all_platforms()
    profiles_by_id = {profile["id"]: profile for profile in list_platform_profiles(platforms)}

    platform_items: List[Dict[str, Any]] = []
    for item in platforms:
        platform_id = item.get("platform_id", "")
        profile = profiles_by_id.get(platform_id, {})
        status = item.get("status") or "unknown"
        platform_items.append(
            {
                "id": platform_id,
                "name": item.get("platform_name") or platform_id,
                "status": status,
                "connected": bool(item.get("connected")),
                "capabilities": [action.get("id") for action in profile.get("actions", []) if action.get("supported")],
                "deep_link": _platform_deep_link(platform_id),
                "credential_state": _credential_state(item),
                "runtime_state": {
                    "state": "connected" if item.get("connected") else status,
                    "last_error": "",
                    "last_check_time": item.get("last_check_time", 0),
                },
                "channel_count": 0,
                "home_channel": None,
                "account_info": item.get("account_info") or {},
                "supports_oauth": bool(item.get("supports_oauth")),
                "supports_real_api": bool(item.get("supports_real_api")),
                "category": profile.get("category", "platform"),
            }
        )

    hermes_health = build_hermes_health()
    local_runtime = [
        {
            "id": "hermes_agent",
            "name": "Hermes Agent",
            "status": hermes_health.get("state", "unknown"),
            "credential_state": "configured" if hermes_health.get("installed") else "missing",
            "runtime_state": hermes_health.get("runtime_state", {"state": "unknown", "last_error": ""}),
            "deep_link": "/hermes-agent",
            "capabilities": hermes_health.get("capabilities", ["cli", "gateway", "mcp_serve"]),
            "channel_count": 0,
            "home_channel": None,
            "model": hermes_health.get("model", ""),
            "gateway_state": hermes_health.get("gateway_state", "unknown"),
        },
        {
            "id": "computer_use",
            "name": "Computer Use / Playwright",
            "status": "configured" if (PROJECT_ROOT / ".browsers").exists() else "available",
            "credential_state": "configured",
            "runtime_state": {"state": "local", "last_error": ""},
            "deep_link": "/computer-use",
            "capabilities": ["browser_automation", "screen_read", "keyboard_input"],
            "channel_count": 0,
            "home_channel": None,
        },
        {
            "id": "my_computer",
            "name": "My Computer",
            "status": "available",
            "credential_state": "configured",
            "runtime_state": {"state": "local", "last_error": ""},
            "deep_link": "/settings/my-computer",
            "capabilities": ["local_files", "directory_index"],
            "channel_count": 0,
            "home_channel": None,
        },
    ]

    productivity = [
        {
            "id": "lark_cli",
            "name": "Lark CLI",
            "status": "available",
            "credential_state": "configured",
            "runtime_state": {"state": "local", "last_error": ""},
            "deep_link": "/lark-cli",
            "capabilities": ["lark_docs", "lark_im", "lark_base", "lark_calendar"],
            "channel_count": 0,
            "home_channel": None,
        },
        *[item for item in platform_items if item.get("category") in {"collaboration", "messaging", "community"}],
    ]

    return {
        "success": True,
        "sections": {
            "platforms": platform_items,
            "productivity": productivity,
            "local_runtime": local_runtime,
            "mcp": _load_mcp_items(),
        },
        "totals": {
            "platforms": len(platform_items),
            "connected_platforms": sum(1 for item in platform_items if item.get("connected")),
            "configured_credentials": sum(1 for item in platform_items if item.get("credential_state") in {"configured", "verified"}),
        },
    }
