"""Dry-run learning curator for memory candidates, reflections, and feedback."""

from __future__ import annotations

import json
import threading
import uuid
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from services.learning_data_pipeline import append_event, list_events
from services.memory_evaluation import list_memory_usage
from services.memory_quality import list_candidates, normalize_content
from services.reflection_loop import list_reflections
from utils.logger import setup_logger

logger = setup_logger("learning_curator")

PROJECT_ROOT = Path(__file__).resolve().parents[2]
CURATOR_RUNS_DIR = PROJECT_ROOT / "storage" / "evolution" / "curator_runs"
_LOCK = threading.RLock()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _trim(value: Any, limit: int) -> str:
    text = "" if value is None else str(value).strip()
    if len(text) <= limit:
        return text
    return text[: limit - 1] + "..."


def _run_dir(run_id: str, base_dir: Optional[Path] = None) -> Path:
    return (base_dir or CURATOR_RUNS_DIR) / run_id


def _candidate_text(candidate: Dict[str, Any]) -> str:
    return normalize_content(str(candidate.get("content") or ""))


def _build_duplicate_suggestions(candidates: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    buckets: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for candidate in candidates:
        text = _candidate_text(candidate).casefold()
        if text:
            buckets[text].append(candidate)

    suggestions: List[Dict[str, Any]] = []
    for text, group in buckets.items():
        if len(group) < 2:
            continue
        suggestions.append(
            {
                "kind": "merge_memory_candidates",
                "title": "合并重复候选记忆",
                "candidate_ids": [item.get("id", "") for item in group],
                "evidence_count": len(group),
                "preview": _trim(group[0].get("content"), 240),
                "recommended_action": "review_and_merge",
            }
        )
    return suggestions


def _build_risk_suggestions(candidates: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    suggestions: List[Dict[str, Any]] = []
    for candidate in candidates:
        flags = candidate.get("risk_flags") or []
        status = candidate.get("status") or ""
        if status == "rejected" or flags:
            suggestions.append(
                {
                    "kind": "review_risky_memory_candidate",
                    "title": "审阅高风险候选记忆",
                    "candidate_id": candidate.get("id", ""),
                    "risk_flags": flags,
                    "preview": _trim(candidate.get("content"), 240),
                    "recommended_action": "keep_rejected_or_rewrite",
                }
            )
    return suggestions


def _build_feedback_suggestions(events: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    negative = Counter()
    positive = Counter()
    for event in events:
        if event.get("kind") != "feedback_signal":
            continue
        metadata = event.get("metadata") or {}
        target = f"{metadata.get('target_type', '')}:{metadata.get('target_id', '')}"
        if target == ":":
            continue
        action = event.get("action")
        if action in {"downvote", "thumbs_down", "rejected"}:
            negative[target] += 1
        elif action in {"upvote", "thumbs_up", "useful"}:
            positive[target] += 1

    suggestions: List[Dict[str, Any]] = []
    for target, count in negative.items():
        if count < 1:
            continue
        suggestions.append(
            {
                "kind": "review_negative_feedback_target",
                "title": "复查被否定的对象",
                "target": target,
                "negative_count": count,
                "positive_count": positive.get(target, 0),
                "recommended_action": "review_or_mark_stale",
            }
        )
    return suggestions


def _build_reflection_suggestions(reflections: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    failed = [row for row in reflections if row.get("trace_status") == "failed"]
    if not failed:
        return []
    return [
        {
            "kind": "extract_failure_playbook",
            "title": "从失败任务提取经验 playbook",
            "trace_ids": [row.get("trace_id", "") for row in failed[:10]],
            "evidence_count": len(failed),
            "recommended_action": "write_or_update_playbook_candidate",
        }
    ]


def _build_memory_usage_suggestions(memory_usage: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    summary: Dict[str, Counter] = defaultdict(Counter)
    for row in memory_usage:
        memory_id = row.get("memory_id") or ""
        if not memory_id:
            continue
        if row.get("kind") == "recall":
            summary[memory_id]["recalls"] += 1
        elif row.get("kind") == "outcome":
            if row.get("polarity") == "positive":
                summary[memory_id]["positive"] += 1
            elif row.get("polarity") == "negative":
                summary[memory_id]["negative"] += 1
            else:
                summary[memory_id]["neutral"] += 1
    suggestions: List[Dict[str, Any]] = []
    for memory_id, counts in summary.items():
        recalls = int(counts.get("recalls", 0))
        positive = int(counts.get("positive", 0))
        negative = int(counts.get("negative", 0))
        if negative > positive:
            suggestions.append(
                {
                    "kind": "decrease_memory_confidence",
                    "title": "降低或复查被否定的记忆",
                    "memory_id": memory_id,
                    "recalls": recalls,
                    "positive": positive,
                    "negative": negative,
                    "recommended_action": "review_memory_or_mark_stale",
                }
            )
        elif positive >= 2 and positive > negative:
            suggestions.append(
                {
                    "kind": "increase_memory_confidence",
                    "title": "提升多次有效的记忆置信度",
                    "memory_id": memory_id,
                    "recalls": recalls,
                    "positive": positive,
                    "negative": negative,
                    "recommended_action": "review_and_raise_confidence",
                }
            )
        elif recalls >= 3 and positive == 0 and negative == 0:
            suggestions.append(
                {
                    "kind": "review_unconfirmed_memory_usage",
                    "title": "复查多次召回但未确认有效的记忆",
                    "memory_id": memory_id,
                    "recalls": recalls,
                    "positive": positive,
                    "negative": negative,
                    "recommended_action": "ask_for_feedback_or_mark_stale",
                }
            )
    return suggestions


def _write_report(run: Dict[str, Any], run_path: Path) -> str:
    lines = [
        f"# Learning Curator Run {run['id']}",
        "",
        f"- Created at: {run['created_at']}",
        f"- Dry run: {run['dry_run']}",
        f"- Candidates scanned: {run['stats']['candidate_count']}",
        f"- Reflections scanned: {run['stats']['reflection_count']}",
        f"- Events scanned: {run['stats']['event_count']}",
        f"- Memory usage rows scanned: {run['stats'].get('memory_usage_count', 0)}",
        f"- Suggestions: {len(run['suggestions'])}",
        "",
        "## Suggestions",
    ]
    if not run["suggestions"]:
        lines.append("No suggestions generated.")
    for index, suggestion in enumerate(run["suggestions"], 1):
        lines.extend(
            [
                "",
                f"### {index}. {suggestion.get('title') or suggestion.get('kind')}",
                "",
                f"- Kind: {suggestion.get('kind')}",
                f"- Recommended action: {suggestion.get('recommended_action')}",
            ]
        )
        preview = suggestion.get("preview")
        if preview:
            lines.append(f"- Preview: {preview}")
        if suggestion.get("risk_flags"):
            lines.append(f"- Risk flags: {', '.join(suggestion['risk_flags'])}")
        if suggestion.get("candidate_ids"):
            lines.append(f"- Candidate ids: {', '.join(suggestion['candidate_ids'])}")
        if suggestion.get("candidate_id"):
            lines.append(f"- Candidate id: {suggestion['candidate_id']}")
        if suggestion.get("target"):
            lines.append(f"- Target: {suggestion['target']}")
        if suggestion.get("trace_ids"):
            lines.append(f"- Trace ids: {', '.join(suggestion['trace_ids'])}")
    report = "\n".join(lines) + "\n"
    (run_path / "report.md").write_text(report, encoding="utf-8")
    return report


def run_learning_curator(
    *,
    dry_run: bool = True,
    limit: int = 200,
    base_dir: Optional[Path] = None,
) -> Dict[str, Any]:
    """Generate an auditable curator report without mutating long-term assets."""
    limit = max(1, min(int(limit or 200), 1000))
    candidates = list_candidates(limit=limit)
    reflections = list_reflections(limit=limit)
    events = list_events(limit=limit)
    memory_usage = list_memory_usage(limit=limit)

    suggestions: List[Dict[str, Any]] = []
    suggestions.extend(_build_duplicate_suggestions(candidates))
    suggestions.extend(_build_risk_suggestions(candidates))
    suggestions.extend(_build_feedback_suggestions(events))
    suggestions.extend(_build_reflection_suggestions(reflections))
    suggestions.extend(_build_memory_usage_suggestions(memory_usage))

    run_id = str(uuid.uuid4())
    run_path = _run_dir(run_id, base_dir=base_dir)
    run_path.mkdir(parents=True, exist_ok=True)
    run = {
        "id": run_id,
        "created_at": _now_iso(),
        "dry_run": bool(dry_run),
        "stats": {
            "candidate_count": len(candidates),
            "reflection_count": len(reflections),
            "event_count": len(events),
            "memory_usage_count": len(memory_usage),
            "suggestion_count": len(suggestions),
        },
        "suggestions": suggestions,
        "applied_actions": [],
    }

    with _LOCK:
        (run_path / "run.json").write_text(json.dumps(run, ensure_ascii=False, indent=2), encoding="utf-8")
        report = _write_report(run, run_path)

    try:
        append_event(
            "curator_run",
            source="learning_curator",
            action="run",
            status="dry_run" if dry_run else "planned",
            summary=f"Learning curator generated {len(suggestions)} suggestion(s)",
            artifact_ref=str(run_path.relative_to(PROJECT_ROOT)),
            metadata={"run_id": run_id, "stats": run["stats"]},
        )
    except Exception as exc:
        logger.warning("Failed to append curator learning event: %s", exc)

    return {"success": True, "run": run, "report": report, "path": str(run_path)}


def list_curator_runs(*, limit: int = 50, base_dir: Optional[Path] = None) -> List[Dict[str, Any]]:
    root = base_dir or CURATOR_RUNS_DIR
    if not root.exists():
        return []
    runs: List[Dict[str, Any]] = []
    for path in root.iterdir():
        if not path.is_dir():
            continue
        run_file = path / "run.json"
        if not run_file.exists():
            continue
        try:
            run = json.loads(run_file.read_text(encoding="utf-8"))
            runs.append({"id": run.get("id"), "created_at": run.get("created_at"), "stats": run.get("stats", {}), "dry_run": run.get("dry_run", True)})
        except Exception as exc:
            logger.warning("Skipping broken curator run %s: %s", path.name, exc)
    runs.sort(key=lambda item: item.get("created_at") or "", reverse=True)
    return runs[: max(1, min(int(limit or 50), 1000))]


def get_curator_run(run_id: str, *, base_dir: Optional[Path] = None) -> Optional[Dict[str, Any]]:
    run_id = (run_id or "").strip()
    if not run_id:
        return None
    run_path = _run_dir(run_id, base_dir=base_dir)
    run_file = run_path / "run.json"
    if not run_file.exists():
        return None
    run = json.loads(run_file.read_text(encoding="utf-8"))
    report_path = run_path / "report.md"
    return {
        "run": run,
        "report": report_path.read_text(encoding="utf-8") if report_path.exists() else "",
        "path": str(run_path),
    }
