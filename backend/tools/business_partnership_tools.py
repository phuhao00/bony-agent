"""LangChain tools for Business Partnership Assistant."""

from __future__ import annotations

import json

from langchain.tools import tool

from core.business_partnership_analysis import gather_partnership_signals
from core.business_partnership_recipes import list_recipes
from services import business_partnership_service
from tools.social_trending import get_hot_topics
from tools.trend_tools import analyze_trends
from tools.web_search_tools import search_web
from utils.logger import setup_logger

logger = setup_logger("business_partnership_tools")


@tool
def list_business_partnership_recipes(category: str = "") -> str:
    """List Business Partnership recipes. Categories: outreach, proposal, contract, partner, pipeline."""
    recipes = list_recipes(category=category or None)
    return json.dumps(recipes, ensure_ascii=False, indent=2)


@tool
def run_business_partnership_recipe(recipe_id: str, params_json: str = "{}") -> str:
    """Run a Business Partnership recipe. Example: {\"our_company\": \"A\", \"target_partner\": \"B\"}."""
    try:
        params = json.loads(params_json) if params_json.strip() else {}
    except json.JSONDecodeError as exc:
        return json.dumps({"success": False, "error": f"Invalid params_json: {exc}"}, ensure_ascii=False)
    try:
        result = business_partnership_service.start_recipe(recipe_id, params)
        return json.dumps(result, ensure_ascii=False, indent=2)
    except ValueError as exc:
        return json.dumps({"success": False, "error": str(exc)}, ensure_ascii=False)


@tool
def collect_partnership_signals(topic: str) -> str:
    """Collect web search signals for a partner, industry, or cooperation topic."""
    result = gather_partnership_signals(topic)
    return json.dumps(result, ensure_ascii=False, indent=2)


BUSINESS_PARTNERSHIP_TOOLS = [
    list_business_partnership_recipes,
    run_business_partnership_recipe,
    collect_partnership_signals,
    search_web,
    get_hot_topics,
    analyze_trends,
]
