"""System Assistant workflow service."""

from __future__ import annotations

import json
import os
import subprocess
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from core.app_catalog import add_custom_app, get_app, list_apps, search_apps
from core.file_media_ops import (
    FileMediaOpsError,
    apply_compress_images,
    apply_edit_images,
    create_slideshow_video,
    preview_compress_images,
    preview_dedupe_images,
    preview_edit_images,
    preview_image_organize,
    preview_images_to_video,
)
from core.local_computer import LocalComputerError, local_computer_service
from core.system_command_policy import current_platform, validate_system_shell_command
from core.system_environment import (
    build_dev_tool_install_command,
    build_environment_profile,
    build_flush_dns_command,
    build_install_command,
    build_ping_command,
    build_python_version_command,
    build_uninstall_command,
    get_server_platform,
    package_key_for_platform,
    probe_package_managers,
)
from core.system_recipes import (
    SYSTEM_RECIPES,
    get_recipe,
    list_recipes,
    resolve_install_recipe,
    resolve_uninstall_recipe,
)
from services.approval_service import approval_service
from services.system_suggestions import build_suggestions
from utils.logger import setup_logger
from utils.task_manager import task_manager

logger = setup_logger("system_assistant")

PROJECT_ROOT = Path(__file__).resolve().parents[2]
STORAGE_DIR = PROJECT_ROOT / "storage" / "system"
ORGANIZE_PLANS_DIR = STORAGE_DIR / "organize_plans"


def _default_working_dir() -> str:
    return str(Path.home())


def _run_command(command: str, *, timeout: int = 30) -> Dict[str, Any]:
    policy = validate_system_shell_command(command)
    cwd = _default_working_dir()
    env = {**os.environ, "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8"}
    try:
        completed = subprocess.run(
            policy["argv"],
            cwd=cwd,
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
            "stderr": (completed.stderr or "")[:16384],
            "timeout_seconds": timeout,
        }
    except subprocess.TimeoutExpired:
        return {"success": False, "command": command, "error": "timeout", "timeout_seconds": timeout}


def _package_name(app_id: str, platform: Optional[str] = None) -> str:
    platform = platform or get_server_platform()
    entry = get_app(app_id)
    if not entry:
        return app_id
    pkg_key = package_key_for_platform(platform)
    pkg = (entry.get("packages") or {}).get(pkg_key)
    if not pkg and platform != "win32":
        pkg = (entry.get("packages") or {}).get("win32")
    return pkg or app_id


def _install_command(app_id: str, platform: Optional[str] = None) -> str:
    platform = platform or get_server_platform()
    pkg = _package_name(app_id, platform)
    return build_install_command(pkg, platform)


def _uninstall_command(app_id: str, platform: Optional[str] = None) -> str:
    platform = platform or get_server_platform()
    pkg = _package_name(app_id, platform)
    return build_uninstall_command(pkg, platform)


def _flush_dns_command(platform: Optional[str] = None) -> str:
    return build_flush_dns_command(platform or get_server_platform())


def quick_diagnostics() -> Dict[str, Any]:
    platform = get_server_platform()
    results: Dict[str, Any] = {"platform": platform, "checks": [], "timestamp": time.time()}
    checks = [
        ("ping", build_ping_command(platform)),
        ("dns", "nslookup google.com"),
    ]
    if platform == "darwin":
        checks.append(("dns_cache", "scutil --dns"))
    for name, cmd in checks:
        try:
            results["checks"].append({"name": name, **_run_command(cmd, timeout=20)})
        except ValueError as exc:
            results["checks"].append({"name": name, "success": False, "error": str(exc)})
    dev_checks = []
    for tool_cmd in (
        "node --version",
        build_python_version_command(platform),
        "git --version",
    ):
        try:
            dev_checks.append(_run_command(tool_cmd, timeout=10))
        except ValueError:
            dev_checks.append({"command": tool_cmd, "success": False})
    results["dev_tools"] = dev_checks
    return results


def get_environment(client_platform: Optional[str] = None) -> Dict[str, Any]:
    return build_environment_profile(client_platform)


