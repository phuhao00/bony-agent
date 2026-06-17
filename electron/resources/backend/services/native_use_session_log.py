"""Persistent session logs for native desktop GUI automation."""

from __future__ import annotations

import base64
import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from utils.logger import setup_logger

logger = setup_logger("native_use_session_log")

PROJECT_ROOT = Path(__file__).resolve().parents[2]
SESSIONS_DIR = PROJECT_ROOT / "storage" / "desktop" / "native_sessions"
_LOCK = threading.RLock()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def session_dir(task_id: str) -> Path:
    return SESSIONS_DIR / task_id


def save_step_screenshot(task_id: str, step_index: int, png_bytes: bytes, *, phase: str = "before") -> str:
    """Save screenshot; return relative path under storage/."""
    if not png_bytes:
        return ""
    out_dir = session_dir(task_id)
    out_dir.mkdir(parents=True, exist_ok=True)
    rel = f"desktop/native_sessions/{task_id}/step_{step_index:02d}_{phase}.png"
    out_path = PROJECT_ROOT / "storage" / rel
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(png_bytes)
    return rel


def append_session_log(
    task_id: str,
    *,
    goal: str,
    app_hint: str,
    step: Dict[str, Any],
    planner_raw: str = "",
    screenshot_before: str = "",
    screenshot_after: str = "",
) -> None:
    """Append one step to the session JSON log."""
    SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
    log_path = session_dir(task_id) / "session.json"

    entry = {
        "timestamp": _now_iso(),
        "step": {k: v for k, v in step.items() if k != "screenshot_base64"},
        "planner_raw": planner_raw[:2000] if planner_raw else "",
        "screenshot_before": screenshot_before,
        "screenshot_after": screenshot_after,
    }

    with _LOCK:
        if log_path.is_file():
            try:
                doc = json.loads(log_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                doc = _new_session_doc(task_id, goal, app_hint)
        else:
            doc = _new_session_doc(task_id, goal, app_hint)

        steps: List[Dict[str, Any]] = list(doc.get("steps") or [])
        steps.append(entry)
        doc["steps"] = steps
        doc["updated_at"] = _now_iso()
        log_path.parent.mkdir(parents=True, exist_ok=True)
        log_path.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")


def finalize_session_log(
    task_id: str,
    *,
    status: str,
    goal: str,
    app_hint: str,
    message: str = "",
    reflection: str = "",
    steps_count: int = 0,
) -> Dict[str, Any]:
    """Mark session complete and write summary."""
    log_path = session_dir(task_id) / "session.json"
    doc: Dict[str, Any]
    with _LOCK:
        if log_path.is_file():
            try:
                doc = json.loads(log_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                doc = _new_session_doc(task_id, goal, app_hint)
        else:
            doc = _new_session_doc(task_id, goal, app_hint)

        doc["status"] = status
        doc["message"] = message
        doc["reflection"] = reflection
        doc["steps_count"] = steps_count
        doc["finished_at"] = _now_iso()
        log_path.parent.mkdir(parents=True, exist_ok=True)
        log_path.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")

    rel = f"desktop/native_sessions/{task_id}/session.json"
    logger.info("Native session log finalized: %s status=%s", rel, status)
    return {"session_log": rel, "task_id": task_id, "status": status}


def _new_session_doc(task_id: str, goal: str, app_hint: str) -> Dict[str, Any]:
    return {
        "task_id": task_id,
        "goal": goal,
        "app_hint": app_hint,
        "started_at": _now_iso(),
        "steps": [],
    }


def load_session_log(task_id: str) -> Optional[Dict[str, Any]]:
    log_path = session_dir(task_id) / "session.json"
    if not log_path.is_file():
        return None
    try:
        return json.loads(log_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
