"""Single-step vision planner (Agent-S Worker pattern without gui-agents)."""

from __future__ import annotations

import base64
import json
import re
from typing import Any, Dict, List, Optional, Tuple

from openai import OpenAI

from core.llm_provider import resolve_vision_credentials
from utils.logger import setup_logger

logger = setup_logger("agent_s.planner")

_PLANNER_SYSTEM = """你是浏览器 GUI 自动化 Worker（Agent-S 单步模式）。
根据用户目标、历史步骤与当前页面截图，只输出 **一个** 下一步动作 JSON 对象（不要 Markdown、不要数组、不要解释）。

允许的动作：
- {"action":"click","target":"用自然语言描述要点击的控件"}
- {"action":"type","text":"要输入的文字"}
- {"action":"scroll","direction":"down|up","amount":400}
- {"action":"wait","ms":2000}
- {"action":"press","key":"Enter"}
- {"action":"done","summary":"任务完成说明"}
- {"action":"fail","reason":"无法继续的原因"}

规则：
1. 每步只做一件事；搜索类任务用 **type** 输入查询词（不要反复 click 搜索框），再 **press Enter**，然后 **wait**。
2. 若历史已连续 click 搜索框 2 次以上，下一步必须是 type，禁止再 click。
3. 若 server_bootstrap 已自动搜索，优先 wait/scroll，不要重复 type 同一查询词。
4. 页面仍是空白搜索首页时禁止 done。
5. DuckDuckGo HTML 版：用 type 填词，不要 click 占位 div。
6. 只输出一个 JSON 对象。"""

_REFLECTION_SYSTEM = """你是 Agent-S Reflection 模块。根据目标、上一步计划与执行结果，用 1-3 句中文复盘：发生了什么、是否成功、下一步应注意什么。不要输出 JSON。"""


def _extract_json_object(raw: str) -> Optional[Dict[str, Any]]:
    text = (raw or "").strip()
    m = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text)
    if m:
        text = m.group(1).strip()
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        text = text[start : end + 1]
    try:
        obj = json.loads(text)
        return obj if isinstance(obj, dict) else None
    except Exception:
        return None


def _plan_next_action_sync(
    *,
    goal: str,
    screenshot_png: bytes,
    step_index: int,
    history: List[Dict[str, Any]],
    page_url: str = "",
    page_title: str = "",
    page_digest: Optional[Dict[str, Any]] = None,
    bootstrap_query: Optional[str] = None,
) -> Tuple[Dict[str, Any], str]:
    pid, model, key, cfg = resolve_vision_credentials()
    if not key:
        return (
            {"action": "fail", "reason": "未配置视觉 LLM API Key"},
            "缺少 API Key",
        )

    b64 = base64.b64encode(screenshot_png).decode("ascii")
    hist_lines = []
    for h in history[-8:]:
        act = h.get("action", "?")
        ok = h.get("ok", True)
        plan_h = h.get("plan", "")
        err = h.get("error", "")
        line = f"- step {h.get('step')}: {act} ok={ok}"
        if plan_h:
            line += f" ({plan_h})"
        if err:
            line += f" err={err}"
        hist_lines.append(line)

    digest = page_digest or {}
    excerpt = (digest.get("text_excerpt") or "")[:2000]
    inputs_hint = (digest.get("visible_inputs_hint") or "")[:800]
    bootstrap_note = ""
    if bootstrap_query:
        bootstrap_note = (
            f"\nserver_bootstrap: 服务端已自动提交搜索「{bootstrap_query}」，"
            "请优先 wait/scroll，勿重复填同一词。\n"
        )

    user_text = (
        f"用户目标: {goal}\n"
        f"当前步: {step_index + 1}\n"
        f"页面: {page_title} ({page_url})\n"
        f"正文摘录: {excerpt[:1200]}\n"
        f"可填控件: {inputs_hint}\n"
        f"{bootstrap_note}"
        f"历史:\n" + ("\n".join(hist_lines) if hist_lines else "(无)") + "\n"
        "请根据截图输出下一步动作 JSON。"
    )

    client = OpenAI(api_key=key, base_url=cfg.base_url)
    resp = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": _PLANNER_SYSTEM},
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
                    {"type": "text", "text": user_text},
                ],
            },
        ],
        max_tokens=512,
        temperature=0.2,
    )
    raw = resp.choices[0].message.content or ""
    action = _extract_json_object(raw) or {"action": "wait", "ms": 1500}
    plan = f"{action.get('action', '?')}"
    if action.get("target"):
        plan += f" · {str(action['target'])[:60]}"
    elif action.get("text"):
        plan += f" · {str(action['text'])[:40]}"
    return action, plan


async def plan_next_action(
    *,
    goal: str,
    screenshot_png: bytes,
    step_index: int,
    history: List[Dict[str, Any]],
    page_url: str = "",
    page_title: str = "",
    page_digest: Optional[Dict[str, Any]] = None,
    bootstrap_query: Optional[str] = None,
) -> Tuple[Dict[str, Any], str]:
    import asyncio

    return await asyncio.to_thread(
        _plan_next_action_sync,
        goal=goal,
        screenshot_png=screenshot_png,
        step_index=step_index,
        history=history,
        page_url=page_url,
        page_title=page_title,
        page_digest=page_digest,
        bootstrap_query=bootstrap_query,
    )


def _reflect_step_sync(*, goal: str, plan: str, result: Dict[str, Any]) -> str:
    try:
        pid, model, key, cfg = resolve_vision_credentials()
        if not key:
            return ""
        client = OpenAI(api_key=key, base_url=cfg.base_url)
        payload = json.dumps(
            {"goal": goal, "plan": plan, "result": result},
            ensure_ascii=False,
        )
        resp = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": _REFLECTION_SYSTEM},
                {"role": "user", "content": payload},
            ],
            max_tokens=256,
            temperature=0.3,
        )
        return (resp.choices[0].message.content or "").strip()
    except Exception as exc:
        logger.warning("Reflection failed: %s", exc)
        return ""


async def reflect_step(
    *,
    goal: str,
    plan: str,
    result: Dict[str, Any],
) -> str:
    import asyncio

    return await asyncio.to_thread(
        _reflect_step_sync,
        goal=goal,
        plan=plan,
        result=result,
    )
