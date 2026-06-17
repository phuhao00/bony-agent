"""LangChain tools for Ad Campaign Assistant."""

from __future__ import annotations

import json

from langchain.tools import tool

from core.ad_campaign_analysis import gather_ad_signals
from core.ad_campaign_recipes import list_recipes
from services import ad_campaign_service
from tools.social_trending import get_hot_topics
from tools.trend_tools import analyze_trends
from tools.web_search_tools import search_web
from utils.logger import setup_logger

logger = setup_logger("ad_campaign_tools")


@tool
def list_ad_campaign_recipes(category: str = "") -> str:
    """List Ad Campaign Assistant recipes. Categories: strategy, creative, audience, budget, report."""
    recipes = list_recipes(category=category or None)
    return json.dumps(recipes, ensure_ascii=False, indent=2)


@tool
def run_ad_campaign_recipe(recipe_id: str, params_json: str = "{}") -> str:
    """Run an Ad Campaign recipe. Example params_json: {\"product\": \"SaaS 工具\"}."""
    try:
        params = json.loads(params_json) if params_json.strip() else {}
    except json.JSONDecodeError as exc:
        return json.dumps({"success": False, "error": f"Invalid params_json: {exc}"}, ensure_ascii=False)
    try:
        result = ad_campaign_service.start_recipe(recipe_id, params)
        return json.dumps(result, ensure_ascii=False, indent=2)
    except ValueError as exc:
        return json.dumps({"success": False, "error": str(exc)}, ensure_ascii=False)


@tool
def collect_ad_signals(topic: str) -> str:
    """Collect web search and trend signals for an ad campaign topic or product."""
    result = gather_ad_signals(topic)
    return json.dumps(result, ensure_ascii=False, indent=2)


AD_CAMPAIGN_TOOLS = [
    list_ad_campaign_recipes,
    run_ad_campaign_recipe,
    collect_ad_signals,
    search_web,
    get_hot_topics,
    analyze_trends,
]
