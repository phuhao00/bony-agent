"""LangChain tools for Legal Advisor Agent."""

from __future__ import annotations

import json
from typing import Optional

from langchain.tools import tool

from core.legal_analysis import gather_legal_signals
from core.legal_recipes import list_recipes
from services import legal_service
from tools.web_search_tools import search_web
from utils.logger import setup_logger

logger = setup_logger("legal_tools")


@tool
def list_legal_recipes(category: str = "") -> str:
    """List Legal Advisor Agent recipes. Categories: case, compliance, regulation, contract, finance."""
    recipes = list_recipes(category=category or None)
    return json.dumps(recipes, ensure_ascii=False, indent=2)


@tool
def run_legal_recipe(recipe_id: str, params_json: str = "{}") -> str:
    """Run a Legal Advisor recipe. Example params_json: {\"topic\": \"劳动合同解除\"}."""
    try:
        params = json.loads(params_json) if params_json.strip() else {}
    except json.JSONDecodeError as exc:
        return json.dumps({"success": False, "error": f"Invalid params_json: {exc}"}, ensure_ascii=False)
    try:
        result = legal_service.start_recipe(recipe_id, params)
        return json.dumps(result, ensure_ascii=False, indent=2)
    except ValueError as exc:
        return json.dumps({"success": False, "error": str(exc)}, ensure_ascii=False)


@tool
def collect_legal_signals(topic: str) -> str:
    """Collect web search signals for legal cases, regulations and enforcement related to a topic."""
    result = gather_legal_signals(topic)
    return json.dumps(result, ensure_ascii=False, indent=2)


LEGAL_TOOLS = [
    list_legal_recipes,
    run_legal_recipe,
    collect_legal_signals,
    search_web,
]
