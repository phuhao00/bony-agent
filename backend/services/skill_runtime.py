"""Progressive-disclosure skill runtime — Hermes-style index + on-demand load."""

from __future__ import annotations

import json
import os
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

from utils.logger import setup_logger

logger = setup_logger("skill_runtime")

PROJECT_ROOT = Path(__file__).resolve().parents[2]
SKILLS_ENABLED_PATH = PROJECT_ROOT / "storage" / "skills_enabled.json"
SKILL_USAGE_PATH = PROJECT_ROOT / "storage" / "evolution" / "skill_usage.jsonl"

_FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)


def get_skills_dir() -> Path:
    """Resolve skills root: bundled Electron path or dev `.agent/skills`."""
    raw = os.environ.get("AI_MEDIA_AGENT_SKILLS_DIR", "").strip()
    if raw:
        bundled = Path(raw).expanduser()
        if bundled.is_dir():
            return bundled.resolve()
    return (PROJECT_ROOT / ".agent" / "skills").resolve()


@dataclass
class SkillIndexEntry:
    id: str
    name: str
    description: str
    category: str
    version: str
    enabled: bool
    source: str = "builtin"
    trust_level: str = "trusted"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "category": self.category,
            "version": self.version,
            "enabled": self.enabled,
            "source": self.source,
            "trust_level": self.trust_level,
        }


def _load_enabled_state() -> Dict[str, bool]:
    if not SKILLS_ENABLED_PATH.exists():
        return {}
    try:
        raw = json.loads(SKILLS_ENABLED_PATH.read_text(encoding="utf-8"))
        return raw if isinstance(raw, dict) else {}
    except Exception as exc:
        logger.warning("[skill_runtime] failed to read enabled state: %s", exc)
        return {}


def _parse_frontmatter(content: str) -> Dict[str, str]:
    meta: Dict[str, str] = {}
    match = _FRONTMATTER_RE.match(content)
    if not match:
        return meta
    for line in match.group(1).splitlines():
        if ":" not in line:
            continue
        key, _, value = line.partition(":")
        meta[key.strip()] = value.strip()
    return meta


def _fallback_description(content: str) -> str:
    body = _FRONTMATTER_RE.sub("", content, count=1).strip()
    for line in body.splitlines():
        stripped = line.strip()
        if stripped and not stripped.startswith("#"):
            return stripped[:200]
    return ""


def _infer_source(skill_id: str) -> str:
    taste_ids = {
        "design-taste-frontend",
        "design-taste-frontend-v1",
        "image-to-code",
        "redesign-existing-projects",
        "full-output-enforcement",
        "minimalist-ui",
        "high-end-visual-design",
        "imagegen-frontend-web",
        "imagegen-frontend-mobile",
        "brandkit",
    }
    if skill_id in taste_ids:
        return "taste-skill"
    if skill_id.startswith("hermes-"):
        return "hermes"
    hermes_marker = get_skills_dir() / skill_id / ".hermes-import"
    if hermes_marker.exists():
        return "hermes"
    if skill_id == "last30days":
        return "external"
    if skill_id in {
        "discovery-process",
        "jobs-to-be-done",
        "product-strategy-session",
        "roadmap-planning",
        "user-story",
        "prioritization-advisor",
    }:
        return "external"
    return "builtin"


