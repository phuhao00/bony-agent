import json
import threading
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from core.capabilities import require_capability
from utils.logger import setup_logger

logger = setup_logger("approval_service")

PROJECT_ROOT = Path(__file__).resolve().parents[2]
APPROVAL_DIR = PROJECT_ROOT / "storage" / "approvals"
APPROVAL_INDEX = APPROVAL_DIR / "approvals.json"

SENSITIVE_KEYS = ("token", "password", "secret", "cookie", "api_key", "authorization", "credential")

# 飞书 write_docs 等可能带大数组；审批预览只保留条数与前若干条，避免 UI/存储膨胀。
HEAVY_LIST_KEYS = frozenset({"batch_updates", "requests"})


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now().isoformat()


def _parse_iso(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _redact(value: Any) -> Any:
    if isinstance(value, dict):
        redacted: Dict[str, Any] = {}
        for key, item in value.items():
            ks = str(key)
            if any(marker in ks.lower() for marker in SENSITIVE_KEYS):
                redacted[key] = "***REDACTED***"
            elif ks in HEAVY_LIST_KEYS and isinstance(item, list):
                preview = [_redact(v) for v in item[:5]]
                entry: Dict[str, Any] = {"item_count": len(item), "preview_first_5": preview}
                if len(item) > 5:
                    entry["omitted_count"] = len(item) - 5
                redacted[key] = entry
            else:
                redacted[key] = _redact(item)
        return redacted
    if isinstance(value, list):
        return [_redact(item) for item in value[:20]]
    text = str(value)
    if len(text) > 500:
        return f"{text[:500]}..."
    return value


class ApprovalService:
    def __init__(self, storage_path: Path = APPROVAL_INDEX):
        self.storage_path = storage_path
        self.storage_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._requests: Dict[str, Dict[str, Any]] = {}
        self._load()

    def _load(self) -> None:
        if not self.storage_path.exists():
            self._requests = {}
            return
        try:
            with self.storage_path.open("r", encoding="utf-8") as file:
                payload = json.load(file)
            requests = payload.get("requests", payload)
            self._requests = dict(requests) if isinstance(requests, dict) else {}
        except Exception as exc:
            logger.error(f"Failed to load approvals: {exc}")
            self._requests = {}

    def _save(self) -> None:
        with self.storage_path.open("w", encoding="utf-8") as file:
            json.dump({"requests": self._requests}, file, ensure_ascii=False, indent=2)

    def create_request(
        self,
        *,
        capability_id: str,
        proposed_action: str,
        args: Optional[Dict[str, Any]] = None,
        trace_id: Optional[str] = None,
        task_id: Optional[str] = None,
        expires_in_seconds: int = 3600,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        capability = require_capability(capability_id)
        approval_id = str(uuid.uuid4())
        request = {
            "id": approval_id,
            "trace_id": trace_id,
            "task_id": task_id,
            "capability_id": capability.id,
            "risk_level": capability.risk_level,
            "proposed_action": proposed_action,
            "args_preview": _redact(args or {}),
            "status": "pending",
            "created_at": _now_iso(),
            "updated_at": _now_iso(),
            "expires_at": (_now() + timedelta(seconds=expires_in_seconds)).isoformat(),
            "approved_by": None,
            "resolved_at": None,
            "metadata": metadata or {},
        }
        with self._lock:
            self._requests[approval_id] = request
            self._save()
        return dict(request)

    def get_request(self, approval_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            request = self._requests.get(approval_id)
            if not request:
                return None
            self._expire_if_needed(request)
            self._save()
            return dict(request)

    def list_requests(self, status: Optional[str] = None, limit: int = 100) -> List[Dict[str, Any]]:
        with self._lock:
            for request in self._requests.values():
                self._expire_if_needed(request)
            self._save()
            items = [dict(item) for item in self._requests.values() if status is None or item.get("status") == status]
        items.sort(key=lambda item: item.get("created_at") or "", reverse=True)
        return items[:limit]

    def approve(self, approval_id: str, approved_by: str = "local_user") -> Dict[str, Any]:
        return self._resolve(approval_id, "approved", approved_by=approved_by)

    def deny(self, approval_id: str, approved_by: str = "local_user", reason: Optional[str] = None) -> Dict[str, Any]:
        return self._resolve(approval_id, "denied", approved_by=approved_by, reason=reason)

    def expire_pending(self) -> int:
        expired = 0
        with self._lock:
            for request in self._requests.values():
                before = request.get("status")
                self._expire_if_needed(request)
                if before != request.get("status"):
                    expired += 1
            self._save()
        return expired

    def _resolve(
        self,
        approval_id: str,
        status: str,
        *,
        approved_by: str,
        reason: Optional[str] = None,
    ) -> Dict[str, Any]:
        with self._lock:
            request = self._requests.get(approval_id)
            if not request:
                raise KeyError(f"Approval not found: {approval_id}")
            self._expire_if_needed(request)
            if request.get("status") != "pending":
                raise ValueError(f"Approval is already {request.get('status')}")
            request["status"] = status
            request["approved_by"] = approved_by
            request["resolved_at"] = _now_iso()
            request["updated_at"] = _now_iso()
            if reason:
                request["reason"] = reason
            self._save()
            return dict(request)

    @staticmethod
    def _expire_if_needed(request: Dict[str, Any]) -> None:
        if request.get("status") != "pending":
            return
        expires_at = request.get("expires_at")
        if expires_at and _parse_iso(expires_at) <= _now():
            request["status"] = "expired"
            request["resolved_at"] = _now_iso()
            request["updated_at"] = _now_iso()


approval_service = ApprovalService()