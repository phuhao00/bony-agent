"""Native desktop GUI automation sessions (vision-guided loop)."""

from __future__ import annotations

import threading
from typing import Any, Dict, Optional

from services.approval_service import approval_service
from services import native_desktop_service
from services.agent_s.desktop_config import get_native_engine
from services.agent_s.desktop_runner import run_desktop_agent_session
from utils.logger import setup_logger
from utils.task_manager import task_manager

logger = setup_logger("native_use_service")

_running_tasks: set[str] = set()
_running_lock = threading.Lock()


def start_native_use_task(
    *,
    goal: str,
    app_hint: str = "",
    trace_id: Optional[str] = None,
    require_approval: bool = True,
) -> Dict[str, Any]:
    goal = (goal or "").strip()
    if not goal:
        raise ValueError("goal is required")

    bridge = native_desktop_service.get_bridge()
    if not bridge.is_available():
        return native_desktop_service.semi_auto_playbook(goal, app_hint)

    task_id = task_manager.create_task(
        "native_use",
        metadata={
            "goal": goal,
            "app_hint": app_hint,
            "trace_id": trace_id,
            "steps": [],
            "engine": get_native_engine(),
        },
    )

    if require_approval:
        approval = approval_service.create_request(
            capability_id="native_desktop_control",
            proposed_action=f"Native desktop automation: {goal[:200]}",
            args={"goal": goal, "app_hint": app_hint, "task_id": task_id},
            trace_id=trace_id,
            task_id=task_id,
            metadata={"source": "native_use", "goal": goal},
        )
        task_manager.update_task(
            task_id,
            status="waiting_approval",
            message="等待原生桌面自动化审批",
            metadata={"last_approval_id": approval["id"]},
        )
        return {
            "success": False,
            "status": "waiting_approval",
            "task_id": task_id,
            "approval": approval,
            "bridge": bridge.name,
        }

    return _start_background_run(task_id)


def _task_result_payload(task_id: str, task: Dict[str, Any]) -> Dict[str, Any]:
    result = task.get("result")
    if isinstance(result, dict):
        payload = dict(result)
    else:
        payload = {"success": task.get("status") == "completed", "status": task.get("status")}
    payload.setdefault("task_id", task_id)
    return payload


def resume_approved_native_use_task(task_id: str) -> Dict[str, Any]:
    """审批通过后继续执行 native_use 任务（幂等，后台运行）。"""
    task = task_manager.get_task(task_id)
    if not task:
        raise ValueError("task not found")
    if task.get("type") != "native_use":
        raise ValueError("Only native_use tasks can be resumed here")

    metadata = task.get("metadata") or {}
    last_approval_id = metadata.get("last_approval_id")
    approved_approval_id = metadata.get("approved_approval_id")
    if not approved_approval_id or approved_approval_id != last_approval_id:
        raise ValueError("Task is waiting for approval before it can resume")

    status = str(task.get("status") or "")
    if status == "completed":
        return _task_result_payload(task_id, task)
    if status == "running":
        return {
            "success": True,
            "status": "running",
            "task_id": task_id,
            "message": "原生自动化执行中",
        }
    if status in {"cancelled", "failed", "expired"}:
        raise ValueError(f"Task is {status} and cannot be resumed")

    executed = metadata.get("executed_approval_id")
    if executed == approved_approval_id and status == "running":
        return {"success": True, "status": "running", "task_id": task_id}

    return _start_background_run(task_id)


def _start_background_run(task_id: str) -> Dict[str, Any]:
    with _running_lock:
        if task_id in _running_tasks:
            return {
                "success": True,
                "status": "running",
                "task_id": task_id,
                "message": "原生自动化已在执行",
            }
        _running_tasks.add(task_id)

    task_manager.update_task(
        task_id,
        status="running",
        progress=5,
        message="原生自动化执行中",
        cancel_requested=False,
    )

    thread = threading.Thread(target=_run_native_use_task_safe, args=(task_id,), daemon=True)
    thread.start()
    return {
        "success": True,
        "status": "running",
        "task_id": task_id,
        "message": "原生自动化已启动，请稍候查看执行结果",
    }


def _run_native_use_task_safe(task_id: str) -> None:
    try:
        run_native_use_task(task_id)
    except Exception as exc:
        err_msg = str(exc)[:1000]
        logger.error("Native use task failed for %s: %s", task_id, exc, exc_info=True)
        task_manager.update_task(
            task_id,
            status="failed",
            error=err_msg,
            message=f"原生自动化失败: {err_msg[:200]}",
        )
    finally:
        with _running_lock:
            _running_tasks.discard(task_id)


def run_native_use_task(task_id: str) -> Dict[str, Any]:
    """Dispatch to Desktop Agent-S or legacy engine."""
    task = task_manager.get_task(task_id)
    if not task:
        raise ValueError("task not found")

    metadata = dict(task.get("metadata") or {})
    approved_approval_id = metadata.get("approved_approval_id")
    if approved_approval_id:
        metadata["executed_approval_id"] = approved_approval_id

    engine = (metadata.get("engine") or get_native_engine()).strip().lower()
    metadata["engine"] = engine
    task_manager.update_task(task_id, metadata=metadata)

    if engine == "legacy":
        from services.native_use_legacy import run_native_use_task_legacy
        return run_native_use_task_legacy(task_id)

    return run_desktop_agent_session(task_id)