def list_skill_index(*, include_disabled: bool = False) -> List[SkillIndexEntry]:
    """Return metadata-only skill index (progressive disclosure layer 1)."""
    enabled = _load_enabled_state()
    entries: List[SkillIndexEntry] = []

    skills_dir = get_skills_dir()
    if not skills_dir.exists():
        logger.debug("[skill_runtime] skills dir missing: %s", skills_dir)
        return entries

    for skill_dir in sorted(skills_dir.iterdir()):
        if not skill_dir.is_dir() or skill_dir.name.startswith("."):
            continue
        skill_file = skill_dir / "SKILL.md"
        if not skill_file.exists():
            skill_file = skill_dir / "Skill.md"
        if not skill_file.exists():
            continue

        skill_id = skill_dir.name
        is_enabled = enabled.get(skill_id, True)
        if not include_disabled and not is_enabled:
            continue

        try:
            content = skill_file.read_text(encoding="utf-8", errors="ignore")
        except Exception as exc:
            logger.warning("[skill_runtime] read failed %s: %s", skill_id, exc)
            continue

        meta = _parse_frontmatter(content)
        description = meta.get("description") or _fallback_description(content)
        source = meta.get("source") or _infer_source(skill_id)
        entries.append(
            SkillIndexEntry(
                id=skill_id,
                name=meta.get("name") or meta.get("display_name") or skill_id,
                description=description,
                category=meta.get("category") or "General",
                version=meta.get("version") or "",
                enabled=is_enabled,
                source=source,
                trust_level=(
                    "trusted"
                    if source in {"builtin", "taste-skill"}
                    else "review"
                ),
            )
        )

    logger.debug("[skill_runtime] index size=%d include_disabled=%s", len(entries), include_disabled)
    return entries


def load_skill_body(skill_id: str) -> Optional[str]:
    """Load full SKILL.md body (progressive disclosure layer 2)."""
    skill_dir = get_skills_dir() / skill_id
    skill_file = skill_dir / "SKILL.md"
    if not skill_file.exists():
        skill_file = skill_dir / "Skill.md"
    if not skill_file.exists():
        logger.warning("[skill_runtime] skill not found: %s", skill_id)
        return None
    try:
        content = skill_file.read_text(encoding="utf-8", errors="ignore")
        record_skill_usage(skill_id, action="view")
        return content
    except Exception as exc:
        logger.error("[skill_runtime] load failed %s: %s", skill_id, exc)
        return None


def record_skill_usage(skill_id: str, *, action: str = "use", metadata: Optional[Dict[str, Any]] = None) -> None:
    """Append usage event to evolution sidecar (Hermes skill_usage pattern)."""
    SKILL_USAGE_PATH.parent.mkdir(parents=True, exist_ok=True)
    event = {
        "skill_id": skill_id,
        "action": action,
        "ts": time.time(),
        "metadata": metadata or {},
    }
    try:
        with SKILL_USAGE_PATH.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(event, ensure_ascii=False) + "\n")
    except Exception as exc:
        logger.warning("[skill_runtime] usage record failed: %s", exc)


def build_skill_index_prompt_block(*, max_entries: int = 24) -> str:
    """Compact index for system prompt — metadata only, no full SKILL bodies."""
    entries = list_skill_index()
    if not entries:
        return ""

    lines = [
        "## Available Agent Skills (metadata only — call skills_list / skill_view for details)",
        "Use skill_view(skill_id) before applying specialized workflows.",
        "",
    ]
    for entry in entries[:max_entries]:
        lines.append(f"- **{entry.id}** ({entry.name}): {entry.description[:120]}")
    if len(entries) > max_entries:
        lines.append(f"- … and {len(entries) - max_entries} more (skills_list for full index)")
    return "\n".join(lines)


def get_skill_usage_stats(limit: int = 200) -> Dict[str, Dict[str, int]]:
    """Aggregate recent usage counts per skill."""
    if not SKILL_USAGE_PATH.exists():
        return {}
    counts: Dict[str, Dict[str, int]] = {}
    try:
        lines = SKILL_USAGE_PATH.read_text(encoding="utf-8").splitlines()[-limit:]
        for line in lines:
            if not line.strip():
                continue
            event = json.loads(line)
            sid = str(event.get("skill_id", ""))
            action = str(event.get("action", "use"))
            counts.setdefault(sid, {})
            counts[sid][action] = counts[sid].get(action, 0) + 1
    except Exception as exc:
        logger.warning("[skill_runtime] usage stats failed: %s", exc)
    return counts
