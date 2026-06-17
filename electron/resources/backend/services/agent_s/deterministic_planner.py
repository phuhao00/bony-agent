"""Rule-based planner for search portals — runs before vision LLM."""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple

from services.agent_s.result_extractor import digest_indicates_search_results
from services.computer_use_service import (
    _extract_query_for_search,
    _goal_suggests_web_search,
    _url_is_search_portal,
)

_SEARCH_INPUT_KW = re.compile(
    r"搜索|search|输入框|query|textbox|text field|搜索框",
    re.I,
)

_MAX_SUBMIT_RETRIES = 2


def _history_has_ok_action(history: List[Dict[str, Any]], action: str) -> bool:
    return any(
        str(h.get("action", "")).lower() == action and h.get("ok") is not False
        for h in history
    )


def _scroll_count(history: List[Dict[str, Any]]) -> int:
    return sum(
        1
        for h in history
        if str(h.get("action")) == "scroll" and h.get("ok") is not False
    )


def _has_result_screenshot(history: List[Dict[str, Any]]) -> bool:
    return any(
        h.get("screenshot_base64")
        for h in history
        if h.get("ok") is not False and str(h.get("action")) == "screenshot"
    )


def _has_extracted_results(history: List[Dict[str, Any]]) -> bool:
    return any(
        str(h.get("action")) == "extract_results"
        and h.get("ok") is not False
        and int(h.get("count") or 0) > 0
        for h in history
    )


def _extract_attempt_count(history: List[Dict[str, Any]]) -> int:
    return sum(1 for h in history if str(h.get("action")) == "extract_results")


def _last_extract_count(history: List[Dict[str, Any]]) -> int:
    for h in reversed(history):
        if str(h.get("action")) == "extract_results":
            return int(h.get("count") or 0)
    return -1


def _post_bootstrap_wait_count(history: List[Dict[str, Any]]) -> int:
    return sum(
        1
        for h in history
        if str(h.get("action")) == "wait"
        and h.get("ok") is not False
        and not h.get("bootstrap")
    )


def _submit_retry_count(history: List[Dict[str, Any]]) -> int:
    return sum(
        1
        for h in history
        if str(h.get("action")) in {"press", "click_submit_retry"}
        and h.get("ok") is not False
        and h.get("retry_search")
    )


def _repeated_click_search_box(history: List[Dict[str, Any]], n: int = 2) -> bool:
    clicks = [
        h
        for h in history[-6:]
        if str(h.get("action", "")).lower() == "click"
        and _SEARCH_INPUT_KW.search(str(h.get("target") or h.get("plan") or ""))
    ]
    return len(clicks) >= n


def _goal_wants_screenshot(goal: str) -> bool:
    return bool(re.search(r"截图|截个图|screenshot|截屏", goal, re.I))


def _finalize_search_flow(
    *,
    goal: str,
    query: str,
    history: List[Dict[str, Any]],
    page_digest: Optional[Dict[str, Any]] = None,
    post_bootstrap: bool = False,
) -> Optional[Tuple[Dict[str, Any], str]]:
    """
    After search submitted: verify results → wait → scroll ×2 → extract → screenshot → done.
    Never done without extracted result items.
    """
    digest = page_digest or {}
    post_wait = _post_bootstrap_wait_count(history)
    scrolled = _scroll_count(history)
    has_shot = _has_result_screenshot(history)
    extracted = _has_extracted_results(history)
    retries = _submit_retry_count(history)

    has_results = digest_indicates_search_results(digest, query)

    if not has_results:
        if retries < _MAX_SUBMIT_RETRIES:
            return {
                "action": "click_submit_retry",
                "retry_search": True,
            }, "press · 重新提交搜索（结果未加载）"
        return {
            "action": "fail",
            "reason": f"搜索「{query}」后未检测到结果页内容，请检查网络或起始 URL",
        }, "fail · 无搜索结果"

    if post_bootstrap and post_wait < 1:
        return {"action": "wait", "ms": 4000}, "wait · 等待搜索结果渲染"

    if post_wait < 1 and not post_bootstrap:
        return {"action": "wait", "ms": 4000}, "wait · 等待搜索结果渲染"

    if scrolled < 2:
        return {
            "action": "scroll",
            "direction": "down",
            "amount": 520,
        }, f"scroll · 浏览结果 ({scrolled + 1}/2)"

    if not extracted:
        attempts = _extract_attempt_count(history)
        last_count = _last_extract_count(history)
        if last_count == 0 and scrolled < 4:
            return {
                "action": "scroll",
                "direction": "down",
                "amount": 520,
            }, f"scroll · 继续浏览以加载更多结果 ({scrolled + 1}/4)"
        if attempts >= 3:
            return {
                "action": "fail",
                "reason": f"已在结果页滚动浏览，但未能提取「{query}」的有效搜索结果条目",
            }, "fail · 提取结果失败"
        return {"action": "extract_results"}, "extract · 提取搜索结果条目"

    if _goal_wants_screenshot(goal) and not has_shot:
        return {"action": "screenshot"}, "screenshot · 截取结果页"

    count = next(
        (int(h.get("count") or 0) for h in history if h.get("action") == "extract_results"),
        0,
    )
    return {
        "action": "done",
        "summary": f"已搜索「{query}」，提取 {count} 条结果并生成报告",
    }, f"done · 已分析 {count} 条结果"


def plan_deterministic_action(
    *,
    goal: str,
    page_url: str,
    history: List[Dict[str, Any]],
    bootstrap_query: Optional[str] = None,
    page_digest: Optional[Dict[str, Any]] = None,
) -> Optional[Tuple[Dict[str, Any], str]]:
    """
    Return (action, plan_summary) when we can skip vision LLM.
    """
    if not _url_is_search_portal(page_url) or not _goal_suggests_web_search(goal):
        if _repeated_click_search_box(history):
            q = _extract_query_for_search(goal)
            if q:
                return {"action": "type", "text": q}, f"type · {q[:40]}（纠正重复点击）"
        return None

    query = bootstrap_query or _extract_query_for_search(goal)
    if not query:
        return None

    typed = _history_has_ok_action(history, "type") or _history_has_ok_action(history, "fill")
    pressed = _history_has_ok_action(history, "press")
    bootstrap_wait = sum(
        1
        for h in history
        if str(h.get("action")) == "wait" and h.get("ok") is not False and h.get("bootstrap")
    )

    if bootstrap_query and (pressed or bootstrap_wait > 0):
        return _finalize_search_flow(
            goal=goal,
            query=bootstrap_query,
            history=history,
            page_digest=page_digest,
            post_bootstrap=True,
        )

    if not typed or _repeated_click_search_box(history, 1):
        return {"action": "type", "text": query}, f"type · {query[:40]}"

    if typed and not pressed:
        return {"action": "press", "key": "Enter"}, "press · Enter"

    if pressed:
        return _finalize_search_flow(
            goal=goal,
            query=query,
            history=history,
            page_digest=page_digest,
            post_bootstrap=False,
        )

    return None
