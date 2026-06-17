"""
多媒体生产流水线任务骨架：将脚本→分镜→图→视频等环节写入同一 task metadata，便于恢复与进度展示。
执行各步骤的业务逻辑仍由现有 tools/API 完成；此处仅负责任务状态机与元数据结构。
"""

from __future__ import annotations

import time
import json
from typing import Any, Dict, List, Optional

from core.research_artifact import research_trace_previews
from core.super_agent_api import create_approval_response
from utils.task_manager import task_manager

PIPELINE_STEP_IDS: List[str] = [
    "script",
    "storyboard",
    "image",
    "video",
    "voice",
    "subtitle",
    "remix",
    "publish",
]

STEP_STATUS = frozenset({"pending", "running", "completed", "failed", "skipped", "waiting_approval"})


def _default_steps() -> List[Dict[str, Any]]:
    now = time.time()
    return [
        {
            "id": sid,
            "status": "pending",
            "artifact": None,
            "error": None,
            "updated_at": now,
        }
        for sid in PIPELINE_STEP_IDS
    ]


def _history_type_for_pipeline_step(step_id: str) -> str:
    m = {
        "script": "script",
        "storyboard": "script",
        "image": "image",
        "video": "video",
        "voice": "media_pipeline_voice",
        "subtitle": "media_pipeline_subtitle",
        "remix": "video",
        "publish": "copywriting",
    }
    return m.get(step_id, "media_pipeline")


def _artifact_primary_result(artifact: Dict[str, Any]) -> str:
    for k in ("path", "url", "public_url", "output_path", "text", "summary", "markdown", "body"):
        v = artifact.get(k)
        if v is not None and str(v).strip():
            return str(v).strip()[:50000]
    try:
        return json.dumps(artifact, ensure_ascii=False)[:8000]
    except Exception:
        return str(artifact)[:8000]


def _persist_step_outputs(
    task_id: str,
    step_id: str,
    goal: str,
    artifact: Dict[str, Any],
    *,
    persist_to_history: bool,
    persist_to_knowledge: bool,
    trace_id: Optional[str],
) -> Dict[str, Any]:
    from utils.logger import setup_logger

    logger_mp = setup_logger("media_pipeline")
    out: Dict[str, Any] = {
        "step_id": step_id,
        "history_record_id": None,
        "knowledge": None,
    }
    errs: List[str] = []
    if persist_to_history:
        try:
            from utils.generation_history import add_generation_record

            rec = add_generation_record(
                _history_type_for_pipeline_step(step_id),
                (goal or "media_pipeline")[:8000],
                _artifact_primary_result(artifact),
                metadata={
                    "task_id": task_id,
                    "step_id": step_id,
                    "trace_id": trace_id,
                    "source": "media_pipeline",
                },
            )
            out["history_record_id"] = rec.get("id")
        except Exception as exc:
            logger_mp.warning("media_pipeline persist history failed: %s", exc, exc_info=True)
            errs.append(f"history:{exc}")
    if persist_to_knowledge:
        try:
            from core.research_artifact import make_research_artifact
            from core.research_knowledge import ingest_research_artifact_to_knowledge

            safe_keys = [k for k in list(artifact.keys())[:24] if isinstance(k, str)]
            raw_small = {k: artifact[k] for k in safe_keys}
            ra = make_research_artifact(
                "custom",
                query=(goal or "")[:4000],
                title=f"流水线产出 · {step_id}",
                summary=_artifact_primary_result(artifact)[:50000],
                items=[],
                raw={"task_id": task_id, "step_id": step_id, "artifact": raw_small},
                trace_id=trace_id,
            )
            kin = ingest_research_artifact_to_knowledge(
                ra, filename_base=f"pipeline_{step_id}_{task_id[:8]}"
            )
            out["knowledge"] = {
                "success": bool(kin.get("success")),
                "error": kin.get("error"),
                "filename": kin.get("filename"),
            }
        except Exception as exc:
            logger_mp.warning("media_pipeline persist knowledge failed: %s", exc, exc_info=True)
            errs.append(f"knowledge:{exc}")
    if errs:
        out["errors"] = errs
    return out


