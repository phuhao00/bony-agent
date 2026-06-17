"""Load Product Manager skill bundles (SKILL.md + template + example)."""

from __future__ import annotations

from typing import Any, Dict, Optional

from services.skill_runtime import get_skills_dir, load_skill_body
from utils.logger import setup_logger

logger = setup_logger("pm_skill_loader")

PM_SKILL_IDS = (
    "discovery-process",
    "jobs-to-be-done",
    "product-strategy-session",
    "roadmap-planning",
    "user-story",
    "prioritization-advisor",
)

# recipe_id -> skill_id
RECIPE_SKILL_MAP: Dict[str, str] = {
    "pm.discovery": "discovery-process",
    "pm.jtbd": "jobs-to-be-done",
    "pm.strategy": "product-strategy-session",
    "pm.roadmap": "roadmap-planning",
    "pm.user_story": "user-story",
    "pm.prioritize": "prioritization-advisor",
}


def _read_optional(path) -> str:
    try:
        if path.exists():
            return path.read_text(encoding="utf-8", errors="ignore").strip()
    except Exception as exc:
        logger.warning("[pm_skill_loader] read failed %s: %s", path, exc)
    return ""


def load_pm_skill_bundle(skill_id: str) -> Dict[str, Any]:
    """Return skill_body, template, example, and metadata for LLM injection."""
    skill_id = (skill_id or "").strip()
    if skill_id not in PM_SKILL_IDS:
        raise ValueError(f"Unknown PM skill: {skill_id}")

    skill_dir = get_skills_dir() / skill_id
    body = load_skill_body(skill_id) or ""
    if not body:
        raise FileNotFoundError(f"SKILL.md not found for {skill_id}")

    template = _read_optional(skill_dir / "template.md")
    example = _read_optional(skill_dir / "examples" / "sample.md")

    return {
        "skill_id": skill_id,
        "skill_body": body,
        "template": template,
        "example": example,
        "has_template": bool(template),
        "has_example": bool(example),
    }


def skill_id_for_recipe(recipe_id: str) -> Optional[str]:
    return RECIPE_SKILL_MAP.get(recipe_id)
