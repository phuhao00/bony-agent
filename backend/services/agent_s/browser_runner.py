"""Agent-S style single-step browser session orchestration."""

from __future__ import annotations

import base64
from typing import Any, Dict, List, Optional

from core.execution_approval import create_step_approval
from services.agent_s.config import AgentSConfig
from services.agent_s.grounding import UITarsGroundingClient
from services.agent_s.playwright_browser_aci import PlaywrightBrowserACI
from services.agent_s.deterministic_planner import plan_deterministic_action
from services.agent_s.result_extractor import extract_search_results_from_page
from services.agent_s.vision_planner import plan_next_action, reflect_step
from services.computer_use_service import (
    _approved_blocked_step_for_task,
    _claim_computer_use_task,
    _digest_page,
    _emit_progress,
    _extract_query_for_search,
    _goal_suggests_web_search,
    _is_cancelled,
    _release_computer_use_task,
    _run_autoresearch_report,
    _run_bootstrap_search_round,
    _safe_http_url,
    _snapshot_page_context_for_resume,
    _summarize_rounds,
    _wait_for_any_search_input,
)
from utils.logger import setup_logger
from utils.task_manager import task_manager

logger = setup_logger("agent_s.runner")

try:
    from playwright.async_api import async_playwright
except ImportError:
    async_playwright = None


def _action_requires_approval(action: Dict[str, Any]) -> bool:
    name = str(action.get("action", "")).lower()
    return name in {"click", "type", "press"}


