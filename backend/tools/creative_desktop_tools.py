"""LangChain tools for Creative Desktop Agent — auto-execute variant."""

from __future__ import annotations

import json
from typing import Optional

from langchain.tools import tool

from services import desktop_operator_service
from tools.figma_api_tools import FIGMA_API_TOOLS
from tools.figma_plugin_tools import FIGMA_PLUGIN_TOOLS
from utils.logger import setup_logger

logger = setup_logger("creative_desktop_tools")


@tool
def list_desktop_apps(limit: int = 50) -> str:
    """List installed and catalog desktop applications with automation hints."""
    apps = desktop_operator_service.search_apps("", limit=limit)
    return json.dumps(apps, ensure_ascii=False, indent=2)


@tool
def search_desktop_apps_tool(query: str, limit: int = 20) -> str:
    """Search desktop applications by name or id."""
    apps = desktop_operator_service.search_apps(query, limit=limit)
    return json.dumps(apps, ensure_ascii=False, indent=2)


@tool
def get_desktop_environment() -> str:
    """Get desktop operator environment: platform, allowed roots, installed creative apps, sidecar status."""
    env = desktop_operator_service.get_environment()
    return json.dumps(env, ensure_ascii=False, indent=2)


@tool
def plan_desktop_automation(
    app_id: str,
    mode: str = "",
    user_goal: str = "",
    params_json: str = "{}",
) -> str:
    """Plan automation for a desktop app. params_json may include blend_file, script_path, project_path, output_dir, etc."""
    try:
        params = json.loads(params_json) if params_json.strip() else {}
    except json.JSONDecodeError as exc:
        return json.dumps({"success": False, "error": f"Invalid params_json: {exc}"}, ensure_ascii=False)
    try:
        result = desktop_operator_service.plan_automation(
            app_id=app_id,
            mode=mode,
            user_goal=user_goal,
            blend_file=params.get("blend_file", ""),
            project_path=params.get("project_path", ""),
            uproject_file=params.get("uproject_file", ""),
            script_path=params.get("script_path", ""),
            execute_method=params.get("execute_method", ""),
            output_dir=params.get("output_dir", ""),
            extra_args=params.get("extra_args"),
        )
        return json.dumps({"success": True, **result}, ensure_ascii=False, indent=2)
    except ValueError as exc:
        return json.dumps({"success": False, "error": str(exc)}, ensure_ascii=False)


@tool
def write_automation_script(app_id: str, content: str, filename: str = "script.py") -> str:
    """Write automation script (bpy/jsx/etc.) to storage/temp/automation sandbox."""
    try:
        result = desktop_operator_service.write_automation_script(app_id, content, filename)
        return json.dumps(result, ensure_ascii=False, indent=2)
    except ValueError as exc:
        return json.dumps({"success": False, "error": str(exc)}, ensure_ascii=False)


@tool
def run_desktop_automation(plan_json: str, working_dir: str) -> str:
    """Execute CLI automation plan immediately. working_dir must be under My Computer roots."""
    try:
        plan = json.loads(plan_json)
    except json.JSONDecodeError as exc:
        return json.dumps({"success": False, "error": f"Invalid plan_json: {exc}"}, ensure_ascii=False)
    try:
        result = desktop_operator_service.submit_cli_execution(
            plan,
            working_dir,
            trace_id=None,
        )
        return json.dumps(result, ensure_ascii=False, indent=2)
    except ValueError as exc:
        return json.dumps({"success": False, "error": str(exc)}, ensure_ascii=False)


@tool
def launch_desktop_app(app_id: str, url: str = "") -> str:
    """Launch a desktop application by id or name. Auto-executes without approval.

    Args:
        app_id: Application id or display name (e.g. "Figma", "Blender").
        url: Optional URL or file path to open with the app (e.g. a Figma file URL).
    """
    try:
        result = desktop_operator_service.launch_application(app_id, url=url or None)
        return json.dumps(result, ensure_ascii=False, indent=2)
    except ValueError as exc:
        return json.dumps({"success": False, "error": str(exc)}, ensure_ascii=False)


@tool
def run_native_desktop_task(goal: str, app_hint: str = "") -> str:
    """Run native GUI automation (screenshot + click/type loop) for apps without CLI. Auto-executes."""
    try:
        from services.native_use_service import start_native_use_task

        result = start_native_use_task(goal=goal, app_hint=app_hint, require_approval=False)
        return json.dumps(result, ensure_ascii=False, indent=2)
    except Exception as exc:
        return json.dumps({"success": False, "error": str(exc)}, ensure_ascii=False)


@tool
def get_os_script_template_tool(template_id: str) -> str:
    """Get a validated AppleScript/PowerShell template by id (e.g. photoshop.activate)."""
    try:
        from core.os_script_policy import get_os_script_template

        tpl = get_os_script_template(template_id)
        return json.dumps(tpl, ensure_ascii=False, indent=2)
    except ValueError as exc:
        return json.dumps({"success": False, "error": str(exc)}, ensure_ascii=False)


CREATIVE_DESKTOP_TOOLS = [
    list_desktop_apps,
    search_desktop_apps_tool,
    get_desktop_environment,
    plan_desktop_automation,
    write_automation_script,
    run_desktop_automation,
    launch_desktop_app,
    run_native_desktop_task,
    get_os_script_template_tool,
    *FIGMA_API_TOOLS,
    *FIGMA_PLUGIN_TOOLS,
]
