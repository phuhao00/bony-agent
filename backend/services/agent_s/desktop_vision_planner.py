"""Vision planner for native PC desktop GUI (semantic actions, no coordinates)."""

from __future__ import annotations

import base64
import json
import re
from typing import Any, Dict, List, Optional, Tuple

from openai import OpenAI

from core.llm_provider import resolve_vision_credentials
from utils.logger import setup_logger

logger = setup_logger("agent_s.desktop_planner")

_DESKTOP_PLANNER_SYSTEM = """你是 macOS **原生 PC 软件** GUI 自动化 Worker（不是浏览器）。
根据用户目标、目标应用、前台应用、历史步骤、操作手册与当前屏幕截图，只输出 **一个** JSON 动作。

## 重要：这是 PC 桌面应用，不是网页
- 操作 Lark、Photoshop、Finder 等本机软件窗口
- click 动作使用 **target** 自然语言描述控件，**不要输出 x/y 坐标**
- 坐标由独立的 Grounding 模块处理

## 允许动作（必须含 reason）
- {"action":"click","target":"左侧云文档图标","reason":"进入文档模块"}
- {"action":"type","text":"要输入的文字","reason":"填写标题"}
- {"action":"hotkey","keys":["command","n"],"reason":"快捷键新建"}
- {"action":"wait","ms":1500,"reason":"等待界面加载"}
- {"action":"done","summary":"任务完成说明","reason":"已看到目标界面"}
- {"action":"fail","reason":"无法继续的原因"}

## 规则
1. **以截图为最高依据**。截图可能只包含**单个显示器**（多屏环境下已自动截取目标应用所在屏幕）。
2. 系统「前台应用」可能显示「未知」——不要因此 fail；根据截图判断。
3. 若指定了目标应用：截图中能看到该应用界面即可继续操作。
4. 仅当截图中明确是其他软件且完全看不到目标应用界面时，才 fail。
5. 每步只做一件事；禁止连续重复相同 target。
6. Lark/飞书创建文档：云文档 → + → 文档。勿点 IDE 的 New Agent。
7. 确认目标达成后再 done。
8. 只输出一个 JSON 对象。"""


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


def format_desktop_plan(action: Dict[str, Any]) -> str:
    name = str(action.get("action") or "?").lower()
    reason = str(action.get("reason") or action.get("summary") or "").strip()
    parts: List[str] = [name]

    if name == "click":
        target = str(action.get("target") or action.get("description") or "")
        if target:
            parts.append(target[:60])
    elif name in {"type", "fill"}:
        text = str(action.get("text") or "")
        if text:
            parts.append(f'"{text[:40]}"')
    elif name == "hotkey":
        keys = action.get("keys") or []
        if keys:
            parts.append("+".join(str(k) for k in keys))
    elif name == "wait":
        ms = action.get("ms")
        if ms is not None:
            parts.append(f"{ms}ms")
    elif name == "done":
        summary = str(action.get("summary") or "")
        if summary:
            parts.append(summary[:60])
    elif name == "fail":
        parts.append(str(action.get("reason") or "失败")[:80])

    label = " · ".join(parts)
    if reason and reason not in label:
        label = f"{label} — {reason[:80]}"
    return label


def _action_signature(action: Dict[str, Any]) -> str:
    name = str(action.get("action") or "").lower()
    if name == "click":
        return f"click:{str(action.get('target') or '')[:40]}"
    if name == "hotkey":
        keys = action.get("keys") or []
        return f"hotkey:{','.join(str(k) for k in keys)}"
    if name in {"type", "fill"}:
        return f"type:{str(action.get('text') or '')[:30]}"
    if name == "wait":
        return f"wait:{action.get('ms')}"
    return name


def detect_stuck_loop(history: List[Dict[str, Any]], action: Dict[str, Any], *, threshold: int = 2) -> bool:
    sig = _action_signature(action)
    if not sig or sig in {"done", "fail"}:
        return False
    recent = [
        _action_signature({"action": h.get("action"), **{k: h.get(k) for k in ("target", "keys", "text", "ms")}})
        for h in history[-threshold:]
        if h.get("action") not in {"done", "fail"}
    ]
    if len(recent) >= threshold and all(s == sig for s in recent):
        return True
    no_progress = sum(1 for h in history[-threshold:] if h.get("no_progress"))
    return no_progress >= threshold


