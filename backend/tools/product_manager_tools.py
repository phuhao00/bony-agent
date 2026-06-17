"""LangChain tools for Product Manager Agent."""

from __future__ import annotations

import json
from typing import Optional

from langchain.tools import tool

from core.product_analysis import gather_market_signals
from core.product_manager_recipes import list_recipes
from services import product_manager_service
from tools.social_trending import get_hot_topics
from tools.trend_tools import analyze_trends
from tools.web_search_tools import search_web
from utils.logger import setup_logger

logger = setup_logger("product_manager_tools")


@tool
def list_product_manager_recipes(category: str = "") -> str:
    """List Product Manager Agent recipes. Categories: market, idea, product, competitor."""
    recipes = list_recipes(category=category or None)
    return json.dumps(recipes, ensure_ascii=False, indent=2)


@tool
def run_product_manager_recipe(recipe_id: str, params_json: str = "{}") -> str:
    """Run a Product Manager recipe. Example params_json: {\"topic\": \"AI 教育\"}."""
    try:
        params = json.loads(params_json) if params_json.strip() else {}
    except json.JSONDecodeError as exc:
        return json.dumps({"success": False, "error": f"Invalid params_json: {exc}"}, ensure_ascii=False)
    try:
        result = product_manager_service.start_recipe(recipe_id, params)
        return json.dumps(result, ensure_ascii=False, indent=2)
    except ValueError as exc:
        return json.dumps({"success": False, "error": str(exc)}, ensure_ascii=False)


@tool
def collect_market_signals(topic: str) -> str:
    """Collect web search and social trend signals for a market topic or product category."""
    result = gather_market_signals(topic)
    return json.dumps(result, ensure_ascii=False, indent=2)


PRODUCT_MANAGER_TOOLS = [
    list_product_manager_recipes,
    run_product_manager_recipe,
    collect_market_signals,
    search_web,
    get_hot_topics,
    analyze_trends,
]
