"""Per-app native desktop GUI operation memory."""

from __future__ import annotations

import json
import re
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from utils.logger import setup_logger

logger = setup_logger("native_use_memory")

PROJECT_ROOT = Path(__file__).resolve().parents[2]
MEMORY_DIR = PROJECT_ROOT / "storage" / "desktop" / "native_app_memory"
_LOCK = threading.RLock()

# 内置应用操作手册（首次无历史记忆时使用）
BUILTIN_APP_PLAYBOOKS: Dict[str, List[Dict[str, Any]]] = {
    "lark": [
        {
            "goal_keywords": ["文档", "document", "新建", "创建"],
            "hint": (
                "Lark/飞书创建文档：1) 确认 Lark 窗口在前台；"
                "2) 点击左侧「云文档」或「Docs」；"
                "3) 点击右上角「+」或「新建」→「文档」；"
                "4) 勿点击 Cursor/IDE 的 New Agent 按钮。"
            ),
            "steps": [
                {"action": "click", "target": "左侧边栏「云文档」或 Docs 图标", "hint": "进入云文档模块"},
                {"action": "wait", "ms": 1000},
                {"action": "click", "target": "右上角加号或「新建」按钮", "hint": "打开新建菜单"},
                {"action": "click", "target": "下拉菜单中的「文档」选项", "hint": "创建空白文档"},
            ],
        },
        {
            "goal_keywords": ["消息", "聊天", "chat"],
            "hint": "Lark 发消息：点击左侧「消息」→ 选择会话 → 在输入框输入并发送",
            "steps": [
                {"action": "click", "target": "左侧「消息」图标"},
                {"action": "click", "target": "目标聊天会话"},
                {"action": "click", "target": "底部消息输入框"},
            ],
        },
    ],
    "feishu": [],  # alias via lark
    "飞书": [],
}
# feishu/飞书 share lark playbooks
BUILTIN_APP_PLAYBOOKS["feishu"] = BUILTIN_APP_PLAYBOOKS["lark"]
BUILTIN_APP_PLAYBOOKS["飞书"] = BUILTIN_APP_PLAYBOOKS["lark"]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _slug_app(app_hint: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9_-]+", "_", (app_hint or "unknown").strip().lower())
    return slug[:80] or "unknown"


def _memory_path(app_hint: str) -> Path:
    return MEMORY_DIR / f"{_slug_app(app_hint)}.json"


def _normalize_goal(goal: str) -> str:
    return re.sub(r"\s+", " ", (goal or "").strip().lower())


def _step_signature(step: Dict[str, Any]) -> str:
    action = str(step.get("action") or "")
    keys = step.get("keys") or []
    if keys:
        return f"{action}:{','.join(str(k) for k in keys)}"
    if step.get("text"):
        return f"{action}:{str(step.get('text'))[:40]}"
    if step.get("target"):
        return f"{action}:{str(step.get('target'))[:40]}"
    if step.get("x") is not None and step.get("y") is not None:
        return f"{action}:{step.get('x')},{step.get('y')}"
    return action


