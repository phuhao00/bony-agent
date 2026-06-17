from typing import Any, Dict, Optional

from core.capabilities import list_capabilities, require_capability
from services.approval_service import approval_service
from utils.logger import setup_logger
from utils.task_manager import task_manager
from utils.trace_store import update_trace_metadata

logger = setup_logger("super_agent_api")


def clamp_limit(limit: int, *, max_limit: int = 500) -> int:
    return max(1, min(int(limit), max_limit))


def list_capabilities_response() -> Dict[str, Any]:
    return {"capabilities": list_capabilities()}


def get_capability_response(capability_id: str) -> Dict[str, Any]:
    return require_capability(capability_id).to_dict()


def create_task_response(task_type: str, metadata: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
    task_id = task_manager.create_task(task_type, metadata=metadata or {})
    return task_manager.get_task(task_id)


def list_tasks_response(status: Optional[str] = None, limit: int = 100) -> Dict[str, Any]:
    return {"tasks": task_manager.list_tasks(status=status, limit=clamp_limit(limit))}


def get_task_response(task_id: str) -> Optional[Dict[str, Any]]:
    return task_manager.get_task(task_id)


def cancel_task_response(task_id: str) -> Optional[Dict[str, Any]]:
    return task_manager.request_cancel(task_id)


def get_task_resume_payload(task_id: str) -> Optional[Dict[str, Any]]:
    task = task_manager.get_task(task_id)
    if not task:
        return None
    if task.get("type") != "computer_use":
        raise ValueError("Only computer_use tasks can be resumed")
    if task.get("status") in {"cancelled", "failed", "completed", "expired"}:
        raise ValueError(f"Task is {task.get('status')} and cannot be resumed")

    metadata = task.get("metadata") or {}
    resume = metadata.get("computer_use_resume")
    if not isinstance(resume, dict):
        raise ValueError("Task has no Computer Use resume payload")

    last_approval_id = metadata.get("last_approval_id") or resume.get("approval_id")
    approved_approval_id = metadata.get("approved_approval_id")
    if not approved_approval_id or approved_approval_id != last_approval_id:
        raise ValueError("Task is waiting for approval before it can resume")

    resume_page = resume.get("page_context_at_block")
    if not isinstance(resume_page, dict):
        resume_page = None
    resume_nav = resume.get("resume_navigation_url")
    resume_nav_s = str(resume_nav).strip() if resume_nav else ""

    return {
        "goal": str(resume.get("goal") or metadata.get("goal") or "").strip(),
        "start_url": str(resume.get("start_url") or metadata.get("start_url") or "").strip(),
        "max_rounds": int(resume.get("max_rounds") or 4),
        "headless": bool(resume.get("headless", True)),
        "autoresearch": bool(resume.get("autoresearch", True)),
        "require_approval": bool(resume.get("require_approval", False)),
        "trace_id": resume.get("trace_id"),
        "approved_approval_id": approved_approval_id,
        "resume_navigation_url": resume_nav_s,
        "page_context_at_block": resume_page,
    }


def create_approval_response(
    *,
    capability_id: str,
    proposed_action: str,
    args: Optional[Dict[str, Any]] = None,
    trace_id: Optional[str] = None,
    task_id: Optional[str] = None,
    expires_in_seconds: int = 3600,
    metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    approval = approval_service.create_request(
        capability_id=capability_id,
        proposed_action=proposed_action,
        args=args or {},
        trace_id=trace_id,
        task_id=task_id,
        expires_in_seconds=expires_in_seconds,
        metadata=metadata or {},
    )
    if trace_id:
        try:
            update_trace_metadata(trace_id, {"last_approval_id": approval["id"]})
        except Exception as exc:
            logger.warning(f"Failed to link approval to trace {trace_id}: {exc}")
    if task_id:
        task_manager.update_task(task_id, status="waiting_approval", metadata={"last_approval_id": approval["id"]})
    return approval


def approve_approval_response(approval_id: str, *, approved_by: str = "local_user") -> Dict[str, Any]:
    pending = approval_service.get_request(approval_id)
    if not pending:
        raise KeyError(f"Approval not found: {approval_id}")
    meta = pending.get("metadata") or {}
    approval = approval_service.approve(approval_id, approved_by=approved_by)
    if meta.get("source") == "media_pipeline":
        from core.media_pipeline import complete_media_pipeline_from_approval

        complete_media_pipeline_from_approval(approval)
        return approval
    if approval.get("task_id"):
        task_manager.update_task(
            approval["task_id"],
            status="pending",
            metadata={"approved_approval_id": approval_id},
        )
    return approval


def deny_approval_response(
    approval_id: str,
    *,
    approved_by: str = "local_user",
    reason: Optional[str] = None,
) -> Dict[str, Any]:
    pending = approval_service.get_request(approval_id)
    if not pending:
        raise KeyError(f"Approval not found: {approval_id}")
    meta = pending.get("metadata") or {}
    approval = approval_service.deny(approval_id, approved_by=approved_by, reason=reason)
    if meta.get("source") == "media_pipeline":
        from core.media_pipeline import fail_media_pipeline_from_denied_approval

        fail_media_pipeline_from_denied_approval(approval, reason=reason)
        return approval
    if approval.get("task_id"):
        task_manager.update_task(
            approval["task_id"],
            status="cancelled",
            metadata={"denied_approval_id": approval_id},
        )
    return approval


def list_approvals_response(status: Optional[str] = None, limit: int = 100) -> Dict[str, Any]:
    return {"approvals": approval_service.list_requests(status=status, limit=clamp_limit(limit))}


def get_approval_response(approval_id: str) -> Optional[Dict[str, Any]]:
    return approval_service.get_request(approval_id)