async def run_agent_s_browser_session(
    goal: str,
    start_url: str,
    *,
    max_rounds: int = 4,
    headless: bool = True,
    autoresearch: bool = True,
    require_approval: bool = False,
    task_id: Optional[str] = None,
    trace_id: Optional[str] = None,
    resume_navigation_url: Optional[str] = None,
    resume_page_context: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    from core.llm_provider import get_api_key

    config = AgentSConfig.from_env()
    max_steps = max(1, min(config.max_steps, 30))

    if not get_api_key():
        return {
            "success": False,
            "error": "未配置 LLM API Key，无法规划步骤。",
        }
    if not async_playwright:
        return {
            "success": False,
            "error": "Playwright 未安装。请执行: pip install playwright && playwright install chromium",
        }

    resume_nav_ok = bool(resume_navigation_url and _safe_http_url(str(resume_navigation_url)))
    if not _safe_http_url(start_url) and not resume_nav_ok:
        return {"success": False, "error": "start_url 必须是 http(s) 链接"}

    claimed = False
    step_history: List[Dict[str, Any]] = []
    rounds_out: List[Dict[str, Any]] = []

    if task_id:
        if not _claim_computer_use_task(task_id):
            return {
                "success": False,
                "error": "该 Computer Use 任务已在执行中。",
                "status": "busy",
            }
        claimed = True

    try:
        if task_id:
            task_manager.update_task(
                task_id,
                status="running",
                progress=5,
                message="Agent-S 浏览器会话启动",
                metadata={
                    "goal": goal,
                    "start_url": start_url,
                    "engine": "agent_s",
                    "require_approval": require_approval,
                },
            )
            _emit_progress(task_id, step=0, max_steps=max_steps, stage="launch", message="启动 Chromium")

        initial_nav = str(resume_navigation_url).strip() if resume_nav_ok else str(start_url).strip()
        grounding = UITarsGroundingClient(config)
        approved_blocked = _approved_blocked_step_for_task(task_id)
        approved_consumed = False

        async with async_playwright() as p:
            browser = await p.chromium.launch(
                headless=headless,
                timeout=90_000,
                args=["--no-sandbox", "--disable-setuid-sandbox"],
            )
            context = await browser.new_context(
                viewport={"width": config.viewport_width, "height": config.viewport_height},
                locale="zh-CN",
            )
            page = await context.new_page()
            await page.goto(initial_nav, wait_until="load", timeout=60_000)
            await _wait_for_any_search_input(page)

            aci = PlaywrightBrowserACI(
                page,
                viewport_width=config.viewport_width,
                viewport_height=config.viewport_height,
                grounding=grounding if grounding.available else None,
                ground_width=config.ground_width,
                ground_height=config.ground_height,
            )

            step_logs: List[Dict[str, Any]] = []
            stopped = False
            total_executed = 0
            bootstrap_query: Optional[str] = None
            shot_counter = [0]

            if not resume_nav_ok:
                bs = await _run_bootstrap_search_round(
                    page, goal.strip(), initial_nav, shot_counter
                )
                if bs:
                    bootstrap_query = bs.get("bootstrap_query")
                    for i, bl in enumerate(bs.get("steps_logs") or []):
                        entry = {**bl, "step": i + 1, "plan": "bootstrap · auto_search"}
                        step_logs.append(entry)
                        step_history.append(entry)
                        total_executed += 1
                    rounds_out.append(bs)
                    png_bs = await page.screenshot(type="png")
                    _emit_progress(
                        task_id,
                        step=total_executed,
                        max_steps=max_steps,
                        plan=f"bootstrap · 已搜索「{bootstrap_query}」",
                        preview_screenshot_base64=base64.b64encode(png_bs).decode("ascii"),
                        stage="bootstrap",
                        message=f"服务端自动搜索「{bootstrap_query}」",
                    )
                    try:
                        await page.wait_for_load_state("networkidle", timeout=12_000)
                    except Exception:
                        await page.wait_for_timeout(2000)

            for step_idx in range(max_steps):
                if _is_cancelled(task_id):
                    stopped = True
                    step_logs.append({"action": "cancelled", "ok": False})
                    if task_id:
                        task_manager.update_task(task_id, status="cancelled", message="用户已取消")
                    break

                png = await page.screenshot(type="png")
                await aci.assign_screenshot(png)
                preview_b64 = base64.b64encode(png).decode("ascii")

                try:
                    title = await page.title()
                except Exception:
                    title = ""

                digest = await _digest_page(page)
                det = plan_deterministic_action(
                    goal=goal,
                    page_url=page.url,
                    history=step_history,
                    bootstrap_query=bootstrap_query,
                    page_digest=digest,
                )
                if det:
                    action, plan = det
                else:
                    action, plan = await plan_next_action(
                        goal=goal,
                        screenshot_png=png,
                        step_index=step_idx,
                        history=step_history,
                        page_url=page.url,
                        page_title=title,
                        page_digest=digest,
                        bootstrap_query=bootstrap_query,
                    )

                if str(action.get("action", "")).lower() == "done":
                    step_logs.append({"action": "done", "ok": True, "plan": plan})
                    _emit_progress(
                        task_id,
                        step=total_executed + 1,
                        max_steps=max_steps,
                        plan=plan,
                        preview_screenshot_base64=preview_b64,
                        stage="done",
                        message=f"完成 · {plan}",
                    )
                    stopped = True
                    break
                if str(action.get("action", "")).lower() == "fail":
                    fail_entry = {
                        "action": "fail",
                        "ok": False,
                        "error": action.get("reason"),
                        "plan": plan,
                        "step": total_executed + 1,
                    }
                    step_logs.append(fail_entry)
                    step_history.append(fail_entry)
                    _emit_progress(
                        task_id,
                        step=total_executed + 1,
                        max_steps=max_steps,
                        plan=plan,
                        preview_screenshot_base64=preview_b64,
                        stage="fail",
                        message=str(action.get("reason") or plan),
                    )
                    stopped = True
                    break

                skip_approval = False
                if (
                    require_approval
                    and approved_blocked
                    and not approved_consumed
                    and action == approved_blocked.get("step")
                ):
                    skip_approval = True
                    approved_consumed = True

                if require_approval and _action_requires_approval(action) and not skip_approval:
                    digest = await _digest_page(page)
                    approval = create_step_approval(
                        step=action,
                        round_idx=0,
                        step_idx=step_idx,
                        goal=goal,
                        task_id=task_id,
                        trace_id=trace_id,
                    )
                    if approval:
                        page_snap = _snapshot_page_context_for_resume(digest)
                        blocked_url = str(page_snap.get("url") or "")
                        resume_nav = blocked_url if _safe_http_url(blocked_url) else start_url
                        if task_id:
                            task_manager.update_task(
                                task_id,
                                status="waiting_approval",
                                metadata={
                                    "blocked_step": action,
                                    "last_approval_id": approval["id"],
                                    "preview_screenshot_base64": preview_b64,
                                    "computer_use_resume": {
                                        "goal": goal,
                                        "start_url": start_url,
                                        "max_rounds": max_rounds,
                                        "headless": headless,
                                        "autoresearch": autoresearch,
                                        "require_approval": require_approval,
                                        "trace_id": trace_id,
                                        "approval_id": approval["id"],
                                        "blocked_round": 1,
                                        "blocked_step": step_idx + 1,
                                        "page_context_at_block": page_snap,
                                        "resume_navigation_url": resume_nav,
                                        "engine": "agent_s",
                                    },
                                    "computer_use": {
                                        "last_plan": plan,
                                        "preview_screenshot_base64": preview_b64,
                                    },
                                },
                            )
                        await context.close()
                        await browser.close()
                        return {
                            "success": False,
                            "status": "waiting_approval",
                            "requires_approval": True,
                            "approval": approval,
                            "rounds": [
                                {
                                    "round": 1,
                                    "planned_steps": [action],
                                    "steps_logs": step_logs
                                    + [
                                        {
                                            "action": action.get("action"),
                                            "ok": False,
                                            "requires_approval": True,
                                            "approval_id": approval["id"],
                                            "plan": plan,
                                        }
                                    ],
                                    "waiting_approval": True,
                                }
                            ],
                            "total_steps_executed": total_executed,
                            "task_id": task_id,
                            "preview_screenshot_base64": preview_b64,
                        }

                action_name = str(action.get("action", "")).lower()
                if action_name == "extract_results":
                    items = await extract_search_results_from_page(page)
                    log_entry = {
                        "action": "extract_results",
                        "ok": len(items) > 0,
                        "results": items,
                        "count": len(items),
                    }
                elif action_name == "click_submit_retry":
                    log_entry = await aci.press("Enter")
                    log_entry["action"] = "click_submit_retry"
                    log_entry["retry_search"] = True
                    await page.wait_for_timeout(1500)
                    try:
                        await page.wait_for_load_state("networkidle", timeout=10_000)
                    except Exception:
                        pass
                else:
                    log_entry = await aci.execute_action(action)
                log_entry["step"] = total_executed + 1
                log_entry["plan"] = plan
                if skip_approval and approved_blocked:
                    log_entry["approval_reused"] = True
                    log_entry["approval_id"] = approved_blocked.get("approval_id")
                step_logs.append(log_entry)
                step_history.append(log_entry)
                total_executed += 1

                after_png = await page.screenshot(type="png")
                after_b64 = base64.b64encode(after_png).decode("ascii")

                reflection = ""
                if config.enable_reflection and not log_entry.get("deterministic"):
                    reflection = await reflect_step(goal=goal, plan=plan, result=log_entry)

                _emit_progress(
                    task_id,
                    step=total_executed,
                    max_steps=max_steps,
                    plan=plan,
                    reflection=reflection,
                    preview_screenshot_base64=after_b64,
                    stage=str(action.get("action", "")),
                    message=f"第 {total_executed} 步 · {plan}",
                )

                if str(action.get("action", "")).lower() == "done":
                    stopped = True
                    break

                if not log_entry.get("ok", True):
                    # 搜索类 click 失败时下一步强制 type
                    q = _extract_query_for_search(goal)
                    if q and str(action.get("action", "")).lower() == "click":
                        logger.warning("Click failed, will retry via deterministic type on next step")
                    else:
                        stopped = True

            if not stopped and step_idx == max_steps - 1:
                step_logs.append({"action": "limit", "ok": False, "error": "已达最大步数"})

            rounds_out.append(
                {
                    "round": 1,
                    "engine": "agent_s",
                    "planned_steps": [h.get("plan") for h in step_history],
                    "steps_logs": step_logs,
                }
            )

            final_digest = await _digest_page(page)
            final_png = await page.screenshot(type="png")
            final_b64 = base64.b64encode(final_png).decode("ascii")
            await context.close()
            await browser.close()

        extract_log = next(
            (x for x in step_logs if x.get("action") == "extract_results"),
            None,
        )
        search_results: List[Dict[str, str]] = list(
            (extract_log or {}).get("results") or []
        )
        has_fail = any(x.get("action") == "fail" for x in step_logs)
        is_search_task = bool(bootstrap_query or _goal_suggests_web_search(goal))

        base: Dict[str, Any] = {
            "success": not has_fail,
            "engine": "agent_s",
            "rounds": rounds_out,
            "final_screenshot_base64": final_b64,
            "total_steps_executed": total_executed,
            "search_results": search_results,
            "search_results_count": len(search_results),
            "final_page_context": {
                "url": final_digest.get("url", ""),
                "title": final_digest.get("title", ""),
                "text_excerpt_preview": (final_digest.get("text_excerpt") or "")[:4000],
            },
        }
        if is_search_task:
            base["success"] = not has_fail and len(search_results) > 0
            if not has_fail and len(search_results) == 0:
                base["error"] = "搜索已完成，但未能提取到有效结果条目，请重试或更换起始 URL"
        if has_fail:
            fail_log = next(x for x in step_logs if x.get("action") == "fail")
            base["error"] = str(
                fail_log.get("error") or fail_log.get("reason") or "任务失败"
            )[:1000]
            base["success"] = False
        if any(x.get("action") == "cancelled" for x in step_logs):
            base["success"] = False
            base["status"] = "cancelled"
        if autoresearch and base.get("success"):
            ar = await _run_autoresearch_report(
                goal,
                final_digest,
                _summarize_rounds(rounds_out),
                search_results=search_results,
            )
            base["autoresearch_markdown"] = ar.get("markdown") or ""
            if ar.get("error"):
                base["autoresearch_error"] = ar["error"]
        elif not autoresearch:
            base["autoresearch_skipped"] = True

        if task_id:
            status = "completed" if base.get("success") else "failed"
            if base.get("status") == "cancelled":
                status = "cancelled"
            task_manager.update_task(
                task_id,
                status=status,
                progress=100 if status == "completed" else None,
                result=base,
                message=(
                    "Agent-S 会话完成"
                    if status == "completed"
                    else (base.get("error") or "Agent-S 会话失败")
                ),
            )
        return base
    except Exception as exc:
        logger.error("Agent-S session failed", exc_info=True)
        if task_id:
            task_manager.update_task(task_id, status="failed", error=str(exc)[:1000])
        return {"success": False, "error": str(exc)[:1000], "rounds": rounds_out, "engine": "agent_s"}
    finally:
        if claimed:
            _release_computer_use_task(task_id)