def init_pipeline_metadata(goal: str, trace_id: Optional[str] = None) -> Dict[str, Any]:
    g = (goal or "").strip()
    now = time.time()
    meta: Dict[str, Any] = {
        "pipeline_version": 1,
        "goal": g[:8000],
        "trace_id": trace_id,
        "steps": _default_steps(),
        "current_step_index": 0,
        "created_at": now,
    }
    try:
        from services.taste_art_direction import pipeline_taste_metadata

        meta.update(pipeline_taste_metadata(g))
    except Exception as exc:
        logger_mp.warning("media_pipeline taste metadata skipped: %s", exc)
    return meta


def create_media_pipeline_task(goal: str, trace_id: Optional[str] = None) -> str:
    return task_manager.create_task("media_pipeline", metadata=init_pipeline_metadata(goal, trace_id))


def run_media_pipeline_research(
    task_id: str,
    *,
    query: Optional[str] = None,
    max_results: int = 10,
    region: str = "",
    backend: Optional[str] = None,
) -> Dict[str, Any]:
    """
    对流水线 goal（或自定义 query）做一次调研，写入 metadata
    （research_history、last_research_artifact）；若任务带 trace_id 则追加 trace 事件。
    backend: auto | builtin | hermes | openclaw
    """
    task = task_manager.get_task(task_id)
    if not task:
        raise ValueError("Task not found")
    if task.get("type") != "media_pipeline":
        raise ValueError("Not a media_pipeline task")

    md = dict(task.get("metadata") or {})
    goal = (md.get("goal") or "").strip()
    q = ((query or goal) or "").strip()
    if not q:
        raise ValueError("Empty research query; set pipeline goal or pass query")

    raw_tid = md.get("trace_id")
    trace_id: Optional[str] = None
    if isinstance(raw_tid, str) and raw_tid.strip():
        trace_id = raw_tid.strip()

    from services.hermes_runtime import resolve_research_backend

    chosen_backend = resolve_research_backend(backend)
    artifact: Dict[str, Any]

    if chosen_backend == "hermes":
        try:
            from tools.hermes_tools import hermes_research_artifact

            artifact = hermes_research_artifact(q)
        except Exception as exc:
            import logging

            logging.getLogger("media_pipeline").warning(
                "Hermes research failed, falling back to DuckDuckGo: %s", exc
            )
            chosen_backend = "builtin"
            from utils.simple_ddg_search import ddg_html_search_research_artifact

            artifact = ddg_html_search_research_artifact(
                q,
                max_results=max_results,
                region=region or "",
                trace_id=trace_id,
            )
    elif chosen_backend == "openclaw":
        try:
            from tools.lobster_tools import send_task_to_openclaw

            raw = send_task_to_openclaw.invoke({"task": f"Research: {q}", "node_id": "auto"})
            artifact = {
                "id": f"openclaw-{abs(hash(q)) % 10**10}",
                "query": q,
                "source": "openclaw",
                "items": [{"title": "OpenClaw research", "snippet": str(raw)[:4000], "url": ""}],
                "summary": str(raw)[:4000],
                "raw": {"ok": True, "backend": "openclaw", "text": str(raw)},
            }
        except Exception as exc:
            import logging

            logging.getLogger("media_pipeline").warning(
                "OpenClaw research failed, falling back to DuckDuckGo: %s", exc
            )
            chosen_backend = "builtin"
            from utils.simple_ddg_search import ddg_html_search_research_artifact

            artifact = ddg_html_search_research_artifact(
                q,
                max_results=max_results,
                region=region or "",
                trace_id=trace_id,
            )
    else:
        from utils.simple_ddg_search import ddg_html_search_research_artifact

        artifact = ddg_html_search_research_artifact(
            q,
            max_results=max_results,
            region=region or "",
            trace_id=trace_id,
        )

    history: List[Dict[str, Any]] = list(md.get("research_history") or [])
    history.append(
        {
            "retrieved_at": time.time(),
            "query": q,
            "artifact_id": artifact.get("id"),
            "hit_count": len(artifact.get("items") or []),
            "ok": (artifact.get("raw") or {}).get("ok"),
            "backend": chosen_backend,
        }
    )

    if trace_id:
        from utils.trace_store import append_trace_event, get_trace

        if get_trace(trace_id):
            previews = research_trace_previews(artifact)
            append_trace_event(
                trace_id,
                {
                    "type": "media_pipeline_research",
                    "task_id": task_id,
                    "query": q,
                    "artifact_id": artifact.get("id"),
                    "hit_count": len(artifact.get("items") or []),
                    "ok": (artifact.get("raw") or {}).get("ok"),
                    "summary_preview": previews.get("summary_preview"),
                    "items_preview": previews.get("items_preview"),
                },
            )

    msg = f"流水线调研: {len(artifact.get('items') or [])} 条结果"
    task_manager.update_task(
        task_id,
        message=msg[:500],
        metadata={
            "research_history": history[-20:],
            "last_research_artifact": artifact,
        },
    )
    refreshed = task_manager.get_task(task_id)
    if not refreshed:
        raise ValueError("Task not found after update")
    return {"artifact": artifact, "task": refreshed}