def _compact_steps(steps: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    compact: List[Dict[str, Any]] = []
    for step in steps:
        if str(step.get("action") or "").lower() in {"done", "fail"}:
            continue
        entry: Dict[str, Any] = {"action": step.get("action")}
        for key in ("keys", "text", "x", "y", "ms", "reason", "plan_detail", "target"):
            if step.get(key) is not None:
                entry[key] = step[key]
        if step.get("ok") is False:
            entry["failed"] = True
        compact.append(entry)
    return compact


def get_builtin_playbook_hint(app_hint: str, goal: str) -> str:
    """Return built-in playbook hint when no learned memory exists."""
    slug = _slug_app(app_hint)
    playbooks = BUILTIN_APP_PLAYBOOKS.get(slug) or BUILTIN_APP_PLAYBOOKS.get(app_hint.lower(), [])
    if not playbooks:
        return ""
    goal_norm = _normalize_goal(goal)
    for pb in playbooks:
        keywords = pb.get("goal_keywords") or []
        if any(k in goal_norm for k in keywords):
            lines = [f"## {app_hint} 内置操作手册", str(pb.get("hint") or "")]
            for idx, step in enumerate(pb.get("steps") or [], 1):
                target = step.get("target") or step.get("hint") or step.get("ms", "")
                lines.append(f"  {idx}. {step.get('action')} — {target}")
            return "\n".join(lines)
    return ""


def get_app_memories(app_hint: str, goal: str = "", *, limit: int = 5) -> List[Dict[str, Any]]:
    """Return prior successful playbooks for the target app, goal-similar first."""
    path = _memory_path(app_hint)
    if not path.is_file():
        return []
    try:
        with _LOCK:
            data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("Failed to read app memory %s: %s", path, exc)
        return []

    entries = list(data.get("entries") or [])
    goal_norm = _normalize_goal(goal)

    def score(entry: Dict[str, Any]) -> tuple:
        entry_goal = _normalize_goal(str(entry.get("goal") or ""))
        overlap = 0
        if goal_norm and entry_goal:
            for token in goal_norm.split():
                if len(token) >= 2 and token in entry_goal:
                    overlap += 1
        return (overlap, int(entry.get("success_count") or 0))

    entries.sort(key=score, reverse=True)
    return entries[:limit]


def format_memories_for_planner(memories: List[Dict[str, Any]], *, app_hint: str = "", goal: str = "") -> str:
    parts: List[str] = []
    builtin = get_builtin_playbook_hint(app_hint, goal)
    if builtin:
        parts.append(builtin)
    if not memories:
        return "\n\n".join(parts)
    lines = ["## 该应用历史成功操作（可参考，勿盲目重复）"]
    for idx, mem in enumerate(memories, 1):
        goal_text = mem.get("goal") or "未知目标"
        steps = mem.get("steps") or []
        step_desc = " → ".join(
            _step_signature(s) if isinstance(s, dict) else str(s) for s in steps[:8]
        )
        notes = mem.get("notes") or ""
        lines.append(f"{idx}. 目标「{goal_text}」: {step_desc}")
        if notes:
            lines.append(f"   备注: {notes[:200]}")
    parts.append("\n".join(lines))
    return "\n\n".join(parts)


def save_session_memory(
    *,
    app_hint: str,
    goal: str,
    steps: List[Dict[str, Any]],
    success: bool,
    task_id: str = "",
    reflection: str = "",
) -> Optional[Dict[str, Any]]:
    """Persist or update per-app operation memory after a session."""
    if not app_hint or not goal:
        return None

    MEMORY_DIR.mkdir(parents=True, exist_ok=True)
    path = _memory_path(app_hint)
    compact = _compact_steps(steps)
    if not compact:
        return None

    with _LOCK:
        if path.is_file():
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                data = {"app_hint": app_hint, "entries": []}
        else:
            data = {"app_hint": app_hint, "entries": []}

        entries: List[Dict[str, Any]] = list(data.get("entries") or [])
        goal_norm = _normalize_goal(goal)
        sig = "|".join(_step_signature(s) for s in compact)

        matched: Optional[Dict[str, Any]] = None
        for entry in entries:
            if _normalize_goal(str(entry.get("goal") or "")) == goal_norm:
                entry_sig = "|".join(
                    _step_signature(s) for s in (entry.get("steps") or []) if isinstance(s, dict)
                )
                if entry_sig == sig:
                    matched = entry
                    break

        now = _now_iso()
        if matched:
            if success:
                matched["success_count"] = int(matched.get("success_count") or 0) + 1
            else:
                matched["failure_count"] = int(matched.get("failure_count") or 0) + 1
            matched["last_used"] = now
            matched["last_task_id"] = task_id
            if reflection:
                matched["notes"] = reflection[:500]
        else:
            entry = {
                "id": str(uuid.uuid4()),
                "goal": goal,
                "steps": compact,
                "success_count": 1 if success else 0,
                "failure_count": 0 if success else 1,
                "created_at": now,
                "last_used": now,
                "last_task_id": task_id,
                "notes": reflection[:500] if reflection else "",
            }
            entries.insert(0, entry)

        entries = entries[:50]
        data["entries"] = entries
        data["updated_at"] = now
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    logger.info("Saved native app memory for %s goal=%s success=%s", app_hint, goal[:60], success)
    return {"app_hint": app_hint, "entries_count": len(entries), "success": success}
