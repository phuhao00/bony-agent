import json
import threading
import uuid
import time
from pathlib import Path
from typing import Dict, Any, List, Optional

from utils.logger import setup_logger

logger = setup_logger("task_manager")

PROJECT_ROOT = Path(__file__).resolve().parents[2]
TASK_DIR = PROJECT_ROOT / "storage" / "tasks"
TASK_DIR.mkdir(parents=True, exist_ok=True)

TASK_STATUSES = {
    "pending",
    "waiting_approval",
    "running",
    "completed",
    "failed",
    "cancelled",
    "expired",
}

class TaskManager:
    def __init__(self, storage_dir: Path = TASK_DIR):
        self.tasks: Dict[str, Dict[str, Any]] = {}
        self.storage_dir = storage_dir
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._load_tasks()

    def _task_path(self, task_id: str) -> Path:
        return self.storage_dir / f"{task_id}.json"

    def _load_tasks(self) -> None:
        with self._lock:
            for path in self.storage_dir.glob("*.json"):
                try:
                    with path.open("r", encoding="utf-8") as file:
                        task = json.load(file)
                    if task.get("id"):
                        self.tasks[task["id"]] = task
                except Exception as exc:
                    logger.warning(f"Skipping broken task file {path.name}: {exc}")

    def _write_task(self, task_id: str) -> None:
        with self._task_path(task_id).open("w", encoding="utf-8") as file:
            json.dump(self.tasks[task_id], file, ensure_ascii=False, indent=2)

    def create_task(self, task_type: str, metadata: Optional[Dict[str, Any]] = None) -> str:
        task_id = str(uuid.uuid4())
        now = time.time()
        task = {
            "id": task_id,
            "type": task_type,
            "status": "pending",
            "progress": 0,
            "result": None,
            "error": None,
            "message": None,
            "cancel_requested": False,
            "start_time": now,
            "created_at": now,
            "updated_at": now,
            "metadata": metadata or {}
        }
        with self._lock:
            self.tasks[task_id] = task
            self._write_task(task_id)
        return task_id

    def update_task(
        self,
        task_id: str,
        status: Optional[str] = None,
        progress: Optional[int] = None,
        result: Any = None,
        error: Optional[str] = None,
        message: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        cancel_requested: Optional[bool] = None,
    ):
        with self._lock:
            if task_id not in self.tasks:
                return
            task = self.tasks[task_id]
            if status:
                if status not in TASK_STATUSES:
                    logger.warning(f"Unknown task status '{status}' for {task_id}")
                task["status"] = status
            if progress is not None:
                task["progress"] = progress
            if result is not None:
                task["result"] = result
            if error:
                task["error"] = error
            if message:
                task["message"] = message
            if metadata:
                task.setdefault("metadata", {}).update(metadata)
            if cancel_requested is not None:
                task["cancel_requested"] = cancel_requested
            task["updated_at"] = time.time()
            self._write_task(task_id)

    def get_task(self, task_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            task = self.tasks.get(task_id)
            return dict(task) if task else None

    def list_tasks(self, status: Optional[str] = None, limit: int = 100) -> List[Dict[str, Any]]:
        with self._lock:
            tasks = [dict(task) for task in self.tasks.values() if status is None or task.get("status") == status]
        tasks.sort(key=lambda item: item.get("updated_at") or 0, reverse=True)
        return tasks[:limit]

    def request_cancel(self, task_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            if task_id not in self.tasks:
                return None
            task = self.tasks[task_id]
            task["cancel_requested"] = True
            if task.get("status") in {"pending", "waiting_approval"}:
                task["status"] = "cancelled"
            task["updated_at"] = time.time()
            self._write_task(task_id)
            return dict(task)

    def clean_old_tasks(self, max_age_seconds: int = 3600):
        """Cleanup tasks older than 1 hour"""
        now = time.time()
        with self._lock:
            to_delete = [tid for tid, task in self.tasks.items() if now - task["updated_at"] > max_age_seconds]
            for tid in to_delete:
                self.tasks.pop(tid, None)
                try:
                    self._task_path(tid).unlink(missing_ok=True)
                except Exception as exc:
                    logger.warning(f"Failed to delete old task file {tid}: {exc}")

# Global instance
task_manager = TaskManager()
