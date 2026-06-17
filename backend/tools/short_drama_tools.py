"""LangChain tools for AI Short Drama."""

from __future__ import annotations

import json

from langchain.tools import tool

from core.short_drama_analysis import run_analysis
from core.short_drama_recipes import list_recipes
from services import short_drama_service
from utils.logger import setup_logger

logger = setup_logger("short_drama_tools")


@tool
def list_short_drama_recipes(category: str = "") -> str:
    """List AI Short Drama recipes. Categories: pre, produce."""
    recipes = list_recipes(category=category or None)
    return json.dumps(recipes, ensure_ascii=False, indent=2)


@tool
def run_short_drama_recipe(recipe_id: str, params_json: str = "{}") -> str:
    """Run a Short Drama recipe. Example params_json: {"brief": "女主误会男主", "platform": "douyin"}."""
    try:
        params = json.loads(params_json) if params_json.strip() else {}
    except json.JSONDecodeError as exc:
        return json.dumps({"success": False, "error": f"Invalid params_json: {exc}"}, ensure_ascii=False)
    try:
        result = short_drama_service.start_recipe(recipe_id, params)
        return json.dumps(result, ensure_ascii=False, indent=2)
    except ValueError as exc:
        return json.dumps({"success": False, "error": str(exc)}, ensure_ascii=False)


@tool
def analyze_short_drama_brief(brief: str, platform: str = "douyin", duration: int = 60, style: str = "甜宠") -> str:
    """Analyze a short drama brief and return a script with characters and scenes."""
    try:
        result = run_analysis(
            "short_drama.script",
            {"brief": brief, "platform": platform, "duration": duration, "style": style},
        )
        return json.dumps(result, ensure_ascii=False, indent=2)
    except Exception as exc:
        return json.dumps({"success": False, "error": str(exc)}, ensure_ascii=False)


@tool
def build_short_drama_storyboard(
    brief: str, platform: str = "douyin", duration: int = 60, style: str = "甜宠", scenes: int = 6
) -> str:
    """Build a visual storyboard for a short drama."""
    try:
        result = run_analysis(
            "short_drama.storyboard",
            {"brief": brief, "platform": platform, "duration": duration, "style": style, "scenes": scenes},
        )
        return json.dumps(result, ensure_ascii=False, indent=2)
    except Exception as exc:
        return json.dumps({"success": False, "error": str(exc)}, ensure_ascii=False)


SHORT_DRAMA_TOOLS = [
    list_short_drama_recipes,
    run_short_drama_recipe,
    analyze_short_drama_brief,
    build_short_drama_storyboard,
]
