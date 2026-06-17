"""Legacy native_use loop (planner outputs coordinates directly)."""

from __future__ import annotations

import base64
import time
from typing import Any, Dict, List

from services import native_desktop_service
from services.native_use_executor import execute_native_action, png_dimensions, screenshots_similar
from services.native_use_planner import format_action_plan, plan_native_action
from services.native_use_memory import format_memories_for_planner, get_app_memories, save_session_memory
from services.native_use_session_log import append_session_log, finalize_session_log, save_step_screenshot
from utils.logger import setup_logger
from utils.task_manager import task_manager

logger = setup_logger("native_use_legacy")

MAX_STEPS = 12


def run_native_use_task_legacy(task_id: str) -> Dict[str, Any]:
    task = task_manager.get_task(task_id)
    if not task:
        raise ValueError("task not found")

    metadata = dict(task.get("metadata") or {})
    goal = str(metadata.get("goal") or "")
    app_hint = str(metadata.get("app_hint") or "")
    bridge = native_desktop_service.get_bridge()

    if app_hint:
        focus_info = native_desktop_service.focus_app_and_verify(app_hint, retries=2, wait_s=1.0)
        metadata["focus_info"] = focus_info
        if not focus_info.get("success"):
            metadata["focus_warning"] = focus_info.get("error")

    steps: List[Dict[str, Any]] = []
    app_memory_hint = format_memories_for_planner(get_app_memories(app_hint, goal), app_hint=app_hint, goal=goal)
    goal_achieved = False
    failed = False
    final_summary = ""

    for step_idx in range(MAX_STEPS):
        capture = native_desktop_service.capture_screen()
        png_bytes = base64.b64decode(capture.get("image_base64") or "") if capture.get("image_base64") else b""
        screen_w, screen_h = png_dimensions(png_bytes)
        foreground = native_desktop_service.foreground_app()

        action, plan, planner_raw = plan_native_action(
            goal=goal, app_hint=app_hint, screenshot_png=png_bytes,
            step_index=step_idx, history=steps, app_memory_hint=app_memory_hint,
            foreground_app=foreground, screen_width=screen_w, screen_height=screen_h,
        )
        action_name = str(action.get("action") or "").lower()
        screenshot_before = save_step_screenshot(task_id, step_idx, png_bytes, phase="before")

        step: Dict[str, Any] = {
            "index": step_idx, "plan": plan, "plan_detail": format_action_plan(action),
            "action": action_name, "screenshot_before": screenshot_before,
            "foreground_app": foreground,
        }

        if action_name == "done":
            step["ok"] = True
            goal_achieved = True
            final_summary = str(action.get("summary") or goal)
            steps.append(step)
            break
        if action_name == "fail":
            step["ok"] = False
            step["error"] = str(action.get("reason") or "failed")
            steps.append(step)
            failed = True
            break

        step.update(execute_native_action(action, bridge, screen_width=screen_w, screen_height=screen_h))
        after_bytes = base64.b64decode(
            native_desktop_service.capture_screen().get("image_base64") or ""
        )
        step["screenshot_after"] = save_step_screenshot(task_id, step_idx, after_bytes, phase="after")
        if screenshots_similar(png_bytes, after_bytes):
            step["no_progress"] = True
        steps.append(step)
        append_session_log(task_id, goal=goal, app_hint=app_hint, step=step, planner_raw=planner_raw, screenshot_before=screenshot_before)

        metadata["steps"] = steps
        task_manager.update_task(task_id, status="running", progress=min(95, 10 + step_idx * 7), message=plan, metadata=metadata)
        time.sleep(0.4)

    if not goal_achieved and not failed:
        failed = True
        final_summary = f"已达 {MAX_STEPS} 步上限"

    success = goal_achieved and not failed
    reflection = f"legacy引擎；应用={app_hint}；结果={'成功' if success else '失败'}"
    finalize_session_log(task_id, status="completed" if success else "failed", goal=goal, app_hint=app_hint, message=final_summary, reflection=reflection, steps_count=len(steps))
    if app_hint:
        save_session_memory(app_hint=app_hint, goal=goal, steps=steps, success=success, task_id=task_id, reflection=reflection)

    result = {"success": success, "status": "completed" if success else "failed", "task_id": task_id, "goal": goal, "message": final_summary, "steps": steps, "engine": "legacy"}
    task_manager.update_task(task_id, status=result["status"], progress=100, result=result, metadata=metadata, message=final_summary)
    return result