def get_suggestions(
    *,
    client_platform: Optional[str] = None,
    diagnostics: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    environment = build_environment_profile(client_platform)
    diag = diagnostics if diagnostics is not None else quick_diagnostics()
    roots: List[Dict[str, Any]] = []
    try:
        roots = local_computer_service.list_allowed_roots() or []
    except Exception:
        roots = []
    suggestions = build_suggestions(diag, environment, computer_roots=roots)
    return {
        "environment": environment,
        "diagnostics": diag,
        "suggestions": suggestions,
    }


def _default_steps(recipe_id: str) -> List[Dict[str, Any]]:
    recipe = get_recipe(recipe_id)
    if not recipe:
        return []
    now = time.time()
    return [
        {"id": step.id, "kind": step.kind, "status": "pending", "result": None, "updated_at": now}
        for step in recipe.steps
    ]


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
    if platform not in recipe.platforms and recipe.platforms != ["darwin", "win32", "linux"]:
        if platform not in recipe.platforms:
            raise ValueError(f"Recipe {recipe_id} is not available on {platform}")

    params = dict(params or {})
    task_id = task_manager.create_task(
        "system_assistant",
        metadata={
            "recipe_id": recipe_id,
            "params": params,
            "steps": _default_steps(recipe_id),
            "platform": platform,
            "trace_id": trace_id,
        },
    )
    task_manager.update_task(task_id, status="running", progress=5, message=f"启动：{recipe.name}")

    if recipe_id in {"network.diagnose", "env.check_dev_tools"}:
        return _run_diagnostic_recipe(task_id, recipe_id, params)

    if recipe_id == "organize.preview":
        return _run_organize_preview(task_id, params)

    if recipe_id == "organize.images_preview":
        return _run_image_organize_preview(task_id, params)

    if recipe_id in {
        "organize.compress_images",
        "organize.edit_images",
        "organize.images_to_video",
        "organize.dedupe_images",
    }:
        return _run_media_organize_recipe(task_id, recipe_id, recipe, params, trace_id=trace_id)

    if recipe_id == "organize.apply_batch":
        plan_id = str(params.get("plan_id") or "")
        if not plan_id:
            raise ValueError("plan_id is required")
        if recipe.requires_approval:
            return _request_system_approval(
                task_id=task_id,
                recipe=recipe,
                command=f"organize.apply_batch plan_id={plan_id}",
                params=params,
                trace_id=trace_id,
            )
        return apply_organize_plan(task_id, plan_id)

    if recipe.requires_approval:
        command = _build_execute_command(recipe_id, params)
        return _request_system_approval(
            task_id=task_id,
            recipe=recipe,
            command=command,
            params=params,
            trace_id=trace_id,
        )

    command = _build_execute_command(recipe_id, params)
    return _execute_and_complete(task_id, recipe_id, command)


def _build_execute_command(recipe_id: str, params: Dict[str, Any]) -> str:
    app_id = str(params.get("app_id") or params.get("tool") or "")
    if recipe_id in {"install.brew_cask", "install.winget"}:
        return _install_command(app_id)
    if recipe_id in {"uninstall.brew", "uninstall.winget"}:
        return _uninstall_command(app_id)
    if recipe_id == "network.flush_dns":
        return _flush_dns_command()
    if recipe_id == "env.install_dev_tool":
        tool = str(params.get("tool") or "")
        return build_dev_tool_install_command(tool)
    if recipe_id == "repair.reinstall_app":
        return _uninstall_command(app_id)
    raise ValueError(f"No execute command for recipe: {recipe_id}")


def _request_system_approval(
    *,
    task_id: str,
    recipe: Any,
    command: str,
    params: Dict[str, Any],
    trace_id: Optional[str],
) -> Dict[str, Any]:
    approval = approval_service.create_request(
        capability_id=recipe.capability_id,
        proposed_action=f"System Assistant: {recipe.name}",
        args={"recipe_id": recipe.id, "command": command, "params": params},
        trace_id=trace_id,
        task_id=task_id,
        metadata={"source": "system_assistant", "recipe_id": recipe.id, "command": command},
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
    result = _run_command(command, timeout=timeout)
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


def _run_diagnostic_recipe(task_id: str, recipe_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
    if recipe_id == "network.diagnose":
        diag = quick_diagnostics()
        task_manager.update_task(
            task_id,
            status="completed",
            progress=100,
            result=diag,
            message="网络诊断完成",
        )
        return {"success": True, "status": "completed", "task_id": task_id, "result": diag}

    dev = []
    platform = get_server_platform()
    for cmd in (
        "node --version",
        build_python_version_command(platform),
        "git --version",
    ):
        try:
            dev.append(_run_command(cmd))
        except ValueError as exc:
            dev.append({"command": cmd, "success": False, "error": str(exc)})
    result = {"dev_tools": dev, "platform": platform}
    task_manager.update_task(
        task_id,
        status="completed",
        progress=100,
        result=result,
        message="开发工具检查完成",
    )
    return {"success": True, "status": "completed", "task_id": task_id, "result": result}


def _assert_organize_root(root_path: str) -> str:
    if not root_path:
        raise ValueError("root_path is required")
    try:
        resolved = local_computer_service.run_action(action="list_dir", path=root_path)
    except LocalComputerError as exc:
        message = str(exc)
        if "No allowed local computer roots configured" in message:
            raise ValueError(
                "尚未在 My Computer 登记任何目录。请打开 设置 → My Computer 添加文件夹后再试。"
            ) from exc
        if "outside allowed local computer roots" in message:
            raise ValueError(
                f"路径不在已登记的 My Computer 目录内：{root_path}"
            ) from exc
        raise ValueError(message) from exc
    return str(resolved.get("path") or root_path)


def _run_image_organize_preview(task_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
    root_path = _assert_organize_root(str(params.get("root_path") or ""))
    mode = str(params.get("mode") or "by_format")
    recursive = bool(params.get("recursive", True))
    try:
        preview = preview_image_organize(root_path, mode=mode, recursive=recursive)
    except FileMediaOpsError as exc:
        task_manager.update_task(task_id, status="failed", error=str(exc), message=str(exc))
        return {"success": False, "status": "failed", "task_id": task_id, "error": str(exc)}

    plan_id = str(uuid.uuid4())
    ORGANIZE_PLANS_DIR.mkdir(parents=True, exist_ok=True)
    plan = {
        "id": plan_id,
        "root_path": root_path,
        "moves": preview.get("moves") or [],
        "kind": "images",
        "mode": mode,
        "created_at": time.time(),
    }
    (ORGANIZE_PLANS_DIR / f"{plan_id}.json").write_text(
        json.dumps(plan, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    result = {
        **preview,
        "plan_id": plan_id,
        "move_count": len(plan["moves"]),
        "moves": (preview.get("moves") or [])[:100],
    }
    task_manager.update_task(
        task_id,
        status="completed",
        progress=100,
        result=result,
        message=f"已生成图片整理计划（{result['move_count']} 项）",
        metadata={"plan_id": plan_id},
    )
    return {"success": True, "status": "completed", "task_id": task_id, "result": result}


def _run_media_organize_recipe(
    task_id: str,
    recipe_id: str,
    recipe: Any,
    params: Dict[str, Any],
    *,
    trace_id: Optional[str],
) -> Dict[str, Any]:
    root_path = _assert_organize_root(str(params.get("root_path") or ""))
    params = {**params, "root_path": root_path}
    try:
        if recipe_id == "organize.compress_images":
            preview = preview_compress_images(
                root_path,
                quality=int(params.get("quality") or 80),
                max_width=int(params.get("max_width") or 1920),
                output_subdir=str(params.get("output_subdir") or "Compressed"),
                recursive=bool(params.get("recursive", True)),
            )
        elif recipe_id == "organize.edit_images":
            preview = preview_edit_images(
                root_path,
                rotate=int(params.get("rotate") or 0),
                max_width=int(params.get("max_width") or 0),
                output_format=str(params.get("output_format") or ""),
                output_subdir=str(params.get("output_subdir") or "Edited"),
                recursive=bool(params.get("recursive", True)),
                auto_orient=bool(params.get("auto_orient")),
                watermark_text=str(params.get("watermark_text") or ""),
                watermark_position=str(params.get("watermark_position") or "bottom_right"),
            )
        elif recipe_id == "organize.dedupe_images":
            preview = preview_dedupe_images(
                root_path,
                output_subdir=str(params.get("output_subdir") or "Duplicates"),
                recursive=bool(params.get("recursive", True)),
            )
            plan_id = str(uuid.uuid4())
            ORGANIZE_PLANS_DIR.mkdir(parents=True, exist_ok=True)
            plan = {
                "id": plan_id,
                "root_path": root_path,
                "moves": preview.get("moves") or [],
                "kind": "dedupe",
                "created_at": time.time(),
            }
            (ORGANIZE_PLANS_DIR / f"{plan_id}.json").write_text(
                json.dumps(plan, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            preview = {**preview, "plan_id": plan_id}
        else:
            audio_path = str(params.get("audio_path") or "").strip()
            if audio_path:
                ap = Path(audio_path).expanduser()
                check_path = str(ap.parent if ap.suffix else ap)
                _assert_organize_root(check_path)
            preview = preview_images_to_video(
                root_path,
                duration_per_image=float(params.get("duration_per_image") or 3.0),
                fps=int(params.get("fps") or 30),
                width=int(params.get("width") or 1280),
                height=int(params.get("height") or 720),
                recursive=bool(params.get("recursive", True)),
                sort_by=str(params.get("sort_by") or "name"),
                audio_path=audio_path,
            )
    except FileMediaOpsError as exc:
        task_manager.update_task(task_id, status="failed", error=str(exc), message=str(exc))
        return {"success": False, "status": "failed", "task_id": task_id, "error": str(exc)}

    if recipe_id == "organize.dedupe_images" and not (preview.get("moves") or []):
        task_manager.update_task(
            task_id,
            status="completed",
            progress=100,
            result=preview,
            message="未发现重复图片",
        )
        return {"success": True, "status": "completed", "task_id": task_id, "result": preview}

    if recipe.requires_approval:
        command = f"{recipe_id} root={root_path}"
        task_manager.update_task(
            task_id,
            progress=25,
            result=preview,
            message="已生成预览，等待审批",
        )
        return _request_system_approval(
            task_id=task_id,
            recipe=recipe,
            command=command,
            params={**params, "_preview": preview},
            trace_id=trace_id,
        )

    result = _execute_media_organize(recipe_id, params)
    task_manager.update_task(
        task_id,
        status="completed" if result.get("success", True) else "failed",
        progress=100,
        result=result,
        message="媒体整理完成",
    )
    return {
        "success": result.get("success", True),
        "status": "completed",
        "task_id": task_id,
        "result": result,
    }


def _execute_media_organize(recipe_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
    root_path = str(params.get("root_path") or "")
    if recipe_id == "organize.compress_images":
        return apply_compress_images(
            root_path,
            quality=int(params.get("quality") or 80),
            max_width=int(params.get("max_width") or 1920),
            output_subdir=str(params.get("output_subdir") or "Compressed"),
            recursive=bool(params.get("recursive", True)),
        )
    if recipe_id == "organize.edit_images":
        return apply_edit_images(
            root_path,
            rotate=int(params.get("rotate") or 0),
            max_width=int(params.get("max_width") or 0),
            output_format=str(params.get("output_format") or ""),
            output_subdir=str(params.get("output_subdir") or "Edited"),
            recursive=bool(params.get("recursive", True)),
            auto_orient=bool(params.get("auto_orient")),
            watermark_text=str(params.get("watermark_text") or ""),
            watermark_position=str(params.get("watermark_position") or "bottom_right"),
        )
    if recipe_id == "organize.dedupe_images":
        preview = params.get("_preview") or {}
        plan_id = str(preview.get("plan_id") or params.get("plan_id") or "")
        if plan_id:
            return apply_organize_plan(task_id, plan_id)
        return apply_organize_plan_from_moves(task_id, preview.get("moves") or [])
    if recipe_id == "organize.images_to_video":
        preview = params.get("_preview") or {}
        return create_slideshow_video(
            root_path,
            duration_per_image=float(params.get("duration_per_image") or 3.0),
            fps=int(params.get("fps") or 30),
            width=int(params.get("width") or 1280),
            height=int(params.get("height") or 720),
            recursive=bool(params.get("recursive", True)),
            output_path=preview.get("output_path"),
            sort_by=str(params.get("sort_by") or preview.get("sort_by") or "name"),
            audio_path=str(params.get("audio_path") or preview.get("audio_path") or ""),
        )
    raise ValueError(f"Unsupported media organize recipe: {recipe_id}")


def _run_organize_preview(task_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
    root_path = _assert_organize_root(str(params.get("root_path") or ""))
    listing = local_computer_service.run_action(action="list_dir", path=root_path)
    entries = listing.get("entries") or []
    rules = params.get("rules") or {}
    extensions_map: Dict[str, str] = {
        ".pdf": "Documents/PDF",
        ".doc": "Documents/Word",
        ".docx": "Documents/Word",
        ".png": "Images",
        ".jpg": "Images",
        ".jpeg": "Images",
        ".gif": "Images",
        ".mp4": "Videos",
        ".mov": "Videos",
        ".zip": "Archives",
        ".txt": "Documents/Text",
        **(rules.get("extensions") or {}),
    }
    moves: List[Dict[str, str]] = []
    root = Path(root_path)
    for entry in entries:
        if entry.get("type") != "file":
            continue
        name = entry.get("name") or ""
        ext = Path(name).suffix.lower()
        subdir = extensions_map.get(ext, rules.get("default_dir", "Other"))
        if not subdir:
            continue
        dest = root / subdir / name
        if str(dest) == entry.get("path"):
            continue
        moves.append({"source": entry["path"], "dest": str(dest), "category": subdir})

    plan_id = str(uuid.uuid4())
    ORGANIZE_PLANS_DIR.mkdir(parents=True, exist_ok=True)
    plan = {
        "id": plan_id,
        "root_path": root_path,
        "moves": moves,
        "created_at": time.time(),
    }
    (ORGANIZE_PLANS_DIR / f"{plan_id}.json").write_text(
        json.dumps(plan, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    result = {"plan_id": plan_id, "move_count": len(moves), "moves": moves[:100]}
    task_manager.update_task(
        task_id,
        status="completed",
        progress=100,
        result=result,
        message=f"已生成整理计划（{len(moves)} 项）",
        metadata={"plan_id": plan_id},
    )
    return {"success": True, "status": "completed", "task_id": task_id, "result": result}


def resume_task(task_id: str) -> Dict[str, Any]:
    task = task_manager.get_task(task_id)
    if not task:
        raise ValueError("Task not found")
    if task.get("type") != "system_assistant":
        raise ValueError("Not a system assistant task")
    if task.get("status") not in {"waiting_approval", "pending"}:
        raise ValueError(f"Task status is {task.get('status')}, cannot resume")

    metadata = task.get("metadata") or {}
    approved = metadata.get("approved_approval_id")
    last = metadata.get("last_approval_id")
    if not approved or approved != last:
        raise ValueError("Task is waiting for approval")

    recipe_id = metadata.get("recipe_id") or (task.get("metadata") or {}).get("recipe_id")
    command = metadata.get("pending_command")
    params = metadata.get("params") or {}

    if recipe_id == "repair.reinstall_app" and metadata.get("phase") != "install":
        uninstall_cmd = _uninstall_command(str(params.get("app_id") or ""))
        result = _run_command(uninstall_cmd, timeout=300)
        if not result.get("success"):
            task_manager.update_task(task_id, status="failed", result=result, error="Uninstall failed")
            return {"success": False, "task_id": task_id, "result": result}
        install_cmd = _install_command(str(params.get("app_id") or ""))
        task_manager.update_task(
            task_id,
            metadata={**metadata, "phase": "install", "pending_command": install_cmd},
        )
        return _execute_and_complete(task_id, recipe_id, install_cmd, timeout=300)

    if recipe_id == "organize.apply_batch":
        plan_id = str(params.get("plan_id") or "")
        return apply_organize_plan(task_id, plan_id)

    if recipe_id in {
        "organize.compress_images",
        "organize.edit_images",
        "organize.images_to_video",
        "organize.dedupe_images",
    }:
        try:
            result = _execute_media_organize(recipe_id, params)
        except FileMediaOpsError as exc:
            task_manager.update_task(task_id, status="failed", error=str(exc))
            return {"success": False, "status": "failed", "task_id": task_id, "error": str(exc)}
        status = "completed" if result.get("success", True) and not result.get("errors") else "failed"
        if recipe_id == "organize.images_to_video" and result.get("output_path"):
            status = "completed"
        task_manager.update_task(
            task_id,
            status=status,
            progress=100,
            result=result,
            message="媒体整理完成" if status == "completed" else "媒体整理失败",
        )
        return {"success": status == "completed", "status": status, "task_id": task_id, "result": result}

    if not command:
        raise ValueError("No pending command")
    return _execute_and_complete(task_id, recipe_id or "", command, timeout=300)


def apply_organize_plan_from_moves(task_id: str, moves: List[Dict[str, Any]]) -> Dict[str, Any]:
    applied: List[Dict[str, Any]] = []
    errors: List[str] = []
    for move in moves[:50]:
        try:
            dest = Path(move["dest"])
            dest.parent.mkdir(parents=True, exist_ok=True)
            res = local_computer_service.run_action(
                action="move_path",
                path=move["source"],
                dest_path=move["dest"],
                metadata={"source": "system_assistant", "kind": "dedupe"},
            )
            applied.append(res)
            if res.get("status") == "waiting_approval":
                task_manager.update_task(
                    task_id,
                    status="waiting_approval",
                    message="去重移动等待审批",
                    metadata={"pending_move": move},
                )
                return {
                    "success": False,
                    "status": "waiting_approval",
                    "task_id": task_id,
                    "pending_move": move,
                }
        except Exception as exc:
            errors.append(str(exc))
    result = {"applied_count": len(applied), "errors": errors, "move_count": len(moves)}
    task_manager.update_task(
        task_id,
        status="completed" if not errors else "failed",
        progress=100,
        result=result,
        message="图片去重完成" if not errors else "部分去重失败",
    )
    return {"success": not errors, "status": "completed" if not errors else "failed", "task_id": task_id, "result": result}


def apply_organize_plan(task_id: str, plan_id: str) -> Dict[str, Any]:
    plan_path = ORGANIZE_PLANS_DIR / f"{plan_id}.json"
    if not plan_path.exists():
        raise ValueError("Organize plan not found")
    plan = json.loads(plan_path.read_text(encoding="utf-8"))
    moves = plan.get("moves") or []
    applied: List[Dict[str, Any]] = []
    errors: List[str] = []
    for move in moves[:50]:
        try:
            dest = Path(move["dest"])
            dest.parent.mkdir(parents=True, exist_ok=True)
            res = local_computer_service.run_action(
                action="move_path",
                path=move["source"],
                dest_path=move["dest"],
                metadata={"source": "system_assistant", "plan_id": plan_id},
            )
            applied.append(res)
            if res.get("status") == "waiting_approval":
                task_manager.update_task(
                    task_id,
                    status="waiting_approval",
                    message="文件移动等待审批",
                    metadata={"plan_id": plan_id, "pending_move": move},
                )
                return {
                    "success": False,
                    "status": "waiting_approval",
                    "task_id": task_id,
                    "pending_move": move,
                }
        except Exception as exc:
            errors.append(str(exc))
    result = {"applied_count": len(applied), "errors": errors, "plan_id": plan_id}
    task_manager.update_task(
        task_id,
        status="completed" if not errors else "failed",
        progress=100,
        result=result,
        message="文件整理完成" if not errors else "部分文件整理失败",
    )
    return {"success": not errors, "status": "completed" if not errors else "failed", "task_id": task_id, "result": result}


def get_task(task_id: str) -> Optional[Dict[str, Any]]:
    return task_manager.get_task(task_id)


def install_app(app_id: str, *, trace_id: Optional[str] = None) -> Dict[str, Any]:
    recipe_id = resolve_install_recipe()
    return start_recipe(recipe_id, {"app_id": app_id}, trace_id=trace_id)


def uninstall_app(app_id: str, *, trace_id: Optional[str] = None) -> Dict[str, Any]:
    recipe_id = resolve_uninstall_recipe()
    return start_recipe(recipe_id, {"app_id": app_id}, trace_id=trace_id)


def mark_approval(task_id: str, approval_id: str) -> None:
    task = task_manager.get_task(task_id)
    if not task:
        return
    metadata = task.get("metadata") or {}
    metadata["approved_approval_id"] = approval_id
    task_manager.update_task(task_id, metadata=metadata)
