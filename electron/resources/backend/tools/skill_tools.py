"""Agent tools for progressive skill disclosure (Hermes skills_list / skill_view)."""

from __future__ import annotations

import json

from langchain.tools import tool

from services.skill_runtime import (
    build_skill_index_prompt_block,
    list_skill_index,
    load_skill_body,
    record_skill_usage,
)
from utils.logger import setup_logger

logger = setup_logger("skill_tools")


@tool
def skills_list(include_disabled: bool = False) -> str:
    """List available agent skills (metadata only). Use skill_view to load full instructions."""
    entries = list_skill_index(include_disabled=include_disabled)
    if not entries:
        return "No skills found in .agent/skills/"
    payload = [e.to_dict() for e in entries]
    logger.info("[skill_tools] skills_list count=%d", len(payload))
    return json.dumps({"skills": payload, "count": len(payload)}, ensure_ascii=False, indent=2)


@tool
def skill_view(skill_id: str) -> str:
    """Load full SKILL.md instructions for a skill. Call before executing specialized workflows."""
    skill_id = (skill_id or "").strip()
    if not skill_id:
        return "Error: skill_id is required"

    body = load_skill_body(skill_id)
    if body is None:
        index = [e.id for e in list_skill_index(include_disabled=True)]
        return f"Skill '{skill_id}' not found. Available: {', '.join(index[:20])}"

    record_skill_usage(skill_id, action="use")
    logger.info("[skill_tools] skill_view id=%s len=%d", skill_id, len(body))
    return body


def skill_index_prompt_block() -> str:
    """Non-tool helper for system prompt augmentation."""
    return build_skill_index_prompt_block()
