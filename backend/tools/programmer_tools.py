"""LangChain tools for Programmer Agent."""

from __future__ import annotations

import json
from typing import Optional

from langchain.tools import tool

from core.infra_components import list_components, probe_component, scan_all_components
from core.programmer_recipes import list_recipes
from services import programmer_service
from utils.logger import setup_logger

logger = setup_logger("programmer_tools")


@tool
def list_programmer_recipes(category: str = "") -> str:
    """List Programmer Agent recipes. Categories: git, infra, dev."""
    recipes = list_recipes(category=category or None)
    return json.dumps(recipes, ensure_ascii=False, indent=2)


@tool
def run_programmer_recipe(recipe_id: str, params_json: str = "{}") -> str:
    """Run a Programmer Agent recipe. params_json example: {\"component_id\": \"redis\"}."""
    try:
        params = json.loads(params_json) if params_json.strip() else {}
    except json.JSONDecodeError as exc:
        return json.dumps({"success": False, "error": f"Invalid params_json: {exc}"}, ensure_ascii=False)
    try:
        result = programmer_service.start_recipe(recipe_id, params)
        return json.dumps(result, ensure_ascii=False, indent=2)
    except ValueError as exc:
        return json.dumps({"success": False, "error": str(exc)}, ensure_ascii=False)


@tool
def get_dev_environment() -> str:
    """Get git/ssh profile, dev tools versions, and infra component summary."""
    result = programmer_service.get_environment()
    return json.dumps(result, ensure_ascii=False, indent=2)


@tool
def scan_infra_components() -> str:
    """Scan Redis, MySQL, MongoDB, etcd, Consul, NSQ and other infra components."""
    result = scan_all_components()
    return json.dumps(result, ensure_ascii=False, indent=2)


@tool
def check_infra_component(component_id: str) -> str:
    """Health-check a single infra component by id (redis, mysql, mongodb, etcd, consul, nsq, etc.)."""
    result = probe_component(component_id)
    return json.dumps(result, ensure_ascii=False, indent=2)


@tool
def list_infra_catalog() -> str:
    """List supported infrastructure components and default ports."""
    return json.dumps(list_components(), ensure_ascii=False, indent=2)


PROGRAMMER_TOOLS = [
    list_programmer_recipes,
    run_programmer_recipe,
    get_dev_environment,
    scan_infra_components,
    check_infra_component,
    list_infra_catalog,
]