def _is_premature_unknown_foreground_fail(action: Dict[str, Any], foreground: str) -> bool:
    if str(action.get("action") or "").lower() != "fail":
        return False
    if foreground:
        return False
    reason = str(action.get("reason") or "").lower()
    markers = ("未知", "无法确认", "不能确认", "不确定", "unknown", "无法执行")
    return any(m in reason for m in markers)


def plan_desktop_action(
    *,
    goal: str,
    app_hint: str,
    screenshot_png: bytes,
    step_index: int,
    history: List[Dict[str, Any]],
    app_memory_hint: str = "",
    foreground_app: str = "",
    app_running_hint: str = "",
    screen_width: int = 0,
    screen_height: int = 0,
) -> Tuple[Dict[str, Any], str, str]:
    """Returns (action, plan_label, planner_raw)."""
    _pid, model, key, cfg = resolve_vision_credentials()
    if not key or not screenshot_png:
        return (
            {"action": "fail", "reason": "未配置视觉 LLM API Key 或截屏失败"},
            "fail · 缺少 API Key",
            "",
        )

    b64 = base64.b64encode(screenshot_png).decode("ascii")
    hist_lines = []
    for h in history[-8:]:
        act = h.get("action", "?")
        ok = h.get("ok", True)
        plan_h = h.get("plan", "")
        err = h.get("error", "")
        line = f"- step {h.get('index')}: {act} ok={ok}"
        if plan_h:
            line += f" ({plan_h})"
        if err:
            line += f" err={err}"
        if h.get("no_progress"):
            line += " [界面无变化]"
        hist_lines.append(line)

    memory_block = f"\n{app_memory_hint}\n" if app_memory_hint else ""
    sw = screen_width or 1920
    sh = screen_height or 1080
    fg_unknown = not (foreground_app or "").strip()
    running_block = f"进程/窗口检测: {app_running_hint}\n" if app_running_hint else ""
    fg_note = ""
    if fg_unknown:
        fg_note = (
            "【重要】系统前台检测不可用，请完全依据截图判断目标应用是否可见并操作，"
            "不要因前台「未知」而 fail。\n"
        )

    user_text = (
        f"用户目标: {goal}\n"
        f"目标应用: {app_hint or '(前台应用)'}\n"
        f"系统检测前台应用: {foreground_app or '未知（请用截图判断）'}\n"
        f"{running_block}"
        f"{fg_note}"
        f"截图尺寸: {sw} x {sh} 像素\n"
        f"当前步: {step_index + 1}\n"
        f"历史:\n" + ("\n".join(hist_lines) if hist_lines else "(无)") + "\n"
        f"{memory_block}"
        "请根据截图输出下一步语义动作 JSON（click 用 target，不要 x/y）。"
    )

    raw = ""
    try:
        client = OpenAI(api_key=key, base_url=cfg.base_url)
        resp = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": _DESKTOP_PLANNER_SYSTEM},
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
            timeout=45,
        )
        raw = resp.choices[0].message.content or ""
        action = _extract_json_object(raw) or {"action": "wait", "ms": 1200, "reason": "等待界面响应"}
    except Exception as exc:
        logger.warning("Desktop vision planner failed: %s", exc)
        action = {"action": "fail", "reason": f"视觉规划失败: {exc}"}

    if detect_stuck_loop(history, action):
        action = {
            "action": "fail",
            "reason": (
                f"重复执行 {_action_signature(action)} 无进展。"
                "请确认目标应用窗口在可见显示器上且未被遮挡；多屏用户请把应用切到前台后重试"
            ),
        }

    if _is_premature_unknown_foreground_fail(action, foreground_app):
        logger.warning("Planner rejected unknown-foreground fail; retrying with screenshot-first hint")
        retry_text = user_text + (
            "\n\n上次你因前台未知而 fail，这是错误的。"
            "请重新查看截图：若能看到目标应用界面，输出 click/hotkey 等具体操作，不要 fail。"
        )
        try:
            client = OpenAI(api_key=key, base_url=cfg.base_url)
            resp = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": _DESKTOP_PLANNER_SYSTEM},
                    {
                        "role": "user",
                        "content": [
                            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
                            {"type": "text", "text": retry_text},
                        ],
                    },
                ],
                max_tokens=512,
                temperature=0.2,
                timeout=45,
            )
            raw = resp.choices[0].message.content or raw
            retry_action = _extract_json_object(raw)
            if retry_action and not _is_premature_unknown_foreground_fail(retry_action, foreground_app):
                action = retry_action
        except Exception as exc:
            logger.warning("Planner retry after unknown-foreground fail failed: %s", exc)

    plan = format_desktop_plan(action)
    return action, plan, raw
