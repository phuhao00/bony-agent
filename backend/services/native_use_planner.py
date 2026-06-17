"""Vision planner for native desktop GUI automation."""

from __future__ import annotations

import base64
import json
import re
from typing import Any, Dict, List, Optional, Tuple

from openai import OpenAI

from core.llm_provider import resolve_vision_credentials
from utils.logger import setup_logger

logger = setup_logger("native_use_planner")

_NATIVE_PLANNER_SYSTEM = """你是 macOS 桌面 GUI 自动化 Worker（使用通义 Qwen-VL 视觉理解）。
根据用户目标、目标应用、前台应用、历史步骤、操作手册与当前屏幕截图，只输出 **一个** JSON 动作（不要 Markdown、不要解释）。

## 坐标系（重要）
- 截图尺寸会在用户消息中给出（宽 W × 高 H 像素）。
- click 的 x、y 必须使用 **0-1000 归一化坐标**（相对截图宽高，左上角为 0,0，右下角为 1000,1000）。
- 例：点击截图水平正中、垂直 1/4 处 → {"action":"click","x":500,"y":250,...}

## 允许动作（必须含 reason 字段）
- {"action":"click","x":500,"y":400,"reason":"点击云文档入口"}
- {"action":"type","text":"要输入的文字","reason":"填写标题"}
- {"action":"hotkey","keys":["command","n"],"reason":"快捷键新建"}
- {"action":"wait","ms":1500,"reason":"等待加载"}
- {"action":"done","summary":"任务完成说明","reason":"已看到目标界面"}
- {"action":"fail","reason":"无法继续的原因"}

## 规则
1. **先确认截图中目标应用是否在前台**。若用户指定了目标应用但截图显示的是其他软件（如 Cursor、VS Code、浏览器），必须输出 fail，reason 说明「当前前台不是目标应用，请先切换窗口」。
2. 每步只做一件事；先观察截图再决定，**禁止连续重复相同坐标点击**。
3. Lark/飞书创建文档：点左侧「云文档/Docs」→ 点「+」/「新建」→ 选「文档」。**不要点击 IDE 的 New Agent 按钮**。
4. 输入文字前先 click 聚焦输入框。
5. **必须确认界面状态与目标一致**后再 done。
6. 若上一步 click 后界面无变化，换其他按钮或 fail，勿重复同坐标。
7. 只输出一个 JSON 对象。"""


def format_action_plan(action: Dict[str, Any]) -> str:
    """Human-readable step label for UI and logs."""
    name = str(action.get("action") or "?").lower()
    reason = str(action.get("reason") or action.get("summary") or "").strip()
    parts: List[str] = [name]

    if name == "hotkey":
        keys = action.get("keys") or []
        if keys:
            parts.append("+".join(str(k) for k in keys))
    elif name in {"type", "fill"}:
        text = str(action.get("text") or "")
        if text:
            parts.append(f'"{text[:40]}"')
    elif name == "click":
        x, y = action.get("x"), action.get("y")
        if x is not None and y is not None:
            parts.append(f"({x},{y})")
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
    if name == "hotkey":
        keys = action.get("keys") or []
        return f"hotkey:{','.join(str(k) for k in keys)}"
    if name == "click":
        return f"click:{action.get('x')},{action.get('y')}"
    if name in {"type", "fill"}:
        return f"type:{str(action.get('text') or '')[:30]}"
    if name == "wait":
        return f"wait:{action.get('ms')}"
    return name


def detect_stuck_loop(history: List[Dict[str, Any]], action: Dict[str, Any], *, threshold: int = 2) -> bool:
    """True if the same action signature repeats too many times."""
    sig = _action_signature(action)
    if not sig or sig in {"done", "fail"}:
        return False
    recent = [
        _action_signature({"action": h.get("action"), **{k: h.get(k) for k in ("keys", "x", "y", "text", "ms")}})
        for h in history[-threshold:]
        if h.get("action") not in {"done", "fail"}
    ]
    if len(recent) >= threshold and all(s == sig for s in recent):
        return True
    # 连续两步界面无变化也视为卡住
    no_progress = sum(1 for h in history[-threshold:] if h.get("no_progress")) 
    return no_progress >= threshold


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


def _heuristic_action(*, goal: str, step_index: int, history: List[Dict[str, Any]]) -> Dict[str, Any]:
    goal_l = (goal or "").lower()
    if step_index == 0:
        if any(k in goal for k in ("文档", "document", "新建", "创建")):
            return {"action": "hotkey", "keys": ["command", "n"]}
        return {"action": "wait", "ms": 1200}
    if step_index == 1:
        return {"action": "wait", "ms": 1500}
    if step_index == 2:
        return {"action": "done", "summary": f"已尝试执行：{goal}"}
    return {"action": "fail", "reason": "启发式步骤已用尽，请配置视觉 LLM API Key 以继续自动化"}


def plan_native_action(
    *,
    goal: str,
    app_hint: str,
    screenshot_png: bytes,
    step_index: int,
    history: List[Dict[str, Any]],
    app_memory_hint: str = "",
    foreground_app: str = "",
    screen_width: int = 0,
    screen_height: int = 0,
) -> Tuple[Dict[str, Any], str, str]:
    """Returns (action, plan_label, planner_raw)."""
    _pid, model, key, cfg = resolve_vision_credentials()
    logger.info(
        "Native planner step=%s provider=%s model=%s key=%s screenshot=%sB",
        step_index + 1,
        _pid,
        model,
        "yes" if key else "no",
        len(screenshot_png),
    )
    if not key or not screenshot_png:
        action = _heuristic_action(goal=goal, step_index=step_index, history=history)
        plan = format_action_plan(action)
        return action, f"heuristic · {plan}", ""

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
        hist_lines.append(line)

    sw, sh = screen_width, screen_height
    if not sw or not sh:
        try:
            from PIL import Image
            import io as _io
            with Image.open(_io.BytesIO(screenshot_png)) as im:
                sw, sh = im.size
        except Exception:
            sw, sh = 1920, 1080

    memory_block = f"\n{app_memory_hint}\n" if app_memory_hint else ""
    fg_line = f"系统检测前台应用: {foreground_app or '未知'}\n"
    user_text = (
        f"用户目标: {goal}\n"
        f"目标应用: {app_hint or '(前台应用)'}\n"
        f"{fg_line}"
        f"截图尺寸: {sw} x {sh} 像素（click 坐标请用 0-1000 归一化）\n"
        f"当前步: {step_index + 1}\n"
        f"历史:\n" + ("\n".join(hist_lines) if hist_lines else "(无)") + "\n"
        f"{memory_block}"
        "请根据截图输出下一步动作 JSON（含 reason）。"
    )

    raw = ""
    try:
        client = OpenAI(api_key=key, base_url=cfg.base_url)
        resp = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": _NATIVE_PLANNER_SYSTEM},
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
        logger.warning("Native vision planner failed: %s", exc)
        action = _heuristic_action(goal=goal, step_index=step_index, history=history)

    if detect_stuck_loop(history, action):
        action = {
            "action": "fail",
            "reason": f"重复执行 {_action_signature(action)} 无进展，请检查目标应用是否在前台或尝试其他操作",
        }

    plan = format_action_plan(action)
    return action, plan, raw
