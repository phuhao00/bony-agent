"""Programmer Agent workflow service — git/ssh profiling and infra management."""

from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from core.dev_environment import build_dev_environment_profile, get_git_profile, get_ssh_profile
from core.infra_components import (
    build_infra_command,
    list_components,
    probe_component,
    scan_all_components,
)
from core.programmer_command_policy import current_platform, validate_programmer_shell_command
from core.programmer_recipes import get_recipe, list_recipes
from services.approval_service import approval_service
from utils.logger import setup_logger
from utils.task_manager import task_manager
from utils.workspace_root import get_workspace_git_root

logger = setup_logger("programmer_service")


def _default_steps(recipe_id: str) -> List[Dict[str, Any]]:
    recipe = get_recipe(recipe_id)
    if not recipe:
        return []
    now = time.time()
    return [
        {"id": step.id, "kind": step.kind, "status": "pending", "result": None, "updated_at": now}
        for step in recipe.steps
    ]


def _run_command(command: str, *, cwd: Optional[str] = None, read_only: bool = False, timeout: int = 60) -> Dict[str, Any]:
    import subprocess

    policy = validate_programmer_shell_command(command, read_only=read_only)
    workdir = cwd or str(get_workspace_git_root())
    env = {**os.environ, "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8"}
    try:
        completed = subprocess.run(
            policy["argv"],
            cwd=workdir,
            capture_output=True,
            text=True,
            timeout=timeout,
            shell=False,
            env=env,
            check=False,
        )
        return {
            "success": completed.returncode == 0,
            "command": command,
            "returncode": completed.returncode,
            "stdout": (completed.stdout or "")[:16384],
            "stderr": (completed.stderr or "")[:8192],
        }
    except subprocess.TimeoutExpired:
        return {"success": False, "command": command, "error": "timeout", "timeout_seconds": timeout}


def get_environment() -> Dict[str, Any]:
    profile = build_dev_environment_profile()
    scan = scan_all_components()
    return {
        **profile,
        "infra_summary": {
            "total": scan["total"],
            "installed_count": scan["installed_count"],
            "running_count": scan["running_count"],
        },
        "components_catalog": list_components(),
    }


def get_suggestions() -> Dict[str, Any]:
    env = get_environment()
    suggestions: List[Dict[str, Any]] = []

    if env.get("git", {}).get("is_git_repo"):
        suggestions.append({
            "id": "git-inspect",
            "title": "检查 Git & SSH",
            "description": "查看分支、远程、SSH 公钥",
            "recipe_id": "git.inspect",
            "category": "git",
            "priority": 90,
            "reason": "当前工作区是 Git 仓库",
        })

    infra = env.get("infra_summary", {})
    if infra.get("installed_count", 0) > 0:
        suggestions.append({
            "id": "infra-scan",
            "title": "扫描基础设施",
            "description": f"已探测 {infra.get('installed_count')} 个已安装组件",
            "recipe_id": "infra.scan_all",
            "category": "infra",
            "priority": 85,
            "reason": "本机存在常见中间件 CLI",
        })

    for comp in scan_all_components()["components"]:
        if comp.get("installed") and not comp.get("likely_running"):
            suggestions.append({
                "id": f"start-{comp['id']}",
                "title": f"启动 {comp['name']}",
                "description": f"{comp['name']} 已安装但未检测到运行",
                "recipe_id": "infra.start",
                "params": {"component_id": comp["id"]},
                "category": "infra",
                "priority": 70,
                "reason": "组件未运行",
            })

    suggestions.sort(key=lambda s: -s.get("priority", 0))
    return {"environment": env, "suggestions": suggestions[:12]}


