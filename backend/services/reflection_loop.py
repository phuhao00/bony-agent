"""Deterministic post-task reflection loop for self-learning."""

from __future__ import annotations

import json
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from core.companion_state import patch_companion_state
from services.learning_data_pipeline import append_event
from services.memory_coordinator import get_memory_coordinator
from utils.logger import setup_logger
from utils.trace_store import get_trace, update_trace_metadata

logger = setup_logger("reflection_loop")

PROJECT_ROOT = Path(__file__).resolve().parents[2]
REFLECTIONS_FILE = PROJECT_ROOT / "storage" / "evolution" / "reflections.jsonl"
_LOCK = threading.RLock()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _trim(value: Any, limit: int) -> str:
    text = "" if value is None else str(value).strip()
    if len(text) <= limit:
        return text
    return text[: limit - 1] + "..."


def _read_all(path: Optional[Path] = None) -> List[Dict[str, Any]]:
    path = path or REFLECTIONS_FILE
    if not path.exists():
        return []
    rows: List[Dict[str, Any]] = []
    with _LOCK:
        with path.open("r", encoding="utf-8") as file:
            for line in file:
                line = line.strip()
                if not line:
                    continue
                try:
                    rows.append(json.loads(line))
                except json.JSONDecodeError:
                    logger.warning("Skipping invalid reflection line")
    return rows


def list_reflections(
    *,
    trace_id: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 100,
    path: Optional[Path] = None,
) -> List[Dict[str, Any]]:
    rows = _read_all(path)
    if trace_id:
        rows = [row for row in rows if row.get("trace_id") == trace_id]
    if status:
        rows = [row for row in rows if row.get("trace_status") == status]
    rows.sort(key=lambda item: item.get("created_at") or "", reverse=True)
    return rows[: max(1, min(int(limit or 100), 1000))]


def _reflection_exists(trace_id: str, path: Optional[Path] = None) -> bool:
    return any(row.get("trace_id") == trace_id for row in _read_all(path))


def _build_reflection(trace: Dict[str, Any]) -> Dict[str, Any]:
    metadata = trace.get("metadata") or {}
    events = trace.get("events") or []
    status = str(trace.get("status") or "unknown")
    completed_agents = metadata.get("completed_agents") or []
    memory_hit_count = int(metadata.get("memory_hit_count") or 0)
    error = str(trace.get("error") or "")
    final_response = str(trace.get("final_response") or "")
    input_text = str(trace.get("input") or "")

    summary = _trim(final_response or error or input_text, 600)
    lessons: List[str] = []
    if status == "failed":
        lessons.append(f"失败任务需要保留错误原因：{_trim(error, 300) or '未知错误'}")
    if memory_hit_count:
        lessons.append(f"本次任务使用了 {memory_hit_count} 条长期记忆，可继续跟踪这些记忆是否真的有帮助。")
    if completed_agents:
        lessons.append(f"参与 Agent：{', '.join(str(agent) for agent in completed_agents[:6])}")
    if not lessons:
        lessons.append("任务完成，无明显失败信号；保留短摘要供后续相似任务检索。")

    memory_content = _trim(
        "任务复盘："
        f"状态={status}；"
        f"用户输入={_trim(input_text, 280)}；"
        f"结果摘要={summary}；"
        f"经验={'; '.join(lessons)}",
        1200,
    )
    return {
        "trace_id": trace.get("id", ""),
        "trace_kind": trace.get("kind", ""),
        "trace_status": status,
        "summary": summary,
        "lessons": lessons,
        "memory_content": memory_content,
        "completed_agents": completed_agents,
        "memory_hit_count": memory_hit_count,
        "event_count": len(events),
    }


def _append_reflection(reflection: Dict[str, Any], path: Optional[Path] = None) -> Dict[str, Any]:
    path = path or REFLECTIONS_FILE
    payload = {
        "id": str(uuid.uuid4()),
        "created_at": _now_iso(),
        **reflection,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    with _LOCK:
        with path.open("a", encoding="utf-8") as file:
            file.write(json.dumps(payload, ensure_ascii=False) + "\n")
    return payload


def reflect_trace(trace_id: str, *, force: bool = False, path: Optional[Path] = None) -> Dict[str, Any]:
    """Create one reflection record for a finalized trace and queue memory learning."""
    trace_id = (trace_id or "").strip()
    if not trace_id:
        return {"success": False, "error": "trace_id is required"}
    if not force and _reflection_exists(trace_id, path=path):
        return {"success": True, "skipped": True, "reason": "reflection already exists", "trace_id": trace_id}

    trace = get_trace(trace_id)
    if not trace:
        return {"success": False, "error": "trace not found", "trace_id": trace_id}
    if trace.get("status") == "running" and not force:
        return {"success": True, "skipped": True, "reason": "trace still running", "trace_id": trace_id}

    reflection = _append_reflection(_build_reflection(trace), path=path)
    memory_result: Dict[str, Any] = {}
    try:
        memory_result = get_memory_coordinator().save_reflection(
            reflection["memory_content"],
            {
                "source_trace_id": trace_id,
                "trace_status": reflection["trace_status"],
                "type": "task_reflection",
                "confidence": 0.55 if reflection["trace_status"] == "failed" else 0.65,
            },
        )
    except Exception as exc:
        logger.warning("Failed to save reflection memory candidate: %s", exc)
        memory_result = {"action": "error", "error": str(exc)}

    try:
        append_event(
            "reflection",
            trace_id=trace_id,
            source="reflection_loop",
            action="reflect_trace",
            status=reflection["trace_status"],
            summary=reflection["summary"],
            metadata={
                "reflection_id": reflection["id"],
                "lessons": reflection["lessons"],
                "memory_action": memory_result.get("action"),
                "memory_id": memory_result.get("id") or memory_result.get("duplicate_id") or "",
                "candidate_id": memory_result.get("candidate_id") or "",
            },
        )
    except Exception as exc:
        logger.warning("Failed to append reflection learning event: %s", exc)

    # 成长 XP 可保留；勿把任务 final_response 摘要写入伙伴档案 recent_feedback（档案页只应展示日程提醒 / 手动备忘等）
    try:
        patch_companion_state({"growth_add_xp": 1})
    except Exception as exc:
        logger.warning("Failed to add companion XP after reflection: %s", exc)

    try:
        update_trace_metadata(
            trace_id,
            {
                "reflection_id": reflection["id"],
                "reflection_memory_action": memory_result.get("action", ""),
                "reflection_candidate_id": memory_result.get("candidate_id", ""),
            },
        )
    except Exception as exc:
        logger.warning("Failed to update trace reflection metadata: %s", exc)

    return {"success": True, "reflection": reflection, "memory": memory_result}
