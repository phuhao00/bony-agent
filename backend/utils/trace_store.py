import json
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from utils.logger import setup_logger

logger = setup_logger("trace_store")

PROJECT_ROOT = Path(__file__).resolve().parents[2]
TRACE_DIR = PROJECT_ROOT / "storage" / "traces"
TRACE_DIR.mkdir(parents=True, exist_ok=True)

_lock = threading.RLock()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _trace_path(trace_id: str) -> Path:
    return TRACE_DIR / f"{trace_id}.json"


def _read_trace(trace_id: str) -> Dict[str, Any]:
    with _trace_path(trace_id).open("r", encoding="utf-8") as file:
        return json.load(file)


def _write_trace(trace_id: str, payload: Dict[str, Any]) -> None:
    payload["updated_at"] = _now_iso()
    with _trace_path(trace_id).open("w", encoding="utf-8") as file:
        json.dump(payload, file, ensure_ascii=False, indent=2)


def create_trace(kind: str, user_input: str, metadata: Optional[Dict[str, Any]] = None) -> str:
    trace_id = str(uuid.uuid4())
    payload = {
        "id": trace_id,
        "kind": kind,
        "input": user_input,
        "status": "running",
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
        "final_response": "",
        "error": None,
        "metadata": metadata or {},
        "events": [],
    }
    with _lock:
        _write_trace(trace_id, payload)
    return trace_id


def append_trace_event(trace_id: str, event: Dict[str, Any]) -> None:
    with _lock:
        payload = _read_trace(trace_id)
        payload.setdefault("events", []).append({"timestamp": _now_iso(), **event})
        _write_trace(trace_id, payload)


def finalize_trace(
    trace_id: str,
    *,
    status: str,
    final_response: str = "",
    error: Optional[str] = None,
    metadata_updates: Optional[Dict[str, Any]] = None,
) -> None:
    with _lock:
        payload = _read_trace(trace_id)
        payload["status"] = status
        if final_response:
            payload["final_response"] = final_response
        payload["error"] = error
        if metadata_updates:
            payload.setdefault("metadata", {}).update(metadata_updates)
        _write_trace(trace_id, payload)


def update_trace_metadata(trace_id: str, metadata_updates: Dict[str, Any]) -> None:
    with _lock:
        payload = _read_trace(trace_id)
        payload.setdefault("metadata", {}).update(metadata_updates)
        _write_trace(trace_id, payload)


def get_trace(trace_id: str) -> Optional[Dict[str, Any]]:
    path = _trace_path(trace_id)
    if not path.exists():
        return None
    with _lock:
        try:
            return _read_trace(trace_id)
        except Exception as exc:
            logger.error(f"Failed to read trace {trace_id}: {exc}")
            return None


def list_traces(limit: int = 20) -> List[Dict[str, Any]]:
    traces: List[Dict[str, Any]] = []
    with _lock:
        for path in TRACE_DIR.glob("*.json"):
            try:
                with path.open("r", encoding="utf-8") as file:
                    payload = json.load(file)
                traces.append(
                    {
                        "id": payload.get("id"),
                        "kind": payload.get("kind"),
                        "status": payload.get("status"),
                        "created_at": payload.get("created_at"),
                        "updated_at": payload.get("updated_at"),
                        "metadata": payload.get("metadata", {}),
                    }
                )
            except Exception as exc:
                logger.warning(f"Skipping broken trace file {path.name}: {exc}")
    traces.sort(key=lambda item: item.get("updated_at") or "", reverse=True)
    return traces[:limit]