def start_recipe(
    recipe_id: str,
    params: Optional[Dict[str, Any]] = None,
    *,
    trace_id: Optional[str] = None,
) -> Dict[str, Any]:
    recipe = get_recipe(recipe_id)
    if not recipe:
        raise ValueError(f"Unknown recipe: {recipe_id}")

    platform = current_platform()
    if platform not in recipe.platforms:
        raise ValueError(f"Recipe {recipe_id} is not available on {platform}")

    params = dict(params or {})
    task_id = task_manager.create_task(
        "programmer_agent",
        metadata={
            "recipe_id": recipe_id,
            "params": params,
            "steps": _default_steps(recipe_id),
            "platform": platform,
            "trace_id": trace_id,
        },
    )
    task_manager.update_task(task_id, status="running", progress=5, message=f"启动：{recipe.name}")

    if recipe_id == "git.inspect":
        result = {"git": get_git_profile(), "ssh": get_ssh_profile()}
        return _complete_diagnostic(task_id, result)

    if recipe_id == "git.status":
        root = get_workspace_git_root()
        result = {
            "status": _run_command("git status --short", cwd=str(root), read_only=True),
            "branch": _run_command("git rev-parse --abbrev-ref HEAD", cwd=str(root), read_only=True),
            "log": _run_command("git log --oneline -10", cwd=str(root), read_only=True),
        }
        return _complete_diagnostic(task_id, result)

    if recipe_id == "infra.scan_all":
        return _complete_diagnostic(task_id, scan_all_components())

    if recipe_id == "infra.health_check":
        component_id = str(params.get("component_id") or "")
        if not component_id:
            raise ValueError("component_id is required")
        return _complete_diagnostic(task_id, probe_component(component_id))

    if recipe_id == "dev.lint":
        root = get_workspace_git_root()
        lint_cmd = "python3 -m ruff check ."
        result = _run_command(lint_cmd, cwd=str(root), read_only=True, timeout=120)
        if not result.get("success") and "No module named" in (result.get("stderr") or ""):
            result = _run_command("python3 -m flake8 .", cwd=str(root), read_only=True, timeout=120)
        return _complete_diagnostic(task_id, result)

    if recipe.requires_approval:
        command = _build_execute_command(recipe_id, params)
        return _request_approval(
            task_id,
            recipe=recipe,
            command=command,
            params=params,
            trace_id=trace_id,
        )

    command = _build_execute_command(recipe_id, params)
    return _execute_and_complete(task_id, recipe_id, command)


def _build_execute_command(recipe_id: str, params: Dict[str, Any]) -> str:
    component_id = str(params.get("component_id") or "")
    if recipe_id == "infra.start":
        return build_infra_command("start", component_id)
    if recipe_id == "infra.stop":
        return build_infra_command("stop", component_id)
    if recipe_id == "infra.restart":
        return build_infra_command("restart", component_id)
    if recipe_id == "dev.run_tests":
        test_path = str(params.get("path") or "tests")
        return f"pytest {test_path} -q"
    raise ValueError(f"No execute command for recipe: {recipe_id}")


def _complete_diagnostic(task_id: str, result: Dict[str, Any]) -> Dict[str, Any]:
    task_manager.update_task(
        task_id,
        status="completed",
        progress=100,
        result=result,
        message="诊断完成",
    )
    return {"success": True, "status": "completed", "task_id": task_id, "result": result}


def _request_approval(
    *,
    task_id: str,
    recipe: Any,
    command: str,
    params: Dict[str, Any],
    trace_id: Optional[str],
) -> Dict[str, Any]:
    approval = approval_service.create_request(
        capability_id=recipe.capability_id,
        proposed_action=f"Programmer Agent: {recipe.name}",
        args={"recipe_id": recipe.id, "command": command, "params": params},
        trace_id=trace_id,
        task_id=task_id,
        metadata={"source": "programmer_agent", "recipe_id": recipe.id, "command": command},
    )
    task_manager.update_task(
        task_id,
        status="waiting_approval",
        progress=30,
        message="等待审批",
        metadata={
            "last_approval_id": approval["id"],
            "pending_command": command,
            "params": params,
        },
    )
    return {
        "success": False,
        "status": "waiting_approval",
        "task_id": task_id,
        "recipe_id": recipe.id,
        "command": command,
        "approval": approval,
    }


def _execute_and_complete(task_id: str, recipe_id: str, command: str, *, timeout: int = 300) -> Dict[str, Any]:
    task_manager.update_task(task_id, status="running", progress=50, message="执行中")
    read_only = recipe_id in {"dev.lint", "git.status", "git.inspect", "infra.scan_all", "infra.health_check"}
    result = _run_command(command, read_only=read_only, timeout=timeout)
    steps = (task_manager.get_task(task_id) or {}).get("metadata", {}).get("steps") or []
    for step in steps:
        if step.get("status") == "pending":
            step["status"] = "completed" if result.get("success") else "failed"
            step["result"] = result
            step["updated_at"] = time.time()
            break
    status = "completed" if result.get("success") else "failed"
    task_manager.update_task(
        task_id,
        status=status,
        progress=100,
        result=result,
        message="执行完成" if result.get("success") else "执行失败",
        metadata={"steps": steps, "command": command},
    )
    return {"success": result.get("success"), "status": status, "task_id": task_id, "result": result}


def resume_task(task_id: str) -> Dict[str, Any]:
    task = task_manager.get_task(task_id)
    if not task:
        raise ValueError(f"Task not found: {task_id}")
    if task.get("status") != "waiting_approval":
        raise ValueError(f"Task {task_id} is not waiting for approval")

    meta = task.get("metadata") or {}
    command = meta.get("pending_command") or ""
    recipe_id = meta.get("recipe_id") or ""
    if not command:
        raise ValueError("No pending command on task")

    return _execute_and_complete(task_id, recipe_id, command)


def get_task(task_id: str) -> Optional[Dict[str, Any]]:
    return task_manager.get_task(task_id)


def list_available_recipes(category: Optional[str] = None) -> List[Dict[str, Any]]:
    return list_recipes(category=category)
