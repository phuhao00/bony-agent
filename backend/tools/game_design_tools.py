"""LangChain tools for Game Design Agent."""

from __future__ import annotations

import json

from langchain.tools import tool

from core.game_design_analysis import gather_game_design_signals
from core.game_design_recipes import list_recipes
from services import game_design_service
from tools.gaming_trending import analyze_gaming_trends, get_gaming_trends
from tools.web_search_tools import search_web
from utils.logger import setup_logger

logger = setup_logger("game_design_tools")


@tool
def list_game_design_recipes(category: str = "") -> str:
    """List Game Design Agent recipes. Categories: concept, system, level, narrative, balance."""
    recipes = list_recipes(category=category or None)
    return json.dumps(recipes, ensure_ascii=False, indent=2)


@tool
def run_game_design_recipe(recipe_id: str, params_json: str = "{}") -> str:
    """Run a Game Design recipe. Example: concept.pitch with {\"idea\": \"Roguelike 卡牌\"}."""
    try:
        params = json.loads(params_json) if params_json.strip() else {}
    except json.JSONDecodeError as exc:
        return json.dumps({"success": False, "error": f"Invalid params_json: {exc}"}, ensure_ascii=False)
    try:
        result = game_design_service.start_recipe(recipe_id, params)
        return json.dumps(result, ensure_ascii=False, indent=2)
    except ValueError as exc:
        return json.dumps({"success": False, "error": str(exc)}, ensure_ascii=False)


@tool
def collect_game_design_signals(topic: str) -> str:
    """Collect web search and gaming trend signals for game design research."""
    result = gather_game_design_signals(topic)
    return json.dumps(result, ensure_ascii=False, indent=2)


GAME_DESIGN_TOOLS = [
    list_game_design_recipes,
    run_game_design_recipe,
    collect_game_design_signals,
    search_web,
    get_gaming_trends,
    analyze_gaming_trends,
]
