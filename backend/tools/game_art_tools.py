"""LangChain tools for Game Art Agent."""

from __future__ import annotations

import json

from langchain.tools import tool

from core.game_art_analysis import gather_game_art_signals
from core.game_art_recipes import list_recipes
from services import game_art_service
from tools.gaming_trending import analyze_gaming_trends, get_gaming_trends
from tools.web_search_tools import search_web
from utils.logger import setup_logger

logger = setup_logger("game_art_tools")


@tool
def list_game_art_recipes(category: str = "") -> str:
    """List Game Art Agent recipes. Categories: style, character, scene, ui, research."""
    recipes = list_recipes(category=category or None)
    return json.dumps(recipes, ensure_ascii=False, indent=2)


@tool
def run_game_art_recipe(recipe_id: str, params_json: str = "{}") -> str:
    """Run a Game Art recipe. Example: style.guide with {\"game_name\": \"我的 RPG\"}."""
    try:
        params = json.loads(params_json) if params_json.strip() else {}
    except json.JSONDecodeError as exc:
        return json.dumps({"success": False, "error": f"Invalid params_json: {exc}"}, ensure_ascii=False)
    try:
        result = game_art_service.start_recipe(recipe_id, params)
        return json.dumps(result, ensure_ascii=False, indent=2)
    except ValueError as exc:
        return json.dumps({"success": False, "error": str(exc)}, ensure_ascii=False)


@tool
def collect_game_art_signals(topic: str) -> str:
    """Collect web search and gaming trend signals for visual/game art research."""
    result = gather_game_art_signals(topic)
    return json.dumps(result, ensure_ascii=False, indent=2)


GAME_ART_TOOLS = [
    list_game_art_recipes,
    run_game_art_recipe,
    collect_game_art_signals,
    search_web,
    get_gaming_trends,
    analyze_gaming_trends,
]
