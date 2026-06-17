"""AI Short Drama workflow service."""

from __future__ import annotations

import time
from typing import Any, Dict, List, Optional

from core.short_drama_analysis import run_analysis
from core.short_drama_recipes import get_recipe, list_recipes
from utils.logger import setup_logger
from utils.task_manager import task_manager

logger = setup_logger("short_drama_service")


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
        "agent_id": "short_drama_agent",
        "recipe_count": len(recipes),
        "categories": categories,
        "focus_areas": [
            "竖屏短剧剧本与角色设计",
            "可视化分镜与场景描述",
            "场景画面生成",
            "配音/字幕/BGM 建议",
            "多平台适配（抖音/快手/小红书/YouTube Shorts）",
        ],
    }


def get_suggestions() -> Dict[str, Any]:
    env = get_environment()
    suggestions: List[Dict[str, Any]] = [
        {
            "id": "drama-sweet",
            "title": "甜宠短剧",
            "description": "误会与和解，3 分钟高甜竖屏短剧",
            "recipe_id": "short_drama.produce",
            "params": {
                "brief": "女主在公司加班，总裁男主默默等她，最后两人一起吃宵夜解开误会",
                "platform": "douyin",
                "duration": 60,
                "style": "甜宠",
            },
            "category": "produce",
            "priority": 95,
            "reason": "甜宠是短剧主流题材",
        },
        {
            "id": "drama-suspense",
            "title": "悬疑反转短剧",
            "description": "30 秒悬念钩子 + 结尾反转",
            "recipe_id": "short_drama.storyboard",
            "params": {
                "brief": "独居女性回家发现门没锁，最后发现是邻居救了她",
                "platform": "douyin",
                "duration": 30,
                "style": "悬疑",
            },
            "category": "pre",
            "priority": 90,
            "reason": "悬疑适合短视频完播率",
        },
        {
            "id": "drama-script",
            "title": "短剧剧本",
            "description": "先只生成剧本和角色卡，便于人工打磨",
            "recipe_id": "short_drama.script",
            "params": {
                "brief": "古代女主女扮男装考科举，被男主识破身份",
                "platform": "xiaohongshu",
                "duration": 90,
                "style": "古风",
            },
            "category": "pre",
            "priority": 85,
            "reason": "剧本先行，降低创作风险",
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
        "short_drama_agent",
        metadata={
            "recipe_id": recipe_id,
            "params": params,
            "steps": _default_steps(recipe_id),
            "trace_id": trace_id,
        },
    )
    task_manager.update_task(task_id, status="running", progress=10, message=f"启动：{recipe.name}")

    steps = (task_manager.get_task(task_id) or {}).get("metadata", {}).get("steps") or []
    first_step = recipe.steps[0].id if recipe.steps else ""
    for step in steps:
        if step.get("id") == first_step and step.get("status") == "pending":
            step["status"] = "running"
            step["updated_at"] = time.time()
            break
    task_manager.update_task(
        task_id, status="running", progress=25, message="解析创意与平台特性", metadata={"steps": steps}
    )

    try:
        result = run_analysis(recipe_id, params)
    except Exception as exc:
        logger.error("[short_drama_service] recipe %s failed: %s", recipe_id, exc, exc_info=True)
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
        message="短剧创作完成",
        metadata={"steps": steps, "recipe_id": recipe_id},
    )
    return {"success": True, "status": "completed", "task_id": task_id, "result": result}


def get_task(task_id: str) -> Optional[Dict[str, Any]]:
    return task_manager.get_task(task_id)
