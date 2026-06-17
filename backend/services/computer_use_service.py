"""
Computer Use：基于 Playwright 的浏览器 GUI 自动化。
由 LLM 根据页面文本摘要产出受限 JSON 步骤，服务端逐步执行并回传日志与截图。
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
import re
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from langchain_core.messages import HumanMessage, SystemMessage

from core.execution_approval import create_step_approval
from core.llm_provider import get_api_key, get_chat_llm
from utils.logger import setup_logger
from utils.task_manager import task_manager

logger = setup_logger("computer_use")

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
TEMP_DIR = PROJECT_ROOT / "storage" / "temp" / "computer_use"
TEMP_DIR.mkdir(parents=True, exist_ok=True)

try:
    from playwright.async_api import async_playwright
except ImportError:
    async_playwright = None

MAX_TEXT_FOR_LLM = 6000
MAX_STEPS_PER_ROUND = 12
MAX_TOTAL_STEPS = 48
MAX_WAIT_MS = 30_000

_RESUME_PAGE_TEXT_MAX = 12_000
_RESUME_INPUTS_MAX = 2500

_active_computer_use_tasks: set[str] = set()
_computer_use_task_lock = threading.Lock()


def _claim_computer_use_task(task_id: Optional[str]) -> bool:
    if not task_id:
        return True
    with _computer_use_task_lock:
        if task_id in _active_computer_use_tasks:
            return False
        _active_computer_use_tasks.add(task_id)
        return True


def _release_computer_use_task(task_id: Optional[str]) -> None:
    if not task_id:
        return
    with _computer_use_task_lock:
        _active_computer_use_tasks.discard(task_id)


def _is_cancelled(task_id: Optional[str]) -> bool:
    if not task_id:
        return False
    task = task_manager.get_task(task_id)
    return bool(task and task.get("cancel_requested"))


def _emit_progress(
    task_id: Optional[str],
    *,
    step: int = 0,
    max_steps: int = 15,
    plan: str = "",
    reflection: str = "",
    preview_screenshot_base64: str = "",
    stage: str = "",
    message: str = "",
) -> None:
    if not task_id:
        return
    existing = task_manager.get_task(task_id) or {}
    prev_meta = existing.get("metadata") or {}
    prev_cu = dict(prev_meta.get("computer_use") or {})
    stages = list(prev_cu.get("stages") or [])
    if stage or plan:
        stages.append(
            {
                "step": step,
                "stage": stage,
                "plan": plan,
                "reflection": reflection,
                "at": time.time(),
            }
        )
        if len(stages) > 50:
            stages = stages[-50:]
    prev_cu.update(
        {
            "current_step": step,
            "max_steps": max_steps,
            "last_plan": plan,
            "last_reflection": reflection,
            "preview_screenshot_base64": preview_screenshot_base64,
            "current_stage": stage or f"step_{step}",
            "stages": stages,
        }
    )
    progress = min(95, int(5 + (step / max(max_steps, 1)) * 90))
    task_manager.update_task(
        task_id,
        status="running",
        progress=progress,
        message=message or (f"第 {step} 步 · {plan[:80]}" if plan else "执行中"),
        metadata={"computer_use": prev_cu},
    )


async def dispatch_computer_use_session(
    goal: str,
    start_url: str,
    **kwargs: Any,
) -> Dict[str, Any]:
    """Route to Agent-S or legacy engine based on COMPUTER_USE_ENGINE."""
    from services.agent_s.config import get_engine

    engine = get_engine()
    if engine == "legacy":
        return await run_computer_use_session(goal, start_url, **kwargs)
    try:
        from services.agent_s.browser_runner import run_agent_s_browser_session

        return await run_agent_s_browser_session(goal, start_url, **kwargs)
    except ImportError as exc:
        logger.warning("Agent-S engine unavailable (%s), falling back to legacy", exc)
        return await run_computer_use_session(goal, start_url, **kwargs)


def _snapshot_page_context_for_resume(digest: Dict[str, Any]) -> Dict[str, Any]:
    """审批阻塞时保存页面摘要，供恢复会话时注入 planner（非像素级，仅 DOM 文本摘录）。"""
    excerpt = str(digest.get("text_excerpt") or "")[:_RESUME_PAGE_TEXT_MAX]
    return {
        "url": digest.get("url") or "",
        "title": digest.get("title") or "",
        "text_excerpt": excerpt,
        "visible_inputs_hint": str(digest.get("visible_inputs_hint") or "")[:_RESUME_INPUTS_MAX],
    }


def _approved_blocked_step_for_task(task_id: Optional[str]) -> Optional[Dict[str, Any]]:
    if not task_id:
        return None
    task = task_manager.get_task(task_id)
    if not task:
        return None
    metadata = task.get("metadata") or {}
    approved_approval_id = metadata.get("approved_approval_id")
    last_approval_id = metadata.get("last_approval_id")
    blocked_step = metadata.get("blocked_step")
    if approved_approval_id and approved_approval_id == last_approval_id and isinstance(blocked_step, dict):
        return {"approval_id": approved_approval_id, "step": blocked_step}
    return None

def _safe_http_url(url: str) -> bool:
    u = (url or "").strip().lower()
    return u.startswith("http://") or u.startswith("https://")


def _parse_steps(raw: str) -> List[Dict[str, Any]]:
    text = raw.strip()
    m = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text)
    if m:
        text = m.group(1).strip()
    arr = json.loads(text)
    if not isinstance(arr, list):
        raise ValueError("模型输出必须是 JSON 数组")
    return arr


def _sanitize_steps(steps: List[Any]) -> List[Dict[str, Any]]:
    allowed = {"goto", "wait", "click", "fill", "scroll", "press", "screenshot", "done"}
    out: List[Dict[str, Any]] = []
    for i, s in enumerate(steps[:MAX_STEPS_PER_ROUND]):
        if not isinstance(s, dict):
            continue
        action = str(s.get("action", "")).lower().strip()
        if action not in allowed:
            logger.warning(f"跳过未知 action: {action}")
            continue
        item: Dict[str, Any] = {"action": action}
        if action == "goto":
            url = str(s.get("url", "")).strip()
            if not _safe_http_url(url):
                continue
            item["url"] = url
        elif action == "wait":
            ms = int(s.get("ms", 1000))
            item["ms"] = max(0, min(ms, MAX_WAIT_MS))
        elif action == "click":
            sel = str(s.get("selector", "")).strip()
            if not sel or len(sel) > 500:
                continue
            item["selector"] = sel
        elif action == "fill":
            sel = str(s.get("selector", "")).strip()
            txt = str(s.get("text", ""))
            if not sel or len(sel) > 500:
                continue
            item["selector"] = sel
            item["text"] = txt[:2000]
        elif action == "scroll":
            item["delta_y"] = int(s.get("delta_y", 400))
        elif action == "press":
            key = str(s.get("key", "Enter")).strip()[:80]
            item["key"] = key
        out.append(item)
    return out


async def _digest_page(page) -> Dict[str, Any]:
    url = page.url
    try:
        title = await page.title()
    except Exception:
        title = ""
    try:
        text = await page.evaluate(
            "() => (document.body && document.body.innerText) ? document.body.innerText.slice(0, 20000) : ''"
        )
    except Exception:
        text = ""
    excerpt = (text or "")[:MAX_TEXT_FOR_LLM]
    # 给模型可填写的真实控件线索（避免对「看起来像搜索框的 div」做 fill）
    form_fields: List[str] = []
    try:
        raw_fields = await page.evaluate(
            """() => {
              const els = Array.from(document.querySelectorAll('input, textarea'));
              return els.slice(0, 40).map((el) => ({
                tag: el.tagName.toLowerCase(),
                type: el.type || '',
                id: el.id || '',
                name: el.name || '',
                ph: (el.placeholder || '').slice(0, 80),
                aria: (el.getAttribute('aria-label') || '').slice(0, 80),
                ro: el.readOnly,
                ce: el.isContentEditable,
              }));
            }"""
        )
        for it in raw_fields or []:
            if it.get("ro") or it.get("ce"):
                continue
            parts = [it.get("tag", ""), it.get("type", "")]
            if it.get("id"):
                parts.append("#" + it["id"])
            if it.get("name"):
                parts.append("name=" + it["name"])
            if it.get("ph"):
                parts.append('placeholder="' + it["ph"] + '"')
            if it.get("aria"):
                parts.append('aria="' + it["aria"] + '"')
            line = " ".join(p for p in parts if p)
            if line:
                form_fields.append(line)
    except Exception:
        pass
    fields_excerpt = "; ".join(form_fields[:25])[:2500]
    return {
        "url": url,
        "title": title,
        "text_excerpt": excerpt,
        "visible_inputs_hint": fields_excerpt or "(未枚举到 input/textarea)",
    }


# 常见搜索引擎真实输入框（DuckDuckGo HTML 版 id 最稳；Lite 用 input.query）
_SEARCH_FILL_FALLBACKS = [
    "#search_form_input_homepage",  # html.duckduckgo.com/html/
    "input.search__input",
    "input.query",  # lite.duckduckgo.com
    "#searchbox_input",
    "input[name='q']",
    "textarea[name='q']",
    "input[name='p']",
    "input[type='search']",
    "#APjFqb",
    "textarea[aria-label='Search']",
    "input[aria-label='Search']",
    "[data-testid='search-input']",
    "form[action*='search'] input[type='text']",
    "form[action*='lite'] input[type='text']",
]

_FILL_ATTACH_TIMEOUT_MS = 28_000


async def _try_fill_locator_force(page, css: str, text: str) -> bool:
    """先 attached 再滚入视区，再用 force 填写（绕过部分可见性/叠层误判）。"""
    loc = page.locator(css).first
    try:
        await loc.wait_for(state="attached", timeout=_FILL_ATTACH_TIMEOUT_MS)
        await loc.scroll_into_view_if_needed(timeout=_FILL_ATTACH_TIMEOUT_MS)
        await loc.fill(text, timeout=_FILL_ATTACH_TIMEOUT_MS, force=True)
        return True
    except Exception:
        return False


async def _fill_first_search_input_via_js(page, text: str) -> Optional[str]:
    """用 JS 写入第一个匹配的真实搜索框（应对 React/自定义控件导致 fill 失败）。"""
    sel = await page.evaluate(
        """(text) => {
          const sels = [
            '#search_form_input_homepage', 'input.search__input', 'input.query',
            '#searchbox_input', 'textarea[name="q"]', 'input[name="q"]',
            'input[type="search"]', '#APjFqb'
          ];
          for (const s of sels) {
            const el = document.querySelector(s);
            if (!el) continue;
            const tag = el.tagName;
            if (tag !== 'INPUT' && tag !== 'TEXTAREA') continue;
            if (el.disabled || el.readOnly) continue;
            el.focus();
            el.value = text;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return s;
          }
          return null;
        }""",
        text,
    )
    return sel if isinstance(sel, str) else None


async def _wait_for_any_search_input(page) -> None:
    """导航到 DuckDuckGo 后尽量等到搜索框出现在 DOM（attached）。"""
    url = (page.url or "").lower()
    if "duckduckgo.com" not in url:
        return
    for sel in (
        "#search_form_input_homepage",
        "input.query",
        "input[name=q]",
        "#searchbox_input",
    ):
        try:
            await page.wait_for_selector(sel, state="attached", timeout=12_000)
            return
        except Exception:
            continue


async def _run_fill_smart(page, selector: str, text: str) -> Dict[str, Any]:
    """
    若选择器指向真实 input/textarea 则 fill。
    否则（例如 DuckDuckGo 搜索条外层 div）不要对 div 调用 fill，优先匹配站内真实搜索框再 fill；
    最后再尝试点击原节点后键盘输入。
    """
    log: Dict[str, Any] = {"action": "fill", "ok": True, "selector": selector}
    err_chain: List[str] = []

    # 1) 用户给定选择器：attached + force fill（避免「可见性」超时）
    try:
        loc = page.locator(selector).first
        await loc.wait_for(state="attached", timeout=_FILL_ATTACH_TIMEOUT_MS)
        tag = await loc.evaluate("el => el.tagName.toLowerCase()")
        if tag in ("input", "textarea"):
            await loc.scroll_into_view_if_needed(timeout=_FILL_ATTACH_TIMEOUT_MS)
            try:
                await loc.fill(text, timeout=_FILL_ATTACH_TIMEOUT_MS, force=True)
                return log
            except Exception as e_fill:
                err_chain.append(f"fill({selector}): {str(e_fill)[:160]}")
        else:
            err_chain.append(f"{selector} 指向非表单元素: <{tag}>")
    except Exception as e0:
        err_chain.append(str(e0)[:220])

    # 2) 站内常见搜索框
    tried_fb: List[str] = []
    for fb in _SEARCH_FILL_FALLBACKS:
        if await _try_fill_locator_force(page, fb, text):
            log["fill_fallback_selector"] = fb
            return log
        tried_fb.append(fb)
    if tried_fb:
        err_chain.append("已尝试备用选择器: " + ", ".join(tried_fb[:10]))

    # 3) JS 直写 value
    js_sel = await _fill_first_search_input_via_js(page, text)
    if js_sel:
        log["fill_fallback_selector"] = f"{js_sel} (value+events via JS)"
        return log

    # 4) 点击原节点再键盘输入（最后手段）
    try:
        loc2 = page.locator(selector).first
        await loc2.wait_for(state="attached", timeout=10_000)
        await loc2.scroll_into_view_if_needed()
        await loc2.click(timeout=10_000, force=True)
        await asyncio.sleep(0.25)
        await page.keyboard.press("Control+A")
        await page.keyboard.type(text, delay=12)
        log["fill_note"] = "已尝试点击原选择器后键盘输入"
        return log
    except Exception as e_last:
        err_chain.append(f"click+type: {str(e_last)[:200]}")

    log["ok"] = False
    log["error"] = "; ".join(err_chain)[:500]
    return log


async def _run_step(page, step: Dict[str, Any], shot_counter: List[int]) -> Dict[str, Any]:
    action = step["action"]
    log: Dict[str, Any] = {"action": action, "ok": True}
    try:
        if action == "goto":
            await page.goto(step["url"], wait_until="load", timeout=60_000)
            log["url"] = page.url
            await _wait_for_any_search_input(page)
        elif action == "wait":
            await asyncio.sleep(step["ms"] / 1000.0)
        elif action == "click":
            await page.click(step["selector"], timeout=20000)
        elif action == "fill":
            fill_log = await _run_fill_smart(page, step["selector"], step["text"])
            log.update(fill_log)
            if not fill_log.get("ok", True):
                return log
        elif action == "scroll":
            await page.mouse.wheel(0, step["delta_y"])
        elif action == "press":
            await page.keyboard.press(step["key"])
        elif action == "screenshot":
            png = await page.screenshot(type="png")
            shot_counter[0] += 1
            path = TEMP_DIR / f"cu_{os.getpid()}_{shot_counter[0]}.png"
            path.write_bytes(png)
            log["screenshot_base64"] = base64.b64encode(png).decode("ascii")
        elif action == "done":
            log["done"] = True
    except Exception as e:
        log["ok"] = False
        log["error"] = str(e)[:500]
        logger.warning(f"步骤失败 {action}: {e}")
    return log


_SYSTEM = """你是「Computer Use」浏览器自动化规划器。用户会给出目标与当前页面的 URL、标题、正文摘录，以及 **visible_inputs_hint**（页面上真实可填写的 input/textarea 摘要）。若 JSON 里带有 **server_bootstrap**，说明服务端已自动提交过一次搜索，请根据当前页面继续。

