"""
Hermes Agent client tools — CLI invocation, status probes, research delegation.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List

from langchain.tools import tool

from services.hermes_runtime import (
    build_hermes_health,
    get_instances_config,
    invoke_hermes_chat,
    probe_gateway_status,
    probe_hermes_status,
    save_instances_config,
    send_hermes_message,
)
from utils.logger import setup_logger

logger = setup_logger("hermes_tools")


@tool
def check_hermes_status() -> str:
    """
    Check local Hermes Agent installation, model, and gateway status.
    Use before delegating research or messaging tasks to Hermes.
    """
    health = build_hermes_health()
    status = probe_hermes_status()
    gateway = probe_gateway_status()
    lines = [
        "Hermes Agent status:",
        f"- Installed: {'yes' if health.get('installed') else 'no'}",
        f"- CLI: {health.get('cli', 'hermes')}",
        f"- Model: {status.get('model') or '(unknown)'}",
        f"- Provider: {status.get('provider') or '(unknown)'}",
        f"- Agent state: {health.get('state')}",
        f"- Gateway: {gateway.get('state')}",
    ]
    err = health.get("runtime_state", {}).get("last_error")
    if err:
        lines.append(f"- Last error: {err[:300]}")
    return "\n".join(lines)


@tool
def send_task_to_hermes(task: str, instance_id: str = "local") -> str:
    """
    Delegate a research, planning, or analysis task to local Hermes Agent.

    Args:
        task: Natural language task description
        instance_id: Hermes instance id from storage/hermes_instances.json
    """
    logger.info("Delegating task to Hermes instance=%s", instance_id)
    try:
        result = invoke_hermes_chat(task, instance_id=instance_id)
        return f"**Hermes ({instance_id}) result:**\n\n{result}"
    except Exception as exc:
        logger.error("Hermes task failed: %s", exc)
        return f"Hermes task failed ({instance_id}): {exc}"


@tool
def send_hermes_platform_message(target: str, message: str) -> str:
    """
    Send a message via Hermes gateway to a configured platform target.

    Args:
        target: Delivery target, e.g. 'telegram', 'discord:#ops', 'telegram:-100123:thread'
        message: Message body to send
    """
    try:
        result = send_hermes_message(target, message)
        return f"Sent via Hermes to {target}: {result}"
    except Exception as exc:
        return f"Hermes send failed: {exc}"


def hermes_research_artifact(query: str, *, max_preview_chars: int = 4000) -> Dict[str, Any]:
    """Run Hermes research and normalize to research artifact shape."""
    prompt = (
        f"Research the following topic for a media content pipeline. "
        f"Return a concise markdown summary with key facts, trends, and angles.\n\n"
        f"Topic: {query}"
    )
    raw = invoke_hermes_chat(prompt)
    preview = raw[:max_preview_chars]
    return {
        "id": f"hermes-{abs(hash(query)) % 10**10}",
        "query": query,
        "source": "hermes",
        "items": [{"title": "Hermes research", "snippet": preview, "url": ""}],
        "summary": preview,
        "raw": {"ok": True, "backend": "hermes", "text": raw},
    }
