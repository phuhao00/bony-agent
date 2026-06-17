"""Safety and quality gates for long-term memory writes."""

from __future__ import annotations

import json
import re
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from services.knowledge_layers import ensure_knowledge_metadata
from utils.logger import setup_logger

logger = setup_logger("memory_quality")

PROJECT_ROOT = Path(__file__).resolve().parents[2]
CANDIDATES_FILE = PROJECT_ROOT / "storage" / "evolution" / "memory_candidates.jsonl"
_LOCK = threading.RLock()

MAX_MEMORY_CHARS = 4000
INVISIBLE_RE = re.compile(r"[\u200b\u200c\u200d\ufeff\u2060]")
PROMPT_INJECTION_PATTERNS = [
    re.compile(pattern, re.IGNORECASE)
    for pattern in [
        r"ignore (all )?(previous|above|prior) instructions",
        r"disregard (all )?(previous|above|prior) instructions",
        r"system prompt",
        r"developer message",
        r"你现在.*(忽略|绕过).*(指令|规则)",
        r"忽略(以上|之前|所有).*(指令|规则)",
        r"越狱|jailbreak",
    ]
]
SECRET_PATTERNS = [
    re.compile(pattern, re.IGNORECASE)
    for pattern in [
        r"\.env\b",
        r"api[_-]?key",
        r"secret[_-]?key",
        r"access[_-]?token",
        r"password\s*[:=]",
        r"sk-[A-Za-z0-9_-]{12,}",
        r"AKIA[0-9A-Z]{16}",
        r"读取.*(密钥|token|密码|凭证)",
        r"外传|exfiltrate",
    ]
]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_content(content: str) -> str:
    return INVISIBLE_RE.sub("", (content or "").strip())


def scan(content: str, source: str = "user") -> Dict[str, Any]:
    normalized = normalize_content(content)
    risk_flags: List[str] = []

    if not normalized:
        risk_flags.append("empty")
    if len(normalized) > MAX_MEMORY_CHARS:
        risk_flags.append("too_long")
    if normalized != (content or "").strip():
        risk_flags.append("invisible_unicode_removed")
    if any(pattern.search(normalized) for pattern in PROMPT_INJECTION_PATTERNS):
        risk_flags.append("prompt_injection")
    if any(pattern.search(normalized) for pattern in SECRET_PATTERNS):
        risk_flags.append("secret_or_exfiltration")

    blocking = {"empty", "prompt_injection", "secret_or_exfiltration"}
    return {
        "allowed": not any(flag in blocking for flag in risk_flags),
        "content": normalized,
        "risk_flags": risk_flags,
        "source": source or "user",
    }


def _load_memories(store: Any) -> List[Dict[str, Any]]:
    if not store:
        return []
    try:
        memories = store.get_all_memories()
        return memories if isinstance(memories, list) else []
    except Exception as exc:
        logger.warning("Failed to load memories for dedupe: %s", exc)
        return []


def dedupe(content: str, store: Any = None) -> Optional[Dict[str, Any]]:
    normalized = normalize_content(content).casefold()
    if not normalized:
        return None

    if store and hasattr(store, "find_by_content_hash"):
        duplicate_id = store.find_by_content_hash(content)
        if duplicate_id:
            for memory in _load_memories(store):
                if str(memory.get("id") or "") == duplicate_id:
                    return memory

    for memory in _load_memories(store):
        existing = normalize_content(str(memory.get("content") or "")).casefold()
        if existing == normalized:
            return memory
    return None


def classify(metadata: Optional[Dict[str, Any]] = None) -> str:
    metadata = metadata or {}
    if metadata.get("inferred") or metadata.get("source") in {"reflection", "agent", "curator"}:
        return "candidate"
    return "approved"


def score(content: str, metadata: Optional[Dict[str, Any]] = None, risk_flags: Optional[List[str]] = None) -> float:
    metadata = metadata or {}
    base = float(metadata.get("confidence", 0.7))
    penalties = 0.0
    flags = set(risk_flags or [])
    if "too_long" in flags:
        penalties += 0.2
    if "invisible_unicode_removed" in flags:
        penalties += 0.1
    if len(content) < 12:
        penalties += 0.15
    return max(0.0, min(1.0, base - penalties))


def write_candidate(candidate: Dict[str, Any], path: Optional[Path] = None) -> Dict[str, Any]:
    path = path or CANDIDATES_FILE
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "id": str(uuid.uuid4()),
        "created_at": _now_iso(),
        **candidate,
    }
    with _LOCK:
        with path.open("a", encoding="utf-8") as file:
            file.write(json.dumps(payload, ensure_ascii=False) + "\n")
    return payload


def list_candidates(
    *,
    status: Optional[str] = None,
    limit: int = 200,
    path: Optional[Path] = None,
) -> List[Dict[str, Any]]:
    path = path or CANDIDATES_FILE
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
                    row = json.loads(line)
                except json.JSONDecodeError:
                    logger.warning("Skipping invalid memory candidate line")
                    continue
                if status and row.get("status") != status:
                    continue
                rows.append(row)
    rows.sort(key=lambda item: item.get("created_at") or "", reverse=True)
    return rows[: max(1, min(int(limit or 200), 1000))]


def prepare_memory_write(
    content: str,
    metadata: Optional[Dict[str, Any]] = None,
    store: Any = None,
) -> Dict[str, Any]:
    metadata = dict(metadata or {})
    source = str(metadata.get("source") or "user")
    scan_result = scan(content, source=source)
    prepared_content = scan_result["content"]
    risk_flags = scan_result["risk_flags"]
    metadata = ensure_knowledge_metadata(prepared_content, metadata)

    if not scan_result["allowed"]:
        candidate = write_candidate(
            {
                "content": prepared_content,
                "metadata": metadata,
                "status": "rejected",
                "risk_flags": risk_flags,
                "reason": "blocked_by_memory_quality_gate",
            }
        )
        return {
            "action": "rejected",
            "allowed": False,
            "content": prepared_content,
            "metadata": metadata,
            "risk_flags": risk_flags,
            "candidate_id": candidate["id"],
            "error": "memory rejected by quality gate",
        }

    duplicate = dedupe(prepared_content, store=store)
    if duplicate:
        return {
            "action": "duplicate",
            "allowed": True,
            "content": duplicate.get("content") or prepared_content,
            "metadata": duplicate.get("metadata") or metadata,
            "risk_flags": risk_flags,
            "duplicate_id": duplicate.get("id", ""),
        }

    status = classify(metadata)
    metadata.update(
        {
            "status": status,
            "risk_flags": risk_flags,
            "quality_score": score(prepared_content, metadata, risk_flags),
            "reviewed_by": "user" if status == "approved" else "",
            "reviewed_at": _now_iso() if status == "approved" else "",
        }
    )

    if status != "approved":
        candidate = write_candidate(
            {
                "content": prepared_content,
                "metadata": metadata,
                "status": status,
                "risk_flags": risk_flags,
                "reason": "requires_review_before_prompt_use",
            }
        )
        return {
            "action": "candidate",
            "allowed": True,
            "content": prepared_content,
            "metadata": metadata,
            "risk_flags": risk_flags,
            "candidate_id": candidate["id"],
        }

    return {
        "action": "write",
        "allowed": True,
        "content": prepared_content,
        "metadata": metadata,
        "risk_flags": risk_flags,
    }
