"""Hermes Agent runtime helpers — health probes, config, CLI invocation."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any, Dict, List, Optional

from services.hermes_env_bridge import (
    build_hermes_env,
    credential_bridge_status,
    credentials_ready_for_provider,
    sync_hermes_dotenv,
)
from utils.logger import setup_logger

logger = setup_logger("hermes_runtime")

_sync_attempted = False

PROJECT_ROOT = Path(__file__).resolve().parents[2]
INSTANCES_PATH = PROJECT_ROOT / "storage" / "hermes_instances.json"
SIDECAR_SESSIONS_PATH = PROJECT_ROOT / "storage" / "hermes_sidecar_sessions.json"

HERMES_TIMEOUT = int(os.environ.get("HERMES_TIMEOUT", "180"))
HERMES_CLI = os.environ.get("HERMES_CLI", "hermes")


def _resolve_hermes_bin(instance: Optional[Dict[str, Any]] = None) -> str:
    cli = (instance or {}).get("cli") or HERMES_CLI
    resolved = shutil.which(cli)
    return resolved or cli


def get_default_instances() -> List[Dict[str, Any]]:
    return [
        {
            "id": "local",
            "name": "Local Hermes",
            "cli": "hermes",
            "profile": "default",
            "gateway_enabled": False,
            "research_backend": True,
        }
    ]


def get_instances_config() -> List[Dict[str, Any]]:
    if not INSTANCES_PATH.exists():
        return get_default_instances()
    try:
        raw = json.loads(INSTANCES_PATH.read_text(encoding="utf-8"))
        if isinstance(raw, list) and raw:
            return raw
    except Exception as exc:
        logger.error("Failed to read hermes_instances.json: %s", exc)
    return get_default_instances()


def save_instances_config(instances: List[Dict[str, Any]]) -> bool:
    try:
        INSTANCES_PATH.parent.mkdir(parents=True, exist_ok=True)
        INSTANCES_PATH.write_text(
            json.dumps(instances, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return True
    except Exception as exc:
        logger.error("Failed to save hermes_instances.json: %s", exc)
        return False


def _ensure_hermes_credentials_synced() -> None:
    global _sync_attempted
    if _sync_attempted:
        return
    _sync_attempted = True
    try:
        sync_hermes_dotenv()
    except Exception as exc:
        logger.debug("Hermes dotenv sync skipped: %s", exc)


def _run_hermes(args: List[str], *, instance: Optional[Dict[str, Any]] = None, timeout: int = 30) -> subprocess.CompletedProcess[str]:
    _ensure_hermes_credentials_synced()
    bin_path = _resolve_hermes_bin(instance)
    env = build_hermes_env()
    profile = (instance or {}).get("profile")
    if profile and profile != "default":
        env["HERMES_PROFILE"] = str(profile)
    return subprocess.run(
        [bin_path, *args],
        capture_output=True,
        text=True,
        timeout=timeout,
        env=env,
    )


def probe_hermes_installed(*, instance: Optional[Dict[str, Any]] = None) -> bool:
    bin_path = _resolve_hermes_bin(instance)
    return bool(shutil.which(bin_path))


def probe_hermes_status(*, instance: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Run `hermes status` and parse high-level availability."""
    if not probe_hermes_installed(instance=instance):
        return {
            "installed": False,
            "state": "missing",
            "model": "",
            "provider": "",
            "last_error": "hermes CLI not found in PATH",
            "raw_preview": "",
        }
    try:
        result = _run_hermes(["status"], instance=instance, timeout=20)
        text = (result.stdout or "") + (result.stderr or "")
        model = ""
        provider = ""
        for line in text.splitlines():
            stripped = line.strip()
            if "Model:" in stripped:
                model = stripped.split("Model:", 1)[-1].strip()
            if "Provider:" in stripped:
                provider = stripped.split("Provider:", 1)[-1].strip()
        state = "connected" if result.returncode == 0 else "error"
        return {
            "installed": True,
            "state": state,
            "model": model,
            "provider": provider,
            "last_error": "" if result.returncode == 0 else (result.stderr or result.stdout or "status failed")[:500],
            "raw_preview": text[:1200],
        }
    except subprocess.TimeoutExpired:
        return {
            "installed": True,
            "state": "error",
            "model": "",
            "provider": "",
            "last_error": "hermes status timed out",
            "raw_preview": "",
        }
    except Exception as exc:
        return {
            "installed": True,
            "state": "error",
            "model": "",
            "provider": "",
            "last_error": str(exc),
            "raw_preview": "",
        }


