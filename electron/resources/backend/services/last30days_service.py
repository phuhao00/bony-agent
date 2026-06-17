"""last30days skill subprocess wrapper + async task orchestration."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional

from core.last30days_artifact import last30days_report_to_artifact
from utils.logger import setup_logger
from utils.task_manager import task_manager

logger = setup_logger("last30days_service")

PROJECT_ROOT = Path(__file__).resolve().parents[2]
SKILL_DIR = (PROJECT_ROOT / ".agent" / "skills" / "last30days").resolve()
SCRIPT_PATH = SKILL_DIR / "scripts" / "last30days.py"
RESEARCH_ROOT = Path(
    os.getenv("LAST30DAYS_MEMORY_DIR") or (PROJECT_ROOT / "storage" / "research" / "last30days")
).expanduser()
HISTORY_PATH = RESEARCH_ROOT / "index.json"
TASK_TYPE = "last30days_research"

_PROGRESS_STAGES = (
    {"stage": "start", "status": "pending"},
    {"stage": "fetch", "status": "pending"},
    {"stage": "rank", "status": "pending"},
    {"stage": "convert", "status": "pending"},
    {"stage": "done", "status": "pending"},
)

_MODE_TIMEOUT = {"quick": 180, "deep": 600}


def _default_progress() -> List[Dict[str, str]]:
    return [dict(s) for s in _PROGRESS_STAGES]


def _set_progress(task_id: str, stage: str, status: str = "done") -> None:
    task = task_manager.get_task(task_id)
    if not task:
        return
    progress = task.get("metadata", {}).get("progress") or _default_progress()
    updated: List[Dict[str, str]] = []
    found = False
    for item in progress:
        if item.get("stage") == stage:
            updated.append({"stage": stage, "status": status})
            found = True
        else:
            updated.append(dict(item))
    if not found:
        updated.append({"stage": stage, "status": status})
    task_manager.update_task(task_id, metadata={"progress": updated})


def _resolve_python() -> str:
    venv_py = PROJECT_ROOT / "venv" / "bin" / "python"
    if venv_py.is_file():
        return str(venv_py)
    backend_venv = PROJECT_ROOT / "backend" / ".venv" / "bin" / "python"
    if backend_venv.is_file():
        return str(backend_venv)
    return sys.executable


def _resolve_dashscope_config() -> Dict[str, Any]:
    """Read project DashScope / Qwen credentials for last30days subprocess."""
    try:
        from tools.media_common import _get_provider_api_key, _get_provider_base_url

        key = _get_provider_api_key("alibaba")
        if not key:
            return {"configured": False}
        base = (os.getenv("DASHSCOPE_BASE_URL") or _get_provider_base_url("alibaba") or "").strip()
        planner = (os.getenv("LAST30DAYS_PLANNER_MODEL") or "qwen-plus").strip()
        rerank = (os.getenv("LAST30DAYS_RERANK_MODEL") or "qwen-plus").strip()
        return {
            "configured": True,
            "provider": "dashscope",
            "base_url": base or "https://dashscope.aliyuncs.com/compatible-mode/v1/",
            "planner_model": planner,
            "rerank_model": rerank,
        }
    except Exception as exc:
        logger.debug("[last30days] dashscope config probe failed: %s", exc)
        return {"configured": False}


def _build_subprocess_env() -> Dict[str, str]:
    """Merge backend env with DashScope bridge for last30days CLI."""
    env = os.environ.copy()
    env["LAST30DAYS_MEMORY_DIR"] = str(RESEARCH_ROOT)

    dash = _resolve_dashscope_config()
    if dash.get("configured"):
        key = None
        try:
            from tools.media_common import _get_provider_api_key

            key = _get_provider_api_key("alibaba")
        except Exception:
            pass
        if key:
            env["DASHSCOPE_API_KEY"] = key
            env["ALIBABA_API_KEY"] = key
            env.setdefault("LAST30DAYS_REASONING_PROVIDER", "dashscope")
            env.setdefault("LAST30DAYS_PLANNER_MODEL", str(dash.get("planner_model") or "qwen-plus"))
            env.setdefault("LAST30DAYS_RERANK_MODEL", str(dash.get("rerank_model") or "qwen-plus"))
            base_url = str(dash.get("base_url") or "").strip()
            if base_url:
                env.setdefault("DASHSCOPE_BASE_URL", base_url.rstrip("/"))

    return env


def is_last30days_available() -> bool:
    return SCRIPT_PATH.is_file()


def get_last30days_status() -> Dict[str, Any]:
    py = _resolve_python()
    try:
        ver = subprocess.run(
            [py, "-c", "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        py_version = (ver.stdout or "").strip()
        py_ok = tuple(int(x) for x in py_version.split(".")[:2]) >= (3, 12) if py_version else False
    except Exception:
        py_version = "unknown"
        py_ok = False

    dash = _resolve_dashscope_config()

    return {
        "available": is_last30days_available(),
        "skill_dir": str(SKILL_DIR),
        "script": str(SCRIPT_PATH),
        "python": py,
        "python_version": py_version,
        "python_ok": py_ok,
        "memory_dir": str(RESEARCH_ROOT),
        "modes": ["quick", "deep"],
        "free_sources": ["reddit", "hackernews", "polymarket", "github"],
        "reasoning": dash,
        "optional_env": [
            "DASHSCOPE_API_KEY",
            "SCRAPECREATORS_API_KEY",
            "BRAVE_API_KEY",
            "BSKY_HANDLE",
            "BSKY_APP_PASSWORD",
            "OPENROUTER_API_KEY",
        ],
    }


def _load_history() -> List[Dict[str, Any]]:
    if not HISTORY_PATH.is_file():
        return []
    try:
        raw = json.loads(HISTORY_PATH.read_text(encoding="utf-8"))
        return raw if isinstance(raw, list) else []
    except Exception as exc:
        logger.warning("[last30days] history read failed: %s", exc)
        return []


def _save_history_entry(entry: Dict[str, Any]) -> None:
    RESEARCH_ROOT.mkdir(parents=True, exist_ok=True)
    history = _load_history()
    history = [entry, *[h for h in history if h.get("task_id") != entry.get("task_id")]]
    HISTORY_PATH.write_text(
        json.dumps(history[:30], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def list_last30days_history(limit: int = 10) -> List[Dict[str, Any]]:
    return _load_history()[: max(1, min(limit, 30))]


def _parse_report_json(stdout: str) -> Dict[str, Any]:
    text = (stdout or "").strip()
    if not text:
        raise ValueError("last30days 未返回 JSON 输出")
    try:
        payload = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError(f"last30days JSON 解析失败: {exc}") from exc
    if not isinstance(payload, dict):
        raise ValueError("last30days 输出不是 JSON 对象")
    return payload


def _find_saved_files(save_dir: Path) -> Dict[str, str]:
    paths: Dict[str, str] = {}
    if not save_dir.is_dir():
        return paths
    for pattern, key in (("*.json", "json"), ("*-raw.md", "markdown"), ("*-raw.html", "html")):
        matches = sorted(save_dir.glob(pattern), key=lambda p: p.stat().st_mtime, reverse=True)
        if matches:
            paths[key] = str(matches[0])
    return paths


def _run_cli(
    query: str,
    *,
    mode: Literal["quick", "deep"],
    save_dir: Path,
    mock: bool = False,
) -> tuple[Dict[str, Any], Dict[str, str], str]:
    if not SCRIPT_PATH.is_file():
        raise FileNotFoundError(f"last30days 脚本不存在: {SCRIPT_PATH}")

    save_dir.mkdir(parents=True, exist_ok=True)
    RESEARCH_ROOT.mkdir(parents=True, exist_ok=True)

    cmd = [
        _resolve_python(),
        str(SCRIPT_PATH),
        query,
        "--emit=json",
        f"--save-dir={save_dir}",
    ]
    if mode == "quick":
        cmd.append("--quick")
    else:
        cmd.append("--deep")
    if mock:
        cmd.append("--mock")

    env = _build_subprocess_env()

    logger.info("[last30days] run cmd=%s", " ".join(cmd[:4]) + " ...")
    proc = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=_MODE_TIMEOUT.get(mode, 180),
        cwd=str(SKILL_DIR),
        env=env,
    )

    stderr = proc.stderr or ""
    if proc.returncode != 0:
        detail = stderr.strip() or proc.stdout.strip() or f"exit {proc.returncode}"
        raise RuntimeError(f"last30days 执行失败: {detail[:2000]}")

    report = _parse_report_json(proc.stdout or "")
    local_paths = _find_saved_files(save_dir)
    return report, local_paths, stderr


def run_last30days_research_task(
    task_id: str,
    *,
    query: str,
    mode: Literal["quick", "deep"] = "quick",
    platform: str = "douyin",
    goal: str = "",
    trace_id: Optional[str] = None,
    mock: bool = False,
) -> None:
    """Background worker: run CLI, convert artifact, persist history."""
    save_dir = RESEARCH_ROOT / "runs" / task_id
    try:
        task_manager.update_task(
            task_id,
            status="running",
            progress=5,
            message="启动 last30days 调研引擎",
            metadata={"progress": _default_progress()},
        )
        _set_progress(task_id, "start", "running")

        _set_progress(task_id, "start", "done")
        _set_progress(task_id, "fetch", "running")
        task_manager.update_task(task_id, progress=25, message="多源抓取中…")

        report, local_paths, _stderr = _run_cli(query, mode=mode, save_dir=save_dir, mock=mock)

        _set_progress(task_id, "fetch", "done")
        _set_progress(task_id, "rank", "running")
        task_manager.update_task(task_id, progress=70, message="整理聚类与排序…")
        _set_progress(task_id, "rank", "done")

        _set_progress(task_id, "convert", "running")
        artifact = last30days_report_to_artifact(
            report,
            query=query,
            mode=mode,
            platform=platform,
            goal=goal,
            trace_id=trace_id,
            local_paths=local_paths,
        )
        save_dir.mkdir(parents=True, exist_ok=True)
        artifact_path = save_dir / "artifact.json"
        artifact_path.write_text(json.dumps(artifact, ensure_ascii=False, indent=2), encoding="utf-8")
        local_paths["artifact"] = str(artifact_path)
        _set_progress(task_id, "convert", "done")
        _set_progress(task_id, "done", "done")

        result = {
            "artifact": artifact,
            "local_paths": local_paths,
            "query": query,
            "mode": mode,
            "platform": platform,
            "goal": goal,
            "summary": artifact.get("summary") or "",
            "item_count": len(artifact.get("items") or []),
        }
        task_manager.update_task(
            task_id,
            status="completed",
            progress=100,
            message="调研完成",
            result=result,
        )
        _save_history_entry(
            {
                "task_id": task_id,
                "query": query,
                "mode": mode,
                "platform": platform,
                "goal": goal,
                "title": artifact.get("title"),
                "created_at": time.time(),
                "item_count": len(artifact.get("items") or []),
                "artifact_id": artifact.get("id"),
                "local_paths": local_paths,
            }
        )
    except Exception as exc:
        logger.error("[last30days] task %s failed: %s", task_id, exc, exc_info=True)
        task_manager.update_task(
            task_id,
            status="failed",
            progress=100,
            error=str(exc),
            message="调研失败",
        )


def create_last30days_research_task(
    *,
    query: str,
    mode: Literal["quick", "deep"] = "quick",
    platform: str = "douyin",
    goal: str = "",
    trace_id: Optional[str] = None,
) -> str:
    if not is_last30days_available():
        raise FileNotFoundError("last30days skill 未安装")

    cleaned = (query or "").strip()
    if not cleaned:
        raise ValueError("query 不能为空")

    status = get_last30days_status()
    if not status.get("python_ok"):
        raise RuntimeError(
            f"last30days 需要 Python 3.12+，当前: {status.get('python_version')}"
        )

    task_id = task_manager.create_task(
        TASK_TYPE,
        metadata={
            "query": cleaned,
            "mode": mode,
            "platform": platform,
            "goal": (goal or "").strip(),
            "trace_id": trace_id,
            "progress": _default_progress(),
        },
    )
    return task_id


def get_last30days_task_response(task_id: str) -> Optional[Dict[str, Any]]:
    task = task_manager.get_task(task_id)
    if not task or task.get("type") != TASK_TYPE:
        return None

    metadata = task.get("metadata") or {}
    result = task.get("result") or {}
    payload: Dict[str, Any] = {
        "task_id": task_id,
        "status": task.get("status"),
        "progress": metadata.get("progress") or _default_progress(),
        "progress_pct": task.get("progress", 0),
        "message": task.get("message"),
        "error": task.get("error"),
        "query": metadata.get("query"),
        "mode": metadata.get("mode"),
        "platform": metadata.get("platform"),
        "goal": metadata.get("goal"),
    }
    if task.get("status") == "completed" and isinstance(result, dict):
        payload["artifact"] = result.get("artifact")
        payload["local_paths"] = result.get("local_paths")
        payload["summary"] = result.get("summary")
        payload["item_count"] = result.get("item_count")
    return payload


_lock = threading.Lock()
_scheduled: set[str] = set()


def schedule_last30days_research_task(
    task_id: str,
    *,
    query: str,
    mode: Literal["quick", "deep"] = "quick",
    platform: str = "douyin",
    goal: str = "",
    trace_id: Optional[str] = None,
    mock: bool = False,
) -> None:
    """Fire-and-forget background thread (used from FastAPI BackgroundTasks)."""
    with _lock:
        if task_id in _scheduled:
            return
        _scheduled.add(task_id)

    def _worker() -> None:
        try:
            run_last30days_research_task(
                task_id,
                query=query,
                mode=mode,
                platform=platform,
                goal=goal,
                trace_id=trace_id,
                mock=mock,
            )
        finally:
            with _lock:
                _scheduled.discard(task_id)

    threading.Thread(target=_worker, name=f"last30days-{task_id[:8]}", daemon=True).start()