def advance_media_pipeline_step(
    task_id: str,
    *,
    step_id: str,
    status: str,
    artifact: Optional[Dict[str, Any]] = None,
    error: Optional[str] = None,
    message: Optional[str] = None,
    persist_to_history: bool = False,
    persist_to_knowledge: bool = False,
) -> Dict[str, Any]:
    task = task_manager.get_task(task_id)
    if not task:
        raise ValueError("Task not found")
    if task.get("type") != "media_pipeline":
        raise ValueError("Not a media_pipeline task")
    st = (status or "").strip().lower()
    if st not in STEP_STATUS:
        raise ValueError(f"Invalid status: {status}")

    md = dict(task.get("metadata") or {})
    steps: List[Dict[str, Any]] = [dict(s) for s in (md.get("steps") or [])]
    if not steps:
        steps = _default_steps()
        md["steps"] = steps

    now = time.time()
    idx = -1
    for i, s in enumerate(steps):
        if s.get("id") == step_id:
            idx = i
            steps[i] = {
                **s,
                "status": st,
                "artifact": artifact,
                "error": (error or "")[:4000] if error else None,
                "updated_at": now,
            }
            break
    if idx < 0:
        raise ValueError(f"Unknown step_id: {step_id}")

    md["steps"] = steps
    md["current_step_index"] = idx

    total = len(PIPELINE_STEP_IDS)
    terminal_ok = {"completed", "skipped", "failed"}
    completed_like = sum(1 for s in steps if s.get("status") in terminal_ok)
    running_any = any(s.get("status") == "running" for s in steps)
    progress = min(99, int(100 * completed_like / max(1, total))) if running_any or completed_like < total else 100

    if all(s.get("status") in ("completed", "skipped") for s in steps):
        task_status = "completed"
        progress = 100
    elif any(s.get("status") == "failed" for s in steps):
        task_status = "failed"
    elif any(s.get("status") == "waiting_approval" for s in steps):
        task_status = "waiting_approval"
    else:
        task_status = "running"

    msg = message or f"流水线 {step_id}: {st}"
    task_manager.update_task(
        task_id,
        status=task_status,
        progress=progress,
        message=msg[:500],
        metadata=md,
    )

    if (
        st == "completed"
        and isinstance(artifact, dict)
        and artifact
        and (persist_to_history or persist_to_knowledge)
    ):
        t_goal = (md.get("goal") or "").strip()
        raw_tr = md.get("trace_id")
        tr: Optional[str] = None
        if isinstance(raw_tr, str) and raw_tr.strip():
            tr = raw_tr.strip()
        pinfo = _persist_step_outputs(
            task_id,
            step_id,
            t_goal,
            artifact,
            persist_to_history=persist_to_history,
            persist_to_knowledge=persist_to_knowledge,
            trace_id=tr,
        )
        task_manager.update_task(task_id, metadata={"last_step_persist": pinfo})

    raw_trace = md.get("trace_id")
    tid_trace: Optional[str] = None
    if isinstance(raw_trace, str) and raw_trace.strip():
        tid_trace = raw_trace.strip()
    if tid_trace:
        from utils.trace_store import append_trace_event, get_trace

        if get_trace(tid_trace):
            artifact_hint: Dict[str, Any] = {}
            if isinstance(artifact, dict):
                for k in ("path", "url", "output_path", "public_url", "id", "kind"):
                    v = artifact.get(k)
                    if v is not None and str(v).strip() != "":
                        artifact_hint[k] = str(v)[:800]
            append_trace_event(
                tid_trace,
                {
                    "type": "media_pipeline_step",
                    "task_id": task_id,
                    "step_id": step_id,
                    "status": st,
                    "task_status": task_status,
                    "progress": progress,
                    "artifact_hint": artifact_hint or None,
                    "error": (error or "")[:800] if error else None,
                },
            )

    out = task_manager.get_task(task_id)
    if not out:
        raise ValueError("Task not found after update")
    return out


