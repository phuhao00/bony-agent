"""LangChain tools for Procurement Assistant."""

from __future__ import annotations

import json

from langchain.tools import tool

from core.procurement_analysis import gather_procurement_signals
from core.procurement_recipes import list_recipes
from services import procurement_service
from tools.web_search_tools import search_web
from utils.logger import setup_logger

logger = setup_logger("procurement_tools")


@tool
def list_procurement_recipes(category: str = "") -> str:
    """List Procurement Assistant recipes. Categories: vendor, rfq, quote, contract, cost, sourcing."""
    recipes = list_recipes(category=category or None)
    return json.dumps(recipes, ensure_ascii=False, indent=2)


@tool
def run_procurement_recipe(recipe_id: str, params_json: str = "{}") -> str:
    """Run a Procurement recipe. Example params_json: {\"vendor_name\": \"某供应商\"}."""
    try:
        params = json.loads(params_json) if params_json.strip() else {}
    except json.JSONDecodeError as exc:
        return json.dumps({"success": False, "error": f"Invalid params_json: {exc}"}, ensure_ascii=False)
    try:
        result = procurement_service.start_recipe(recipe_id, params)
        return json.dumps(result, ensure_ascii=False, indent=2)
    except ValueError as exc:
        return json.dumps({"success": False, "error": str(exc)}, ensure_ascii=False)


@tool
def collect_procurement_signals(topic: str) -> str:
    """Collect web search signals for a procurement topic, vendor, or spend category."""
    result = gather_procurement_signals(topic)
    return json.dumps(result, ensure_ascii=False, indent=2)


PROCUREMENT_TOOLS = [
    list_procurement_recipes,
    run_procurement_recipe,
    collect_procurement_signals,
    search_web,
]
