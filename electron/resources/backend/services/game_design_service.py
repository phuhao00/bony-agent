"""Game Design (策划) Agent workflow service."""

from __future__ import annotations

import time
from typing import Any, Dict, List, Optional

from core.game_design_analysis import run_analysis
from core.game_design_recipes import get_recipe, list_recipes
from utils.logger import setup_logger
from utils.task_manager import task_manager

logger = setup_logger("game_design_service")


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
        "agent_id": "game_design_agent",
        "recipe_count": len(recipes),
        "categories": categories,
        "focus_areas": [
            "概念案与核心玩法循环",
            "系统机制设计",
            "关卡与内容规划",
            "剧情与世界观",
            "数值平衡框架",
        ],
    }


def get_suggestions() -> Dict[str, Any]:
    env = get_environment()
    suggestions: List[Dict[str, Any]] = [
        {
            "id": "concept-casual",
            "title": "休闲手游概念案",
            "description": "卖点、用户与 MVP 边界",
            "recipe_id": "concept.pitch",
            "params": {"idea": "轻度合成+放置", "audience": "25-40 岁碎片时间玩家", "platform": "手游"},
            "category": "concept",
            "priority": 95,
            "reason": "立项阶段先收敛概念与验证范围",
        },
        {
            "id": "core-loop-action",
            "title": "动作游戏核心循环",
            "description": "动机、反馈与留存钩子",
            "recipe_id": "core.loop",
            "params": {"game_name": "你的动作游戏", "genre": "动作 RPG", "session_length": "15-20 分钟"},
            "category": "system",
            "priority": 92,
            "reason": "核心循环决定首周体验",
        },
        {
            "id": "system-growth",
            "title": "养成系统设计",
            "description": "成长、投放与系统边界",
            "recipe_id": "system.design",
            "params": {"system_name": "角色养成", "goals": "长线留存与付费动机"},
            "category": "system",
            "priority": 88,
            "reason": "养成是多数商业手游的中枢系统",
        },
        {
            "id": "narrative-scifi",
            "title": "科幻题材世界观大纲",
            "description": "势力、冲突与主线脉络",
            "recipe_id": "narrative.outline",
            "params": {"theme": "近未来科幻", "tone": "严肃带悬疑"},
            "category": "narrative",
            "priority": 82,
            "reason": "叙事与玩法结合前先立世界观支柱",
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
        "game_design_agent",
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
        message="收集中：玩法与市场信号",
        metadata={"steps": steps},
    )

    try:
        result = run_analysis(recipe_id, params)
    except Exception as exc:
        logger.error("[game_design] recipe %s failed: %s", recipe_id, exc, exc_info=True)
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
        message="策划文档完成",
        metadata={"steps": steps, "recipe_id": recipe_id},
    )
    return {"success": True, "status": "completed", "task_id": task_id, "result": result}


def get_task(task_id: str) -> Optional[Dict[str, Any]]:
    return task_manager.get_task(task_id)
