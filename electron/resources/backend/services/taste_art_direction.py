"""Taste-skill art direction — anti-slop prompt enrichment for image/video/copy generation."""

from __future__ import annotations

import json
import os
import re
from functools import lru_cache
from pathlib import Path
from typing import Optional

from utils.logger import setup_logger

logger = setup_logger("taste_art_direction")

PROJECT_ROOT = Path(__file__).resolve().parents[2]
CONFIG_PATH = PROJECT_ROOT / "storage" / "taste_art_direction.json"

TASK_KIND_TO_SKILL = {
    "image_web": "imagegen-frontend-web",
    "image_mobile": "imagegen-frontend-mobile",
    "brand": "brandkit",
    "copy": "design-taste-frontend",
    "video": "imagegen-frontend-web",
    "ui_landing": "design-taste-frontend",
}

_IMAGE_WEB_COMPACT = """
[Taste Art Direction — premium website comp, anti-slop]
- ONE horizontal website section per image; never compress multiple sections into one frame.
- BANNED: purple/blue AI glow gradients, centered dark hero cliché, three equal feature cards, generic glassmorphism, floating meaningless blobs, weak typography hierarchy, text-only layouts without visuals.
- Hero: avoid default left-text/right-image unless strongest choice; prefer varied compositions (centered over image, editorial split, bento, image-as-canvas).
- Specify: subject, layout grid, typography hierarchy (display + body sizes), color palette (one accent + neutral family), lighting direction, spacing generosity, implementation-friendly UI reference (IMPLEMENTATION_CLARITY high).
- Use concrete art direction; never vague words like "高级感" or "精美" without specifics.
""".strip()

_IMAGE_MOBILE_COMPACT = """
[Taste Art Direction — premium mobile app screen, anti-slop]
- App-native screen inside subtle phone mockup; readable type, controlled palette, strong hierarchy.
- BANNED: generic dashboard card spam, neon AI gradients, illegible micro-text, inconsistent multi-screen styling.
- Specify: screen type, platform (iOS/Android), component layout, type scale, accent color, spacing, one clear primary action.
""".strip()

_BRAND_COMPACT = """
[Taste Art Direction — premium brand kit board, anti-slop]
- Intentional logo mark, sparse typography, grid-based presentation board, coherent palette, premium mockup applications.
- BANNED: random logos, messy AI moodboards, decoration without strategy.
""".strip()

_VIDEO_COMPACT = """
[Taste Art Direction — cinematic video, anti-slop]
- Motivated camera movement with narrative purpose; single consistent color grade and lighting direction.
- BANNED: generic stock footage feel, random scene jumps, oversaturated AI purple/blue, meaningless B-roll without story beat.
- Specify: shot type, subject motion, lighting (key/fill), lens feel, duration rhythm, brand palette continuity.
""".strip()

_COPY_ANTI_SLOP = """
[Copy anti-slop — taste-skill rules]
- BANNED filler verbs: Elevate, Seamless, Unleash, Next-Gen, Revolutionize, Game-changer, Delve.
- BANNED brand slop names: Acme, Nexus, SmartFlow, Cloudly; use contextual realistic names.
- BANNED fake stats: 99.99%, perfect round marketing numbers; use organic figures.
- BANNED generic placeholders: John Doe, Jane Smith, Lorem Ipsum.
- BANNED AI marketing purple-gradient hype tone; write plain, specific, platform-appropriate language.
- Do NOT overuse emoji; use sparingly only if platform truly expects it.
- COPY SELF-AUDIT: every headline and CTA must make literal sense; rewrite cute or vague AI copy.
""".strip()

_SKILL_COMPACT = {
    "imagegen-frontend-web": _IMAGE_WEB_COMPACT,
    "imagegen-frontend-mobile": _IMAGE_MOBILE_COMPACT,
    "brandkit": _BRAND_COMPACT,
    "design-taste-frontend": _COPY_ANTI_SLOP,
}


def _env_enabled() -> bool:
    raw = os.getenv("TASTE_ART_DIRECTION", "1").strip().lower()
    return raw not in {"0", "false", "no", "off"}


def _file_config_enabled() -> Optional[bool]:
    if not CONFIG_PATH.exists():
        return None
    try:
        data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        if isinstance(data, dict) and "enabled" in data:
            return bool(data["enabled"])
    except Exception as exc:
        logger.warning("[taste] config read failed: %s", exc)
    return None


def is_taste_art_direction_enabled() -> bool:
    file_val = _file_config_enabled()
    if file_val is not None:
        return file_val
    return _env_enabled()