def submit_media_pipeline_step_for_approval(
    task_id: str,
    *,
    step_id: str,
    artifact: Optional[Dict[str, Any]] = None,
    note: str = "",
    persist_to_history: bool = False,
    persist_to_knowledge: bool = False,
) -> Dict[str, Any]:
    """
    将某步设为 waiting_approval，并创建一条与任务绑定的审批（capability media_pipeline_gate）。
    批准 / 拒绝分别由 super_agent_api 在解析审批时调用 complete / fail 回调。
    persist_* 写入审批 metadata，在批准后完成步骤时与 advance_media_pipeline_step(completed) 一致地落库。
    """
    sid = (step_id or "").strip()
    if sid not in PIPELINE_STEP_IDS:
        raise ValueError(f"Unknown step_id: {step_id}")

    art: Optional[Dict[str, Any]] = None
    if isinstance(artifact, dict):
        art = dict(artifact)
        n = (note or "").strip()
        if n:
            art.setdefault("_gate_note", n[:2000])

    advance_media_pipeline_step(
        task_id,
        step_id=sid,
        status="waiting_approval",
        artifact=art,
        message=(note or "").strip()[:500] or f"等待人工确认: {sid}",
    )

    task = task_manager.get_task(task_id)
    if not task:
        raise ValueError("Task not found")
    md = task.get("metadata") or {}
    raw_tid = md.get("trace_id")
    trace_id: Optional[str] = None
    if isinstance(raw_tid, str) and raw_tid.strip():
        trace_id = raw_tid.strip()

    prop = (note or "").strip() or f"确认多媒体流水线步骤「{sid}」后再继续后续环节。"
    approval = create_approval_response(
        capability_id="media_pipeline_gate",
        proposed_action=prop[:2000],
        args={"task_id": task_id, "step_id": sid},
        trace_id=trace_id,
        task_id=task_id,
        metadata={
            "source": "media_pipeline",
            "step_id": sid,
            "goal_snippet": str(md.get("goal") or "")[:500],
            "persist_to_history": bool(persist_to_history),
            "persist_to_knowledge": bool(persist_to_knowledge),
        },
    )
    return {"approval": approval, "task": task_manager.get_task(task_id)}


def complete_media_pipeline_from_approval(approval: Dict[str, Any]) -> None:
    task_id = approval.get("task_id")
    meta = approval.get("metadata") or {}
    step_id = meta.get("step_id")
    aid = approval.get("id")
    if not task_id or not step_id:
        raise ValueError("media_pipeline approval missing task_id or step_id")

    task = task_manager.get_task(task_id)
    if not task:
        raise ValueError("Task not found")
    prev_artifact: Optional[Dict[str, Any]] = None
    for s in (task.get("metadata") or {}).get("steps") or []:
        if isinstance(s, dict) and s.get("id") == step_id:
            a = s.get("artifact")
            prev_artifact = dict(a) if isinstance(a, dict) else None
            break

    ph = bool(meta.get("persist_to_history"))
    pk = bool(meta.get("persist_to_knowledge"))

    advance_media_pipeline_step(
        task_id,
        step_id=str(step_id),
        status="completed",
        artifact=prev_artifact,
        message="流水线步骤已获人工批准",
        persist_to_history=ph,
        persist_to_knowledge=pk,
    )
    merge_meta: Dict[str, Any] = {"approved_approval_id": aid}
    if aid:
        task_manager.update_task(task_id, metadata=merge_meta)


def fail_media_pipeline_from_denied_approval(
    approval: Dict[str, Any],
    reason: Optional[str] = None,
) -> None:
    task_id = approval.get("task_id")
    meta = approval.get("metadata") or {}
    step_id = meta.get("step_id")
    aid = approval.get("id")
    if not task_id or not step_id:
        raise ValueError("media_pipeline approval missing task_id or step_id")

    advance_media_pipeline_step(
        task_id,
        step_id=str(step_id),
        status="failed",
        error=(reason or "审批被拒绝")[:4000],
        message="流水线步骤未获人工批准",
    )
    if aid:
        task_manager.update_task(task_id, metadata={"denied_approval_id": aid})
