"""Desktop operator orchestration service."""

from __future__ import annotations

import hashlib
import json
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from core.app_automation_strategy import resolve_strategy
from core.app_command_policy import probe_app_executables
from core.creative_software import plan_app_automation, probe_creative_apps
from core.desktop_app_registry import list_desktop_apps, search_desktop_apps
from core.local_computer import local_computer_service
from core.system_command_policy import current_platform
from utils.logger import setup_logger

logger = setup_logger("desktop_operator")

PROJECT_ROOT = Path(__file__).resolve().parents[2]
AUTOMATION_TEMP = PROJECT_ROOT / "storage" / "temp" / "automation"


def get_environment(*, ensure_sidecar: bool = False) -> Dict[str, Any]:
    sidecar_available = False
    sidecar_port = None
    sidecar_reason = None
    active_bridge = None
    try:
        from services.native_bridges.sidecar_client import sidecar_health
        from services import native_desktop_service

        if ensure_sidecar:
            from services.native_sidecar_manager import ensure_sidecar_running

            ensure_sidecar_running(timeout=8.0)
        health = sidecar_health()
        sidecar_available = bool(health.get("ok"))
        sidecar_port = health.get("port") if sidecar_available else None
        sidecar_reason = health.get("reason")
        if sidecar_reason == "unreachable":
            sidecar_reason = "进程不可达（可能已退出或系统代理干扰，请点击重新检测）"
        elif sidecar_reason == "no_port_file":
            sidecar_reason = "未启动（请运行 start_local.sh / start_with_tunnel.sh 或点击重新检测）"
        active_bridge = native_desktop_service.bridge_status().get("active")
    except Exception as exc:
        sidecar_reason = str(exc)

    return {
        "platform": current_platform(),
        "allowed_roots": local_computer_service.list_allowed_roots(),
        "creative_apps": probe_creative_apps(),
        "executables": probe_app_executables(),
        "sidecar_available": sidecar_available,
        "sidecar_port": sidecar_port,
        "sidecar_reason": sidecar_reason,
        "active_bridge": active_bridge,
        "desktop_apps_count": len(list_desktop_apps(limit=500)),
    }


def search_apps(query: str = "", *, limit: int = 50) -> List[Dict[str, Any]]:
    if query.strip():
        return search_desktop_apps(query, limit=limit)
    return list_desktop_apps(limit=limit)


def plan_automation(
    *,
    app_id: str,
    mode: str = "",
    user_goal: str = "",
    blend_file: str = "",
    project_path: str = "",
    uproject_file: str = "",
    script_path: str = "",
    execute_method: str = "",
    output_dir: str = "",
    extra_args: Optional[List[str]] = None,
) -> Dict[str, Any]:
    strategy = resolve_strategy(app_id, user_goal, mode=mode)
    result: Dict[str, Any] = {"strategy": strategy.to_dict()}

    if strategy.strategy == "cli_batch":
        plan = plan_app_automation(
            app_id=app_id,
            mode=mode or (strategy.suggested_modes[0] if strategy.suggested_modes else ""),
            blend_file=blend_file,
            project_path=project_path,
            uproject_file=uproject_file,
            script_path=script_path,
            execute_method=execute_method,
            output_dir=output_dir,
            extra_args=extra_args,
        )
        result["plan"] = plan
    elif strategy.strategy == "launch_only":
        result["plan"] = {
            "app_id": app_id,
            "mode": "generic_launch",
            "action": "launch_app",
            "requires_approval": True,
        }
    elif strategy.strategy == "gui_native":
        result["plan"] = {
            "app_id": app_id,
            "mode": "generic_gui",
            "action": "native_use",
            "requires_approval": True,
            "hint": "Use run_native_desktop_task for GUI automation",
        }
    elif strategy.strategy == "os_script":
        from core.os_script_policy import get_os_script_template

        template_id = f"{app_id}.activate"
        try:
            tpl = get_os_script_template(template_id)
        except ValueError:
            tpl = {"template_id": template_id, "note": "no template; provide script manually"}
        result["plan"] = {
            "app_id": app_id,
            "mode": mode or "os_script_generic",
            "action": "os_script",
            "requires_approval": True,
            "template": tpl,
        }
    return result


def write_automation_script(app_id: str, content: str, filename: str) -> Dict[str, Any]:
    app_id = (app_id or "generic").strip().lower()
    filename = (filename or "script.py").strip()
    if not content:
        raise ValueError("script content is required")
    if ".." in filename or "/" in filename or "\\" in filename:
        raise ValueError("invalid script filename")

    run_id = uuid.uuid4().hex[:12]
    dest_dir = AUTOMATION_TEMP / run_id
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest_path = dest_dir / filename
    dest_path.write_text(content, encoding="utf-8")
    digest = hashlib.sha256(content.encode("utf-8")).hexdigest()[:16]

    return {
        "success": True,
        "app_id": app_id,
        "path": str(dest_path),
        "filename": filename,
        "sha256_prefix": digest,
        "preview": content[:500],
    }


def submit_cli_execution(
    plan: Dict[str, Any],
    working_dir: str,
    *,
    trace_id: Optional[str] = None,
) -> Dict[str, Any]:
    shell = (plan.get("shell_suggestion") or "").strip()
    if not shell and plan.get("argv_template"):
        import shlex

        shell = " ".join(shlex.quote(p) for p in plan["argv_template"])

    if not shell:
        raise ValueError("plan has no executable shell command")

    capability_id = plan.get("capability_id") or "creative_app_script"
    metadata = {
        "source": "creative_apps",
        "automation_plan": plan,
        "app_id": plan.get("app_id"),
        "mode": plan.get("mode"),
    }
    if plan.get("script_path"):
        metadata["script_path"] = plan.get("script_path")

    return local_computer_service.run_action(
        action="shell_command",
        command=shell,
        working_dir=working_dir,
        trace_id=trace_id,
        metadata=metadata,
    )


def launch_application(app_id: str, *, url: Optional[str] = None, trace_id: Optional[str] = None) -> Dict[str, Any]:
    launch_name = app_id
    entry = search_desktop_apps(app_id, limit=1)
    if entry:
        launch_name = entry[0].get("name") or app_id
    return local_computer_service.run_action(
        action="launch_app",
        app_id=launch_name,
        url=url,
        trace_id=trace_id,
        metadata={"source": "creative_apps", "app_id": app_id},
    )