def pick_skill_id(task_kind: str) -> str:
    return TASK_KIND_TO_SKILL.get(task_kind, "imagegen-frontend-web")


@lru_cache(maxsize=16)
def _cached_skill_excerpt(skill_id: str, max_chars: int = 1800) -> str:
    try:
        from services.skill_runtime import load_skill_body

        body = load_skill_body(skill_id)
        if not body:
            return ""
        body = re.sub(r"^---\s*\n.*?\n---\s*\n", "", body, count=1, flags=re.DOTALL)
        for marker in (
            "# HARD OUTPUT RULE",
            "# CORE DIRECTIVE",
            "# BRANDKIT IMAGE GENERATION",
            "COPY SELF-AUDIT",
        ):
            idx = body.find(marker)
            if idx >= 0:
                return body[idx : idx + max_chars].strip()
        return body[:max_chars].strip()
    except Exception as exc:
        logger.debug("[taste] skill excerpt failed %s: %s", skill_id, exc)
        return ""


def load_art_direction_block(skill_id: str, *, include_excerpt: bool = False) -> str:
    compact = _SKILL_COMPACT.get(skill_id, _IMAGE_WEB_COMPACT)
    if not include_excerpt:
        return compact
    excerpt = _cached_skill_excerpt(skill_id)
    if excerpt:
        return f"{compact}\n\n[Skill excerpt]\n{excerpt[:1200]}"
    return compact


def enrich_image_prompt(
    brief: str,
    *,
    section: Optional[str] = None,
    skill_id: Optional[str] = None,
    task_kind: str = "image_web",
) -> str:
    if not is_taste_art_direction_enabled():
        return brief
    sid = skill_id or pick_skill_id(task_kind)
    block = load_art_direction_block(sid)
    parts = [block]
    if section:
        parts.append(f"[Section focus: {section}] Generate exactly ONE horizontal comp for this section only.")
    parts.append(f"User brief:\n{brief.strip()}")
    enriched = "\n\n".join(parts)
    logger.info(
        "[taste] enrich_image_prompt skill=%s section=%s in_len=%d out_len=%d",
        sid,
        section or "-",
        len(brief),
        len(enriched),
    )
    return enriched


def enrich_video_prompt(brief: str, *, ref_image_context: Optional[str] = None) -> str:
    if not is_taste_art_direction_enabled():
        return brief
    parts = [_VIDEO_COMPACT]
    if ref_image_context:
        parts.append(f"[Reference visual context]\n{ref_image_context.strip()[:800]}")
    parts.append(f"User brief:\n{brief.strip()}")
    enriched = "\n\n".join(parts)
    logger.info("[taste] enrich_video_prompt in_len=%d out_len=%d", len(brief), len(enriched))
    return enriched


def copy_anti_slop_block() -> str:
    return _COPY_ANTI_SLOP


def pipeline_taste_metadata(goal: str) -> dict:
    if not is_taste_art_direction_enabled():
        return {}
    g = (goal or "").strip()
    design_read = (
        f"Reading pipeline goal as: {g[:200]}, with taste anti-slop art direction for image/video/copy steps."
        if g
        else "Reading pipeline goal as: marketing content, anti-slop art direction, image-led sections."
    )
    return {
        "taste_art_direction": True,
        "taste_design_read": design_read,
        "taste_image_skill": pick_skill_id("image_web"),
        "taste_copy_rules": True,
    }


def enrich_pipeline_prompt(step_id: str, prompt: str, metadata: Optional[dict] = None) -> str:
    if not is_taste_art_direction_enabled():
        return prompt
    md = metadata or {}
    design_read = md.get("taste_design_read", "")
    prefix = f"{design_read}\n\n" if design_read else ""
    if step_id == "image":
        return enrich_image_prompt(f"{prefix}{prompt}", task_kind="image_web")
    if step_id == "video":
        return enrich_video_prompt(f"{prefix}{prompt}")
    if step_id in ("script", "storyboard"):
        return f"{prefix}{copy_anti_slop_block()}\n\n{prompt.strip()}"
    return prompt


def media_agent_taste_prompt_block() -> str:
    if not is_taste_art_direction_enabled():
        return ""
    return (
        "\n# TASTE ART DIRECTION (mandatory for generate_image / generate_video)\n"
        "Before calling media tools, apply anti-slop rules: no AI purple-blue gradients, no generic three-card layouts, "
        "no vague 'premium/high quality' without concrete layout/lighting/palette. "
        "For website/marketing images: one section per generate_image call with specific composition. "
        "For video: motivated camera + consistent grade.\n"
    )
