"""Desktop Agent-S session runner for native PC software automation."""

from __future__ import annotations

import base64
import time
from typing import Any, Dict, List, Optional

from services import native_desktop_service
from services.agent_s.desktop_config import NativeDesktopConfig
from services.agent_s.desktop_vision_planner import format_desktop_plan, plan_desktop_action
from services.agent_s.native_desktop_aci import NativeDesktopACI
from services.agent_s.qwen_grounding import QwenVLGroundingClient
from services.agent_s.vision_planner import _reflect_step_sync
from services.native_use_executor import png_dimensions, screenshots_similar
from services.native_use_memory import (
    format_memories_for_planner,
    get_app_memories,
    save_session_memory,
)
from services.native_use_session_log import (
    append_session_log,
    finalize_session_log,
    save_step_screenshot,
)
from utils.logger import setup_logger
from utils.task_manager import task_manager

logger = setup_logger("agent_s.desktop_runner")


def _build_reflection(
    *,
    goal: str,
    app_hint: str,
    steps: List[Dict[str, Any]],
    success: bool,
) -> str:
    action_steps = [s for s in steps if str(s.get("action") or "").lower() not in {"done", "fail"}]
    click_count = sum(1 for s in action_steps if str(s.get("action") or "").lower() == "click")
    hotkey_count = sum(1 for s in action_steps if str(s.get("action") or "").lower() == "hotkey")
    failed_steps = [s for s in action_steps if s.get("ok") is False]

    parts = [
        f"应用={app_hint or '未知'}",
        f"目标={goal[:80]}",
        f"结果={'成功' if success else '失败/未完成'}",
        f"共{len(action_steps)}步(点击{click_count},快捷键{hotkey_count})",
        "引擎=desktop_agent_s",
    ]
    if failed_steps:
        parts.append(f"失败步: {failed_steps[0].get('plan') or failed_steps[0].get('action')}")
    return "；".join(parts)


