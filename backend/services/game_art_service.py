"""Game Art Agent workflow service."""

from __future__ import annotations

import time
from typing import Any, Dict, List, Optional

from core.game_art_analysis import run_analysis
from core.game_art_recipes import get_recipe, list_recipes
from utils.logger import setup_logger
from utils.task_manager import task_manager

logger = setup_logger("game_art_service")


def _default_steps(recipe_id: str) -> List[Dict[str, Any]]:
    recipe = get_recipe(recipe_id)
    if not recipe:
        return []
    now = time.time()
    return [
        {"id": step.id, "kind": step.kind, "status": "pending", "result": None, "updated_at": now}
        for step in recipe.steps
    ]


def get_environment() -> Dict[str, Any]:
    recipes = list_recipes()
    categories = sorted({r["category"] for r in recipes})
    return {
        "agent_id": "game_art_agent",
        "recipe_count": len(recipes),
        "categories": categories,
        "focus_areas": [
            "视觉风格与 Mood Board",
            "角色/场景概念 Brief",
            "UI 美术规范",
            "竞品视觉分析",
            "美术产能与规格建议",
        ],
    }


def get_suggestions() -> Dict[str, Any]:
    env = get_environment()
    suggestions: List[Dict[str, Any]] = [
        {
            "id": "style-fantasy-rpg",
            "title": "奇幻 RPG 视觉风格指南",
            "description": "定义色彩、光影与统一性规则",
            "recipe_id": "style.guide",
            "params": {"game_name": "你的奇幻 RPG", "genre": "奇幻 RPG", "mood": "史诗感与可读性平衡"},
            "category": "style",
            "priority": 95,
            "reason": "立项初期先定视觉锚点",
        },
        {
            "id": "visual-moba",
            "title": "同类赛道视觉扫描",
            "description": "扫描 MOBA/竞技类画面差异化",
            "recipe_id": "visual.research",
            "params": {"genre": "移动端 MOBA", "reference_games": "王者荣耀, 英雄联盟手游"},
            "category": "research",
            "priority": 90,
            "reason": "竞技品类画面同质化高，适合先做扫描",
        },
        {
            "id": "character-hero",
            "title": "主角角色设计 Brief",
            "description": "可交付原画的三视图与形体要点",
            "recipe_id": "character.brief",
            "params": {"character_name": "主角", "role": "可操控英雄"},
            "category": "character",
            "priority": 85,
            "reason": "角色是玩家情感载体，优先打磨",
        },
        {
            "id": "ui-mobile",
            "title": "手游 UI 美术规范草案",
            "description": "层级、组件与动效美术原则",
            "recipe_id": "ui.art.guide",
            "params": {"game_name": "你的手游", "platform": "手游"},
            "category": "ui",
            "priority": 80,
            "reason": "UI 与场景统一能显著提升品质感",
        },
    ]
    suggestions.sort(key=lambda s: -s.get("priority", 0))
    return {"environment": env, "suggestions": suggestions}


def start_recipe(
    recipe_id: str,
    params: Optional[Dict[str, Any]] = None,
    *,
    trace_id: Optional[str] = None,
) -> Dict[str, Any]:
    recipe = get_recipe(recipe_id)
    if not recipe:
        raise ValueError(f"Unknown recipe: {recipe_id}")

    params = dict(params or {})
    task_id = task_manager.create_task(
        "game_art_agent",
        metadata={
            "recipe_id": recipe_id,
            "params": params,
            "steps": _default_steps(recipe_id),
            "trace_id": trace_id,
        },
    )
    task_manager.update_task(task_id, status="running", progress=10, message=f"启动：{recipe.name}")

    steps = (task_manager.get_task(task_id) or {}).get("metadata", {}).get("steps") or []
    for step in steps:
        if step.get("id") == "collect" and step.get("status") == "pending":
            step["status"] = "running"
            step["updated_at"] = time.time()
            break
    task_manager.update_task(
        task_id,
        status="running",
        progress=25,
        message="收集中：视觉与游戏参考",
        metadata={"steps": steps},
    )

    try:
        result = run_analysis(recipe_id, params)
    except Exception as exc:
        logger.error("[game_art] recipe %s failed: %s", recipe_id, exc, exc_info=True)
        task_manager.update_task(
            task_id,
            status="failed",
            progress=100,
            message=str(exc),
            result={"error": str(exc)},
        )
        return {"success": False, "status": "failed", "task_id": task_id, "error": str(exc)}

    now = time.time()
    for step in steps:
        if step.get("status") in {"pending", "running"}:
            step["status"] = "completed"
            step["updated_at"] = now
    task_manager.update_task(
        task_id,
        status="completed",
        progress=100,
        result=result,
        message="美术方案完成",
        metadata={"steps": steps, "recipe_id": recipe_id},
    )
    return {"success": True, "status": "completed", "task_id": task_id, "result": result}


def get_task(task_id: str) -> Optional[Dict[str, Any]]:
    return task_manager.get_task(task_id)
