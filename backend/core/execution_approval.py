from typing import Any, Dict, Optional

from core.capabilities import requires_approval
from services.approval_service import approval_service
from utils.task_manager import task_manager


ACTION_CAPABILITIES = {
    "goto": "browser_control",
    "click": "mouse_control",
    "fill": "keyboard_input",
    "scroll": "mouse_control",
    "press": "keyboard_input",
    "screenshot": "screen_read",
}


def capability_for_step(step: Dict[str, Any]) -> Optional[str]:
    return ACTION_CAPABILITIES.get(str(step.get("action", "")).lower().strip())


def create_step_approval(
    *,
    step: Dict[str, Any],
    round_idx: int,
    step_idx: int,
    goal: str,
    task_id: Optional[str],
    trace_id: Optional[str],
) -> Optional[Dict[str, Any]]:
    capability_id = capability_for_step(step)
    if not capability_id or not requires_approval(capability_id):
        return None

    action = step.get("action")
    approval = approval_service.create_request(
        capability_id=capability_id,
        proposed_action=f"Computer Use 执行 {action}",
        args={
            "goal": goal,
            "round": round_idx + 1,
            "step": step_idx + 1,
            "action": action,
            "step_args": step,
        },
        trace_id=trace_id,
        task_id=task_id,
        metadata={"source": "computer_use", "round": round_idx + 1, "step": step_idx + 1},
    )
    if task_id:
        task_manager.update_task(
            task_id,
            status="waiting_approval",
            message=f"等待审批：Computer Use {action}",
            metadata={"last_approval_id": approval["id"], "blocked_step": step},
        )
    return approval