def probe_gateway_status(*, instance: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Run `hermes gateway status` — connected | stopped | error."""
    if not probe_hermes_installed(instance=instance):
        return {"state": "missing", "last_error": "hermes CLI not found", "raw_preview": ""}
    try:
        result = _run_hermes(["gateway", "status"], instance=instance, timeout=15)
        text = ((result.stdout or "") + (result.stderr or "")).lower()
        if result.returncode != 0:
            return {
                "state": "error",
                "last_error": (result.stderr or result.stdout or "gateway status failed")[:500],
                "raw_preview": text[:800],
            }
        if any(k in text for k in ("running", "active", "online", "started")):
            state = "connected"
        elif any(k in text for k in ("stopped", "not running", "inactive", "offline")):
            state = "stopped"
        else:
            state = "connected" if result.returncode == 0 else "stopped"
        return {"state": state, "last_error": "", "raw_preview": text[:800]}
    except subprocess.TimeoutExpired:
        return {"state": "error", "last_error": "gateway status timed out", "raw_preview": ""}
    except Exception as exc:
        return {"state": "error", "last_error": str(exc), "raw_preview": ""}


def _availability_item(state: str, label: str, reason: str = "") -> Dict[str, str]:
    return {"state": state, "label": label, "reason": reason}


def _detect_provider_auth_issue(raw: str, provider: str) -> str:
    """Return human-readable auth/config issue for the active provider, or empty if ok."""
    if not provider.strip():
        return "未配置模型提供商"
    provider_lower = provider.lower()
    provider_tokens = [t for t in provider_lower.replace("-", " ").split() if len(t) > 2]
    for line in raw.splitlines():
        line_lower = line.lower()
        if "✗" not in line and "not logged in" not in line_lower and "not set" not in line_lower:
            continue
        if provider_tokens and not any(tok in line_lower for tok in provider_tokens):
            continue
        cleaned = line.strip().lstrip("◆").strip()
        if "not logged in" in line_lower:
            return f"{provider} 未登录"
        if "not set" in line_lower:
            return f"{provider} API Key 未配置"
        return cleaned[:200]
    return ""


def infer_hermes_availability(
    status: Dict[str, Any],
    gateway: Dict[str, Any],
) -> Dict[str, Any]:
    """Structured install / cli / gateway / chat availability for UI."""
    raw = status.get("raw_preview") or ""
    provider = (status.get("provider") or "").strip()
    installed = bool(status.get("installed"))
    cli_state = str(status.get("state") or "unknown")

    if not installed:
        install = _availability_item("missing", "未安装")
        cli = _availability_item("missing", "不可用", "CLI 未安装")
        gw = _availability_item("missing", "—")
        chat = _availability_item("missing", "不可用", "CLI 未安装")
    else:
        install = _availability_item("ready", "已安装")
        if cli_state == "connected":
            cli = _availability_item("ready", "可用")
        elif cli_state == "error":
            cli = _availability_item("error", "异常", status.get("last_error") or "")
        else:
            cli = _availability_item("unavailable", "不可用")

        gw_state = str(gateway.get("state") or "unknown")
        if gw_state == "connected":
            gw = _availability_item("ready", "运行中")
        elif gw_state == "stopped":
            gw = _availability_item("stopped", "未启动")
        elif gw_state == "error":
            gw = _availability_item("error", "异常", gateway.get("last_error") or "")
        else:
            gw = _availability_item("stopped", "未启动")

        if cli_state != "connected":
            chat = _availability_item("unavailable", "不可用", status.get("last_error") or "CLI 不可用")
        else:
            auth_issue = _detect_provider_auth_issue(raw, provider)
            if auth_issue and credentials_ready_for_provider(provider):
                auth_issue = ""
            if auth_issue:
                chat = _availability_item("unconfigured", "待配置", auth_issue)
            else:
                chat = _availability_item("ready", "可用")

    states = [install["state"], cli["state"], gw["state"], chat["state"]]
    if "missing" in states or "error" in states or chat["state"] in {"unavailable", "unconfigured"}:
        if chat["state"] == "ready" and gw["state"] == "ready":
            summary = _availability_item("partial", "部分可用")
        elif chat["state"] == "ready":
            summary = _availability_item("partial", "部分可用")
        else:
            summary = _availability_item("unavailable", "不可用", chat.get("reason") or cli.get("reason") or "")
    elif gw["state"] != "ready":
        summary = _availability_item("partial", "部分可用", "Gateway 未启动")
    else:
        summary = _availability_item("ready", "可用")

    return {
        "summary": summary,
        "install": install,
        "cli": cli,
        "gateway": gw,
        "chat": chat,
    }


def build_hermes_health(*, instance: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    _ensure_hermes_credentials_synced()
    inst = instance or (get_instances_config()[0] if get_instances_config() else {})
    status = probe_hermes_status(instance=inst)
    gateway = probe_gateway_status(instance=inst)
    availability = infer_hermes_availability(status, gateway)
    overall = availability["summary"]["state"]
    bridge = credential_bridge_status()
    return {
        "id": inst.get("id", "local"),
        "name": inst.get("name", "Hermes Agent"),
        "installed": status.get("installed", False),
        "state": overall if overall != "ready" else ("connected" if status.get("state") == "connected" else overall),
        "cli": _resolve_hermes_bin(inst),
        "model": status.get("model", ""),
        "provider": status.get("provider", ""),
        "gateway_state": gateway.get("state", "unknown"),
        "availability": availability,
        "runtime_state": {
            "state": overall,
            "gateway_state": gateway.get("state", "unknown"),
            "last_error": status.get("last_error") or gateway.get("last_error") or availability["chat"].get("reason") or "",
        },
        "deep_link": "/hermes-agent",
        "capabilities": ["cli", "gateway", "mcp_serve", "skills", "memory"],
        "credential_bridge": bridge,
    }


def invoke_hermes_chat(
    task: str,
    *,
    instance_id: str = "local",
    profile: Optional[str] = None,
    timeout: Optional[int] = None,
) -> str:
    """Non-interactive Hermes chat via CLI."""
    instances = get_instances_config()
    instance = next((i for i in instances if i.get("id") == instance_id), instances[0] if instances else {})
    if profile:
        instance = {**instance, "profile": profile}
    if not probe_hermes_installed(instance=instance):
        raise RuntimeError("hermes CLI not found in PATH")

    args = ["chat", "-q", task, "--cli", "--quiet"]
    result = _run_hermes(args, instance=instance, timeout=timeout or HERMES_TIMEOUT)
    if result.returncode != 0:
        err = (result.stderr or result.stdout or "hermes chat failed").strip()
        raise RuntimeError(err[:2000])
    return (result.stdout or "").strip() or "Hermes completed with no output."


def send_hermes_message(target: str, message: str, *, instance: Optional[Dict[str, Any]] = None) -> str:
    """Send outbound message via `hermes send`."""
    if not probe_hermes_installed(instance=instance):
        raise RuntimeError("hermes CLI not found")
    args = ["send", "-t", target, message]
    result = _run_hermes(args, instance=instance, timeout=30)
    if result.returncode != 0:
        raise RuntimeError((result.stderr or result.stdout or "hermes send failed").strip()[:1000])
    return (result.stdout or "Message sent.").strip()


def get_research_backend() -> str:
    """Return research backend preference: builtin | hermes | openclaw | auto."""
    instances = get_instances_config()
    inst = instances[0] if instances else {}
    pref = str(inst.get("research_backend", "auto")).lower()
    if pref is True:
        return "hermes"
    if pref is False:
        return "builtin"
    if pref in {"hermes", "openclaw", "builtin", "auto"}:
        return pref
    return "auto"


def resolve_research_backend(explicit: Optional[str] = None) -> str:
    if explicit and explicit.lower() in {"hermes", "openclaw", "builtin"}:
        return explicit.lower()
    pref = get_research_backend()
    if pref != "auto":
        return pref
    if probe_hermes_installed() and probe_hermes_status().get("state") == "connected":
        return "hermes"
    return "builtin"
