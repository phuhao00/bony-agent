from typing import Any, Dict, Optional

from core.platform_capabilities import PLATFORM_PROFILES, PlatformAction
from services.approval_service import approval_service
from utils.task_manager import task_manager


class PlatformActionError(ValueError):
    pass


async def _execute_platform_action(platform_id: str, action_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
    from tools.connectors.manager import get_connector_manager

    manager = get_connector_manager()
    return await manager.execute_platform_action(platform_id, action_id, params or {})


def _find_action(platform_id: str, action_id: str) -> PlatformAction:
    profile = PLATFORM_PROFILES.get(platform_id)
    if not profile:
        raise PlatformActionError(f"Unknown platform: {platform_id}")
    for action in profile.actions:
        if action.id == action_id:
            if not action.supported:
                raise PlatformActionError(f"Unsupported action for {platform_id}: {action_id}")
            return action
    raise PlatformActionError(f"Unknown action for {platform_id}: {action_id}")


async def request_platform_action(
    *,
    platform_id: str,
    action_id: str,
    params: Optional[Dict[str, Any]] = None,
    trace_id: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    platform_id = platform_id.strip().lower()
    action_id = action_id.strip()
    action = _find_action(platform_id, action_id)
    profile = PLATFORM_PROFILES[platform_id]
    payload = {
        "platform_id": platform_id,
        "platform_name": profile.name,
        "action_id": action.id,
        "action_name": action.name,
        "params": params or {},
        "recommended_method": profile.recommended_method,
    }

    if action.requires_approval:
        task_id = task_manager.create_task(
            "platform_action",
            metadata={
                "platform_id": platform_id,
                "action_id": action.id,
                "capability_id": action.capability_id,
                "platform_action_resume": payload,
                **(metadata or {}),
            },
        )
        approval = approval_service.create_request(
            capability_id=action.capability_id,
            proposed_action=f"{profile.name}: {action.name}",
            args=payload,
            trace_id=trace_id,
            task_id=task_id,
            metadata={"source": "platform_actions", "platform_id": platform_id, "action_id": action.id},
        )
        task_manager.update_task(
            task_id,
            status="waiting_approval",
            message=f"等待审批：{profile.name} / {action.name}",
            metadata={"last_approval_id": approval["id"]},
        )
        return {
            "success": False,
            "status": "waiting_approval",
            "requires_approval": True,
            "task_id": task_id,
            "approval": approval,
            "platform": platform_id,
            "action": action.to_dict(),
        }

    result = await _execute_platform_action(platform_id, action.id, params or {})
    return {"requires_approval": False, "action": action.to_dict(), **result}


async def resume_approved_platform_action(task_id: str) -> Optional[Dict[str, Any]]:
    task = task_manager.get_task(task_id)
    if not task:
        return None
    if task.get("type") != "platform_action":
        raise PlatformActionError("Only platform_action tasks can be resumed here")
    if task.get("status") in {"cancelled", "failed", "completed", "expired"}:
        raise PlatformActionError(f"Task is {task.get('status')} and cannot be resumed")

    metadata = task.get("metadata") or {}
    last_approval_id = metadata.get("last_approval_id")
    approved_approval_id = metadata.get("approved_approval_id")
    if not approved_approval_id or approved_approval_id != last_approval_id:
        raise PlatformActionError("Task is waiting for approval before it can resume")
    payload = metadata.get("platform_action_resume")
    if not isinstance(payload, dict):
        raise PlatformActionError("Task has no platform action resume payload")

    result = await _execute_platform_action(
        str(payload.get("platform_id") or ""),
        str(payload.get("action_id") or ""),
        payload.get("params") if isinstance(payload.get("params"), dict) else {},
    )
    result.update({"task_id": task_id, "approval_id": approved_approval_id})
    ok = result.get("success") is True
    err_msg = result.get("error")
    msg = result.get("message") or err_msg or ("平台动作已完成" if ok else "平台动作执行失败")
    task_manager.update_task(
        task_id,
        status="completed" if ok else "failed",
        progress=100,
        result=result,
        error=err_msg if not ok else None,
        message=msg,
        metadata={"executed_approval_id": approved_approval_id},
    )
    return result