def run_desktop_agent_session(task_id: str) -> Dict[str, Any]:
    """Main Observe-Plan-Ground-Act loop for native PC apps."""
    task = task_manager.get_task(task_id)
    if not task:
        raise ValueError("task not found")

    config = NativeDesktopConfig.from_env()
    metadata = dict(task.get("metadata") or {})
    goal = str(metadata.get("goal") or "")
    app_hint = str(metadata.get("app_hint") or "")

    from core.llm_provider import resolve_vision_credentials
    from services.native_sidecar_manager import ensure_sidecar_running

    v_pid, v_model, v_key, _v_cfg = resolve_vision_credentials()
    metadata["vision_provider"] = v_pid
    metadata["vision_model"] = v_model
    metadata["vision_ready"] = bool(v_key)
    metadata["engine"] = "desktop_agent_s"

    sidecar_health = ensure_sidecar_running(timeout=8.0)
    metadata["sidecar"] = sidecar_health
    if not sidecar_health.get("ok"):
        msg = f"Sidecar 不可用: {sidecar_health.get('reason') or 'unknown'}"
        return _fail_task(task_id, goal, app_hint, metadata, message=msg, steps=[])

    bridge = native_desktop_service.get_bridge()
    if not bridge.is_available():
        msg = "原生桌面桥不可用，请检查 Sidecar 与系统权限"
        return _fail_task(task_id, goal, app_hint, metadata, message=msg, steps=[])

    if not v_key:
        msg = "未配置视觉 LLM API Key（LLM_VISION_PROVIDER / DASHSCOPE_API_KEY）"
        return _fail_task(task_id, goal, app_hint, metadata, message=msg, steps=[])

    target_frame: Optional[Dict[str, Any]] = None
    if app_hint:
        open_result = native_desktop_service.ensure_app_open_and_locate(
            app_hint,
            launch_wait_s=config.launch_wait_s,
            activate_wait_s=config.activate_wait_s,
            locate_retries=config.locate_retries,
            locate_wait_s=config.locate_wait_s,
        )
        metadata["app_open"] = open_result
        target_frame = open_result.get("target_frame")
        metadata["target_frame"] = target_frame

        if open_result.get("success") and target_frame:
            launch_note = "已启动" if open_result.get("launched") else "已在运行"
            metadata["locate_info"] = (
                f"{launch_note}并打开 {target_frame.get('owner_name') or app_hint}，"
                f"定位在显示器 D{target_frame.get('display_index')} "
                f"({target_frame.get('logical_width')}×{target_frame.get('logical_height')})，"
                "后续对该窗口截屏操作"
            )
        else:
            err = open_result.get("error") or f"未能打开并定位 {app_hint}"
            metadata["locate_warning"] = err
            logger.warning("App open/locate failed: %s", err)
            return _fail_task(task_id, goal, app_hint, metadata, message=err, steps=[])

    grounding = QwenVLGroundingClient()
    aci = NativeDesktopACI(bridge, grounding=grounding)
    app_memories = get_app_memories(app_hint, goal)
    app_memory_hint = format_memories_for_planner(app_memories, app_hint=app_hint, goal=goal)

    app_running_hint = ""
    if target_frame:
        app_running_hint = (
            f"{target_frame.get('owner_name') or app_hint} 已定位在 D{target_frame.get('display_index')}，"
            f"窗口 {target_frame.get('logical_width')}x{target_frame.get('logical_height')}"
        )
        metadata["app_running"] = True
    elif app_hint and native_desktop_service.app_is_running(app_hint):
        app_running_hint = f"{app_hint} 正在运行（窗口/进程已检测到）"
        metadata["app_running"] = True
    elif app_hint:
        metadata["app_running"] = False

    steps: List[Dict[str, Any]] = list(metadata.get("steps") or [])
    goal_achieved = False
    failed = False
    final_summary = ""

    task_manager.update_task(
        task_id,
        status="running",
        progress=10,
        message="Desktop Agent-S 执行中",
        metadata=metadata,
    )

    max_steps = config.max_steps

    for step_idx in range(max_steps):
        capture = native_desktop_service.capture_screen(
            app_hint=app_hint,
            target_frame=target_frame,
        )
        capture_meta = dict(capture.get("capture_meta") or {})
        png_b64 = capture.get("image_base64") or ""
        png_bytes = base64.b64decode(png_b64) if png_b64 else b""
        if not png_bytes:
            failed = True
            final_summary = "截屏失败，请检查屏幕录制权限"
            break

        screen_w, screen_h = png_dimensions(png_bytes)
        foreground = native_desktop_service.foreground_app()
        aci.assign_screenshot(png_bytes)
        aci.update_screen_size(screen_w, screen_h)
        aci.set_capture_frame(
            origin_x=int(capture_meta.get("origin_x") or 0),
            origin_y=int(capture_meta.get("origin_y") or 0),
            scale_factor=float(capture_meta.get("scale_factor") or 1.0),
        )
        if capture_meta:
            metadata["capture_meta"] = capture_meta

        action, plan, planner_raw = plan_desktop_action(
            goal=goal,
            app_hint=app_hint,
            screenshot_png=png_bytes,
            step_index=step_idx,
            history=steps,
            app_memory_hint=app_memory_hint,
            foreground_app=foreground,
            app_running_hint=app_running_hint,
            screen_width=screen_w,
            screen_height=screen_h,
        )
        action_name = str(action.get("action") or "").lower()
        screenshot_before = save_step_screenshot(task_id, step_idx, png_bytes, phase="before")

        step: Dict[str, Any] = {
            "index": step_idx,
            "plan": plan,
            "plan_detail": format_desktop_plan(action),
            "reason": str(action.get("reason") or action.get("summary") or ""),
            "action": action_name,
            "capture_bytes": capture.get("bytes", 0),
            "bridge": capture.get("bridge"),
            "screenshot_before": screenshot_before,
            "timestamp": time.time(),
            "foreground_app": foreground,
            "screen_size": f"{screen_w}x{screen_h}",
        }
        if capture_meta:
            step["capture_meta"] = capture_meta
        if action.get("target"):
            step["target"] = str(action.get("target"))

        if action_name == "done":
            step["ok"] = True
            final_summary = str(action.get("summary") or action.get("reason") or goal)
            goal_achieved = True
            steps.append(step)
            append_session_log(
                task_id, goal=goal, app_hint=app_hint, step=step,
                planner_raw=planner_raw, screenshot_before=screenshot_before,
            )
            break

        if action_name == "fail":
            step["ok"] = False
            step["error"] = str(action.get("reason") or "failed")
            steps.append(step)
            append_session_log(
                task_id, goal=goal, app_hint=app_hint, step=step,
                planner_raw=planner_raw, screenshot_before=screenshot_before,
            )
            failed = True
            final_summary = step["error"]
            break

        exec_result = aci.execute_action(action)
        step.update(exec_result)

        after_capture = native_desktop_service.capture_screen(
            app_hint=app_hint,
            target_frame=target_frame,
        )
        after_b64 = after_capture.get("image_base64") or ""
        after_bytes = base64.b64decode(after_b64) if after_b64 else b""
        screenshot_after = save_step_screenshot(task_id, step_idx, after_bytes, phase="after")
        step["screenshot_after"] = screenshot_after

        if screenshots_similar(png_bytes, after_bytes) and action_name in {"click", "hotkey", "type"}:
            step["no_progress"] = True
            step["progress_note"] = "执行后界面无明显变化"

        if config.enable_reflection and exec_result.get("ok"):
            try:
                reflection_text = _reflect_step_sync(goal=goal, plan=plan, result=exec_result)
                if reflection_text:
                    step["reflection"] = reflection_text[:500]
            except Exception as exc:
                logger.debug("Reflection skipped: %s", exc)

        steps.append(step)
        append_session_log(
            task_id, goal=goal, app_hint=app_hint, step=step,
            planner_raw=planner_raw, screenshot_before=screenshot_before,
            screenshot_after=screenshot_after,
        )

        metadata["steps"] = steps
        metadata["preview_screenshot"] = screenshot_after or screenshot_before
        progress = min(95, 10 + int((step_idx + 1) / max_steps * 85))
        task_manager.update_task(
            task_id,
            status="running",
            progress=progress,
            message=f"步骤 {step_idx + 1}/{max_steps}：{plan}",
            metadata=metadata,
        )
        logger.info("Desktop step %s/%s: %s ok=%s", step_idx + 1, max_steps, plan, step.get("ok"))
        time.sleep(config.step_delay_s)

    if not goal_achieved and not failed:
        failed = True
        final_summary = f"已达 {max_steps} 步上限，目标可能未完成：{goal}"

    success = goal_achieved and not failed
    reflection = _build_reflection(goal=goal, app_hint=app_hint, steps=steps, success=success)
    session_info = finalize_session_log(
        task_id,
        status="completed" if success else "failed",
        goal=goal,
        app_hint=app_hint,
        message=final_summary,
        reflection=reflection,
        steps_count=len(steps),
    )
    if app_hint:
        save_session_memory(
            app_hint=app_hint, goal=goal, steps=steps,
            success=success, task_id=task_id, reflection=reflection,
        )

    result = {
        "success": success,
        "status": "completed" if success else "failed",
        "task_id": task_id,
        "goal": goal,
        "steps_executed": len(steps),
        "message": final_summary or reflection,
        "reflection": reflection,
        "session_log": session_info.get("session_log"),
        "engine": "desktop_agent_s",
        "steps": steps,
    }
    metadata["steps"] = steps
    metadata["reflection"] = reflection
    task_manager.update_task(
        task_id,
        status=result["status"],
        progress=100,
        result=result,
        metadata=metadata,
        message=result["message"],
    )
    return result


def _fail_task(
    task_id: str,
    goal: str,
    app_hint: str,
    metadata: Dict[str, Any],
    *,
    message: str,
    steps: List[Dict[str, Any]],
) -> Dict[str, Any]:
    reflection = message
    finalize_session_log(
        task_id, status="failed", goal=goal, app_hint=app_hint,
        message=message, reflection=reflection, steps_count=len(steps),
    )
    result = {
        "success": False,
        "status": "failed",
        "task_id": task_id,
        "goal": goal,
        "message": message,
        "reflection": reflection,
        "steps": steps,
        "engine": "desktop_agent_s",
    }
    metadata["steps"] = steps
    task_manager.update_task(
        task_id, status="failed", progress=100,
        result=result, metadata=metadata, message=message,
    )
    return result