你只能输出一个 JSON 数组（不要 Markdown、不要解释文字），数组元素为对象，仅允许以下 action：

- {"action":"goto","url":"https://..."}  仅允许 http/https
- {"action":"wait","ms":1000}  毫秒，最大 30000
- {"action":"click","selector":"CSS 或 Playwright 文本选择器如 text=登录"}
- {"action":"fill","selector":"...","text":"要填入的文本"}
- {"action":"scroll","delta_y":400}
- {"action":"press","key":"Enter"}
- {"action":"screenshot"}  需要给用户看当前界面时加一步
- {"action":"done"}  目标已达成或无法继续时，用单独一步 done 结束

规则：
1. 每轮最多 12 步；优先少而稳的步骤。
2. **fill 的 selector 必须是可编辑的 input、textarea**（或 contenteditable）。**严禁**对展示「Search / 搜索」占位文案的 **外层 div** 使用 fill（Playwright 会报错）。请优先使用 **visible_inputs_hint** 里出现的 **#id**、name=、或 input[type=search] 等选择器。
3. DuckDuckGo：默认起点为 **HTML 版** `https://html.duckduckgo.com/html/`（搜索框稳定）；填写用 `#search_form_input_homepage` 或 `input[name=q]`，再 `Enter`。主站营销区常有假 div，勿对占位文案 div 做 fill。Lite：`input.query`。Google：`textarea[name=q]` 或 `input[name=q]`。
4. 按钮、链接用 click + text= 可以；搜索词填写务必对准真实输入框。
5. 若信息不足，先用 screenshot 或 goto 到明确页面再继续。
6. 不要输出 goto 到非 http(s) 的地址。
7. **若用户目标含「搜索 / 查 / 天气 / 查询」等**，而当前页面仍是**仅含搜索框、几乎没有结果列表的首页**，**禁止**只输出 {"action":"done"}；必须先 **fill 查询词 → press Enter → wait 3000ms 以上**，再根据正文摘录判断是否有结果，必要时 **scroll** 后再 **screenshot**。
8. **若 `server_bootstrap.auto_submitted_query` 已存在**：说明查询词已代填并回车；你应优先 **wait** 等待结果渲染，再 **scroll**/**screenshot**；除非明确失败，否则不要重复 fill 同一查询词。
9. 达成用户目标后，最后一项必须是 {"action":"done"}。
"""


def _url_is_search_portal(url: str) -> bool:
    u = (url or "").lower()
    return any(
        h in u
        for h in (
            "duckduckgo.com",
            "google.com",
            "bing.com",
            "search.yahoo.com",
        )
    )


def _goal_suggests_web_search(goal: str) -> bool:
    g = (goal or "").strip()
    if not g:
        return False
    return bool(
        re.search(
            r"搜索|检索|查询|搜一下|查一下|查\s|查查|关键词|天气|百度|谷歌|google|bing|ddg|duck",
            g,
            re.I,
        )
    )


def _extract_query_for_search(goal: str) -> Optional[str]:
    """从任务里抽出适合放进搜索框的短查询。"""
    g = (goal or "").strip()
    for pattern in (
        r"「([^」]{1,120})」",
        r"『([^』]{1,120})』",
        r"[\"“]([^\"”]{2,80})[\"”]",
    ):
        m = re.search(pattern, g)
        if m:
            q = m.group(1).strip()
            if q:
                return q[:200]
    strip_lead = re.compile(
        r"^(请|帮我|我想|我要)?\s*(在搜索框|在框里|搜索框)?\s*(输入|填入|键入)?\s*",
        re.I,
    )
    tail = re.compile(
        r"(并搜索|然后|之后|等结果.*|截个图|截图|点击搜索|点搜索).*$",
        re.I,
    )
    g2 = strip_lead.sub("", g)
    g2 = tail.sub("", g2).strip()
    g2 = re.sub(r"\s+", " ", g2).strip()
    if 2 <= len(g2) <= 100:
        return g2[:200]
    return None


async def _run_bootstrap_search_round(
    page,
    goal: str,
    start_url: str,
    shot_counter: List[int],
) -> Optional[Dict[str, Any]]:
    """
    在搜索引擎入口页根据用户目标自动：填词 → Enter → 等待，
    避免模型在首页就 done。
    """
    if not _url_is_search_portal(start_url) or not _goal_suggests_web_search(goal):
        return None
    q = _extract_query_for_search(goal)
    if not q:
        return None

    u = start_url.lower()
    fill_sel = "input[name=q]"
    if "duckduckgo.com/html" in u:
        fill_sel = "#search_form_input_homepage"
    elif "google." in u:
        fill_sel = "textarea[name=q]"

    planned_display = [
        {"action": "fill", "selector": fill_sel, "text": q, "_bootstrap": True},
        {"action": "press", "key": "Enter", "_bootstrap": True},
        {"action": "wait", "ms": 4500, "_bootstrap": True},
    ]
    step_logs: List[Dict[str, Any]] = []

    log_fill = await _run_fill_smart(page, fill_sel, q)
    log_fill["bootstrap"] = True
    step_logs.append(log_fill)

    if log_fill.get("ok", True):
        log_enter = await _run_step(page, {"action": "press", "key": "Enter"}, shot_counter)
        log_enter["bootstrap"] = True
        step_logs.append(log_enter)
        log_wait = await _run_step(page, {"action": "wait", "ms": 4500}, shot_counter)
        log_wait["bootstrap"] = True
        step_logs.append(log_wait)
        if "duckduckgo.com/html" in u and log_enter.get("ok", True):
            try:
                sub = page.locator(
                    "input[type='submit'], input.search__button, .search__button"
                ).first
                if await sub.count() > 0 and await sub.is_visible():
                    await sub.click(timeout=5000)
                    await asyncio.sleep(1.0)
                    step_logs.append(
                        {"action": "click_submit_fallback", "ok": True, "bootstrap": True}
                    )
            except Exception:
                pass

    return {
        "round": 0,
        "bootstrap_auto_search": True,
        "bootstrap_query": q,
        "planned_steps": planned_display,
        "steps_logs": step_logs,
    }


_AUTORESEARCH_SYSTEM = """你是「Computer Use 自动研究」分析模块。你只根据输入中的【用户目标】与【最终页面文本摘录】做推理与归纳；不得编造摘录中不存在的具体事实（如精确数字、未出现的人名/日期）。摘录不足时必须写「摘录中未显示」。

请用 **Markdown** 输出，且必须包含以下二级标题（##）：

## 执行摘要
用 2–5 句说明自动化大致完成了什么、最终停在什么 URL/页面类型。

## 页面可核验要点
从 `text_excerpt` 中归纳可核对的信息，使用短列表；若几乎无正文则写「正文过少」。

## 搜索结果条目（若有 `search_results`）
当输入包含 `search_results` 数组时，**必须**逐条归纳标题与摘要要点（可标注来源 URL），按相关性排序；不得忽略该列表只写泛泛结论。

## 针对用户目标的结论
结合用户目标与摘录给出推理、判断或整理结果；若只能推测，标明「推测」及依据。

## 建议的后续检索
列出 3–6 条用户可继续搜索的关键词、子问题或应打开的页面类型（本模块不能联网，仅建议）。

## 局限与声明
说明：仅基于单次会话内可见页面文本、非全站爬取、截图不做 OCR；不能代替实时联网检索。

使用中文。不要输出 JSON 或代码围栏包裹全文。"""


def _summarize_rounds(rounds_out: List[Dict[str, Any]]) -> str:
    if not rounds_out:
        return "（无轮次记录）"
    parts: List[str] = []
    for r in rounds_out[:12]:
        if r.get("bootstrap_auto_search"):
            q = r.get("bootstrap_query") or ""
            parts.append(f"服务端自动搜索「{q}」")
            continue
        ri = r.get("round", "?")
        logs = r.get("steps_logs") or []
        n_ok = sum(1 for x in logs if x.get("ok") is not False and x.get("action") != "limit")
        parts.append(f"第{ri}轮共{len(logs)}步，约{n_ok}步未报错")
    return "；".join(parts)


async def _run_autoresearch_report(
    goal: str,
    final_digest: Dict[str, Any],
    rounds_summary: str,
    *,
    search_results: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Optional[str]]:
    out: Dict[str, Optional[str]] = {"markdown": "", "error": None}
    try:
        llm = get_chat_llm(temperature=0.35)
        body: Dict[str, Any] = {
            "user_goal": goal,
            "rounds_summary": rounds_summary,
            "final_page": {
                "url": final_digest.get("url"),
                "title": final_digest.get("title"),
                "text_excerpt": (final_digest.get("text_excerpt") or "")[:14_000],
                "visible_inputs_hint": (final_digest.get("visible_inputs_hint") or "")[:2500],
            },
        }
        if search_results:
            body["search_results"] = search_results[:12]
        payload = json.dumps(body, ensure_ascii=False)
        msg = await llm.ainvoke(
            [SystemMessage(content=_AUTORESEARCH_SYSTEM), HumanMessage(content=payload)]
        )
        raw = (msg.content or "").strip()
        if isinstance(raw, list):
            raw = "".join(
                p.get("text", "") if isinstance(p, dict) else str(p) for p in raw
            )
        out["markdown"] = raw or ""
    except Exception as e:
        logger.warning("Autoresearch 报告生成失败", exc_info=True)
        out["error"] = str(e)[:600]
    return out


async def run_computer_use_session(
    goal: str,
    start_url: str,
    max_rounds: int = 4,
    headless: bool = True,
    autoresearch: bool = True,
    require_approval: bool = False,
    task_id: Optional[str] = None,
    trace_id: Optional[str] = None,
    resume_navigation_url: Optional[str] = None,
    resume_page_context: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    if not get_api_key():
        return {
            "success": False,
            "error": "未配置 LLM API Key，无法规划步骤。请在 backend/.env 中配置当前供应商的 Key。",
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
    rounds_out: List[Dict[str, Any]] = []
    if task_id:
        if not _claim_computer_use_task(task_id):
            return {
                "success": False,
                "error": "该 Computer Use 任务已在执行中，请稍后再试。",
                "status": "busy",
            }
        claimed = True

    try:
        if task_id:
            task_manager.update_task(
                task_id,
                status="running",
                progress=5,
                message="Computer Use 会话启动",
                metadata={
                    "goal": goal,
                    "start_url": start_url,
                    "require_approval": require_approval,
                    "engine": "legacy",
                },
            )
            _emit_progress(task_id, step=0, max_steps=MAX_TOTAL_STEPS, stage="launch", message="启动 Chromium")

        max_rounds = max(1, min(int(max_rounds), 8))
        rounds_out = []
        total_steps = 0
        shot_counter = [0]
        approved_blocked_step = _approved_blocked_step_for_task(task_id)
        approved_step_consumed = False

        llm = get_chat_llm(temperature=0.2)

        initial_nav_url = str(start_url).strip()
        if resume_nav_ok:
            initial_nav_url = str(resume_navigation_url).strip()
        skip_bootstrap = resume_nav_ok

        # 避免 Chromium 首次解压/启动无限挂死
        _PLAYWRIGHT_LAUNCH_TIMEOUT_MS = 90_000

        async with async_playwright() as p:
            browser = await p.chromium.launch(
                headless=headless,
                timeout=_PLAYWRIGHT_LAUNCH_TIMEOUT_MS,
                args=[
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                    "--disable-blink-features=AutomationControlled",
                ],
            )
            context = await browser.new_context(
                viewport={"width": 1280, "height": 800},
                locale="zh-CN",
                user_agent=(
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                ),
            )
            page = await context.new_page()
            await page.goto(initial_nav_url, wait_until="load", timeout=60_000)
            await _wait_for_any_search_input(page)

            bootstrap_query: Optional[str] = None
            if not skip_bootstrap:
                bs_round = await _run_bootstrap_search_round(
                    page, goal.strip(), start_url, shot_counter
                )
                if bs_round:
                    rounds_out.append(bs_round)
                    total_steps += len(bs_round.get("steps_logs") or [])
                    _bl = bs_round.get("steps_logs") or []
                    if _bl and _bl[0].get("ok", True):
                        bootstrap_query = bs_round.get("bootstrap_query")

            for round_idx in range(max_rounds):
                if _is_cancelled(task_id):
                    await context.close()
                    await browser.close()
                    if task_id:
                        task_manager.update_task(task_id, status="cancelled", message="用户已取消")
                    return {
                        "success": False,
                        "status": "cancelled",
                        "error": "任务已取消",
                        "rounds": rounds_out,
                        "total_steps_executed": total_steps,
                        "engine": "legacy",
                    }

                digest = await _digest_page(page)
                planner_payload: Dict[str, Any] = {
                    "goal": goal,
                    "round": round_idx + 1,
                    "max_rounds": max_rounds,
                    "page": digest,
                }
                if bootstrap_query:
                    planner_payload["server_bootstrap"] = {
                        "auto_submitted_query": bootstrap_query,
                        "hint": "服务端已在搜索入口页自动填写该查询并回车（必要时点击了搜索按钮）。请优先 wait/scroll/screenshot，不要无故重复 fill 同一查询词。",
                    }
                if (
                    resume_page_context
                    and round_idx == 0
                    and (
                        resume_page_context.get("url")
                        or resume_page_context.get("title")
                        or resume_page_context.get("text_excerpt")
                    )
                ):
                    planner_payload["resume_from_approval"] = {
                        "note": (
                            "会话由审批通过后恢复：已导航到阻塞时的 URL。"
                            "以下为阻塞前保存的页面文本/控件摘要，实际 DOM 可能略有变化；"
                            "请勿假设历史浏览器进程仍存在。"
                        ),
                        "snapshot_url": resume_page_context.get("url"),
                        "snapshot_title": resume_page_context.get("title"),
                        "snapshot_text_excerpt": resume_page_context.get("text_excerpt"),
                        "snapshot_visible_inputs_hint": resume_page_context.get("visible_inputs_hint"),
                    }
                user_block = json.dumps(planner_payload, ensure_ascii=False)
                msg = await llm.ainvoke(
                    [SystemMessage(content=_SYSTEM), HumanMessage(content=user_block)]
                )
                raw = (msg.content or "").strip()
                if isinstance(raw, list):
                    raw = "".join(
                        p.get("text", "") if isinstance(p, dict) else str(p) for p in raw
                    )

                try:
                    raw_steps = _parse_steps(raw)
                except Exception as e:
                    rounds_out.append(
                        {
                            "round": round_idx + 1,
                            "parse_error": str(e),
                            "raw_preview": raw[:800],
                            "steps_logs": [],
                        }
                    )
                    break

                steps = _sanitize_steps(raw_steps)
                step_logs: List[Dict[str, Any]] = []
                stopped = False

                preview_png = await page.screenshot(type="png")
                preview_b64 = base64.b64encode(preview_png).decode("ascii")
                _emit_progress(
                    task_id,
                    step=total_steps + 1,
                    max_steps=MAX_TOTAL_STEPS,
                    plan=f"round {round_idx + 1} · {len(steps)} steps planned",
                    preview_screenshot_base64=preview_b64,
                    stage="planning",
                    message=f"第 {round_idx + 1} 轮规划",
                )

                for step_idx, st in enumerate(steps):
                    if _is_cancelled(task_id):
                        step_logs.append({"action": "cancelled", "ok": False})
                        stopped = True
                        break
                    if total_steps >= MAX_TOTAL_STEPS:
                        step_logs.append(
                            {"action": "limit", "ok": False, "error": "已达到全局最大步数"}
                        )
                        stopped = True
                        break
                    if st["action"] == "done":
                        step_logs.append({"action": "done", "ok": True})
                        stopped = True
                        break
                    skip_approval = False
                    if (
                        require_approval
                        and approved_blocked_step
                        and not approved_step_consumed
                        and st == approved_blocked_step.get("step")
                    ):
                        skip_approval = True
                        approved_step_consumed = True
                    if require_approval:
                        digest_at_block: Optional[Dict[str, Any]] = None
                        if not skip_approval:
                            digest_at_block = await _digest_page(page)
                        approval = None if skip_approval else create_step_approval(
                            step=st,
                            round_idx=round_idx,
                            step_idx=step_idx,
                            goal=goal,
                            task_id=task_id,
                            trace_id=trace_id,
                        )
                        if approval:
                            page_snap = (
                                _snapshot_page_context_for_resume(digest_at_block)
                                if digest_at_block
                                else {}
                            )
                            blocked_url = str(page_snap.get("url") or "")
                            resume_nav_saved = (
                                blocked_url if _safe_http_url(blocked_url) else start_url
                            )
                            if task_id:
                                task_manager.update_task(
                                    task_id,
                                    status="waiting_approval",
                                    metadata={
                                        "preview_screenshot_base64": preview_b64,
                                        "computer_use": {
                                            "last_plan": st.get("action", ""),
                                            "preview_screenshot_base64": preview_b64,
                                        },
                                        "computer_use_resume": {
                                            "goal": goal,
                                            "start_url": start_url,
                                            "max_rounds": max_rounds,
                                            "headless": headless,
                                            "autoresearch": autoresearch,
                                            "require_approval": require_approval,
                                            "trace_id": trace_id,
                                            "approval_id": approval["id"],
                                            "blocked_round": round_idx + 1,
                                            "blocked_step": step_idx + 1,
                                            "page_context_at_block": page_snap,
                                            "resume_navigation_url": resume_nav_saved,
                                        }
                                    },
                                )
                            blocked_log = {
                                "action": st["action"],
                                "ok": False,
                                "requires_approval": True,
                                "approval_id": approval["id"],
                                "capability_id": approval["capability_id"],
                                "risk_level": approval["risk_level"],
                            }
                            step_logs.append(blocked_log)
                            rounds_out.append(
                                {
                                    "round": round_idx + 1,
                                    "planned_steps": steps,
                                    "steps_logs": step_logs,
                                    "waiting_approval": True,
                                    "approval_id": approval["id"],
                                }
                            )
                            await context.close()
                            await browser.close()
                            return {
                                "success": False,
                                "status": "waiting_approval",
                                "requires_approval": True,
                                "approval": approval,
                                "rounds": rounds_out,
                                "total_steps_executed": total_steps,
                            }
                    total_steps += 1
                    _emit_progress(
                        task_id,
                        step=total_steps,
                        max_steps=MAX_TOTAL_STEPS,
                        plan=str(st.get("action", "")),
                        preview_screenshot_base64=preview_b64,
                        stage=str(st.get("action", "")),
                        message=f"第 {total_steps} 步 · {st.get('action', '')}",
                    )
                    log_entry = await _run_step(page, st, shot_counter)
                    if skip_approval:
                        log_entry["approval_reused"] = True
                        log_entry["approval_id"] = approved_blocked_step.get("approval_id")
                    step_logs.append(log_entry)
                    if not log_entry.get("ok", True):
                        stopped = True
                        break

                rounds_out.append(
                    {
                        "round": round_idx + 1,
                        "planned_steps": steps,
                        "steps_logs": step_logs,
                    }
                )

                if stopped:
                    break

            # 截图前再抓一次页面文本，供自动研究与截图一致
            final_digest = await _digest_page(page)
            final_png = await page.screenshot(type="png")
            final_b64 = base64.b64encode(final_png).decode("ascii")
            await context.close()
            await browser.close()

        base: Dict[str, Any] = {
            "success": True,
            "engine": "legacy",
            "rounds": rounds_out,
            "final_screenshot_base64": final_b64,
            "total_steps_executed": total_steps,
            "final_page_context": {
                "url": final_digest.get("url", ""),
                "title": final_digest.get("title", ""),
                "text_excerpt_preview": (final_digest.get("text_excerpt") or "")[:4000],
            },
        }
        if autoresearch:
            if not get_api_key():
                base["autoresearch_markdown"] = ""
                base["autoresearch_error"] = "未配置 LLM API Key，跳过自动研究"
            else:
                ar = await _run_autoresearch_report(
                    goal, final_digest, _summarize_rounds(rounds_out)
                )
                base["autoresearch_markdown"] = ar.get("markdown") or ""
                if ar.get("error"):
                    base["autoresearch_error"] = ar["error"]
        else:
            base["autoresearch_markdown"] = ""
            base["autoresearch_skipped"] = True
        if task_id:
            task_manager.update_task(
                task_id,
                status="completed",
                progress=100,
                result=base,
                message="Computer Use 会话完成",
            )
        return base
    except Exception as e:
        logger.error("Computer Use 会话失败", exc_info=True)
        if task_id:
            task_manager.update_task(task_id, status="failed", error=str(e)[:1000])
        return {"success": False, "error": str(e)[:1000], "rounds": rounds_out}
    finally:
        if claimed:
            _release_computer_use_task(task_id)

