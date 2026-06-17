"""Bidirectional skill sync between Hermes (~/.hermes/skills) and .agent/skills."""

from __future__ import annotations

import json
import re
import shutil
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from utils.logger import setup_logger

logger = setup_logger("skill_sync")

_FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)

PROJECT_ROOT = Path(__file__).resolve().parents[2]
SKILLS_DIR = PROJECT_ROOT / ".agent" / "skills"
QUARANTINE_DIR = PROJECT_ROOT / "storage" / "skills_quarantine"
SYNC_LOG_PATH = PROJECT_ROOT / "storage" / "evolution" / "skill_sync.jsonl"

_DANGEROUS_PATTERNS = [
    re.compile(r"ignore\s+(all\s+)?previous\s+instructions", re.I),
    re.compile(r"curl\s+.*\|\s*bash", re.I),
    re.compile(r"rm\s+-rf\s+/", re.I),
    re.compile(r"eval\s*\(", re.I),
    re.compile(r"__import__\s*\(", re.I),
]


def _hermes_skills_dir() -> Path:
    return Path.home() / ".hermes" / "skills"


def _scan_skill_content(content: str) -> List[str]:
    issues: List[str] = []
    for pattern in _DANGEROUS_PATTERNS:
        if pattern.search(content):
            issues.append(f"matched: {pattern.pattern}")
    return issues


def _append_sync_log(event: Dict[str, Any]) -> None:
    SYNC_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    event.setdefault("ts", time.time())
    with SYNC_LOG_PATH.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(event, ensure_ascii=False) + "\n")


def _write_hermes_skill_metadata(skill_dir: Path, *, source: str, trust_level: str) -> None:
    skill_file = skill_dir / "SKILL.md"
    if not skill_file.exists():
        return
    content = skill_file.read_text(encoding="utf-8", errors="ignore")
    match = _FRONTMATTER_RE.match(content)
    if match and "source:" in match.group(1):
        return
    body = _FRONTMATTER_RE.sub("", content, count=1).lstrip("\n") if match else content
    header = (
        f"---\n"
        f"name: {skill_dir.name}\n"
        f"source: {source}\n"
        f"trust_level: {trust_level}\n"
        f"synced_at: {int(time.time())}\n"
        f"---\n\n"
    )
    skill_file.write_text(header + body, encoding="utf-8")


def sync_from_hermes(*, dry_run: bool = False) -> Dict[str, Any]:
    """Import skills from ~/.hermes/skills into .agent/skills with quarantine scan."""
    src_root = _hermes_skills_dir()
    if not src_root.exists():
        return {"success": True, "imported": [], "quarantined": [], "skipped": [], "message": "No Hermes skills dir"}

    imported: List[str] = []
    quarantined: List[str] = []
    skipped: List[str] = []

    SKILLS_DIR.mkdir(parents=True, exist_ok=True)
    QUARANTINE_DIR.mkdir(parents=True, exist_ok=True)

    for item in sorted(src_root.iterdir()):
        if not item.is_dir():
            continue
        skill_id = item.name
        src_file = item / "SKILL.md"
        if not src_file.exists():
            skipped.append(skill_id)
            continue

        content = src_file.read_text(encoding="utf-8", errors="ignore")
        issues = _scan_skill_content(content)
        dest = SKILLS_DIR / skill_id

        if issues:
            quarantined.append(skill_id)
            if not dry_run:
                qdest = QUARANTINE_DIR / skill_id
                if qdest.exists():
                    shutil.rmtree(qdest)
                shutil.copytree(item, qdest)
                (qdest / "SCAN_REPORT.json").write_text(
                    json.dumps({"issues": issues, "source": "hermes"}, indent=2),
                    encoding="utf-8",
                )
            _append_sync_log({"action": "quarantine", "skill_id": skill_id, "issues": issues})
            continue

        if dest.exists():
            skipped.append(skill_id)
            continue

        if not dry_run:
            shutil.copytree(item, dest)
            _write_hermes_skill_metadata(dest, source="hermes", trust_level="review")
            (dest / ".hermes-import").write_text("1", encoding="utf-8")
        imported.append(skill_id)
        _append_sync_log({"action": "import", "skill_id": skill_id, "source": "hermes"})

    return {
        "success": True,
        "dry_run": dry_run,
        "imported": imported,
        "quarantined": quarantined,
        "skipped": skipped,
    }


def sync_to_hermes(*, dry_run: bool = False, only_enabled: bool = True) -> Dict[str, Any]:
    """Export enabled platform skills to ~/.hermes/skills (non-destructive)."""
    from services.skill_runtime import SKILLS_ENABLED_PATH, list_skill_index

    dest_root = _hermes_skills_dir()
    enabled: Dict[str, bool] = {}
    if SKILLS_ENABLED_PATH.exists():
        try:
            enabled = json.loads(SKILLS_ENABLED_PATH.read_text(encoding="utf-8"))
        except Exception:
            enabled = {}

    exported: List[str] = []
    skipped: List[str] = []

    if not dry_run:
        dest_root.mkdir(parents=True, exist_ok=True)

    for entry in list_skill_index(include_disabled=not only_enabled):
        if only_enabled and not entry.enabled:
            continue
        if entry.source not in {"builtin", "taste-skill"}:
            skipped.append(entry.id)
            continue
        src = SKILLS_DIR / entry.id
        dest = dest_root / entry.id
        if dest.exists():
            skipped.append(entry.id)
            continue
        if not dry_run:
            shutil.copytree(src, dest)
        exported.append(entry.id)
        _append_sync_log({"action": "export", "skill_id": entry.id, "target": "hermes"})

    return {"success": True, "dry_run": dry_run, "exported": exported, "skipped": skipped}
