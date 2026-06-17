"""LangChain tools for AI Podcast Production."""

from __future__ import annotations

import json

from langchain.tools import tool

from core.podcast_analysis import run_analysis
from core.podcast_recipes import list_recipes
from services import podcast_service
from utils.logger import setup_logger

logger = setup_logger("podcast_tools")


@tool
def list_podcast_recipes(category: str = "") -> str:
    """List AI Podcast Production recipes. Categories: plan, write, design, audio, publish."""
    recipes = list_recipes(category=category or None)
    return json.dumps(recipes, ensure_ascii=False, indent=2)


@tool
def run_podcast_recipe(recipe_id: str, params_json: str = "{}") -> str:
    """Run a Podcast recipe. Example params_json: {"topic": "AI 短剧创作", "format": "双人对话"}."""
    try:
        params = json.loads(params_json) if params_json.strip() else {}
    except json.JSONDecodeError as exc:
        return json.dumps({"success": False, "error": f"Invalid params_json: {exc}"}, ensure_ascii=False)
    try:
        result = podcast_service.start_recipe(recipe_id, params)
        return json.dumps(result, ensure_ascii=False, indent=2)
    except ValueError as exc:
        return json.dumps({"success": False, "error": str(exc)}, ensure_ascii=False)


@tool
def plan_podcast_episode(
    topic: str,
    format: str = "双人对话",
    audience: str = "普通听众",
    tone: str = "轻松",
    duration: int = 15,
) -> str:
    """Plan a podcast episode: positioning, structure and host personas."""
    try:
        result = run_analysis(
            "podcast.plan",
            {"topic": topic, "format": format, "audience": audience, "tone": tone, "duration": duration},
        )
        return json.dumps(result, ensure_ascii=False, indent=2)
    except Exception as exc:
        return json.dumps({"success": False, "error": str(exc)}, ensure_ascii=False)


@tool
def write_podcast_script(
    topic: str,
    format: str = "双人对话",
    hosts: str = "",
    duration: int = 15,
    tone: str = "轻松",
) -> str:
    """Write a full podcast script with timestamps and host dialogues."""
    try:
        result = run_analysis(
            "podcast.script",
            {"topic": topic, "format": format, "hosts": hosts, "duration": duration, "tone": tone},
        )
        return json.dumps(result, ensure_ascii=False, indent=2)
    except Exception as exc:
        return json.dumps({"success": False, "error": str(exc)}, ensure_ascii=False)


@tool
def design_podcast_cover(title: str, topic: str = "", style: str = "现代简约") -> str:
    """Generate a podcast cover art concept and image prompt."""
    try:
        result = run_analysis("podcast.cover", {"title": title, "topic": topic, "style": style})
        return json.dumps(result, ensure_ascii=False, indent=2)
    except Exception as exc:
        return json.dumps({"success": False, "error": str(exc)}, ensure_ascii=False)


PODCAST_TOOLS = [
    list_podcast_recipes,
    run_podcast_recipe,
    plan_podcast_episode,
    write_podcast_script,
    design_podcast_cover,
]
