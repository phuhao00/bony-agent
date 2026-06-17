"""AI Podcast Production workflow service."""

from __future__ import annotations

import time
from typing import Any, Dict, List, Optional

from core.podcast_analysis import run_analysis
from core.podcast_recipes import get_recipe, list_recipes
from utils.logger import setup_logger
from utils.task_manager import task_manager

logger = setup_logger("podcast_service")


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
        "agent_id": "podcast_agent",
        "recipe_count": len(recipes),
        "categories": categories,
        "focus_areas": [
            "播客定位与节目策划",
            "双人对话/独白/访谈脚本",
            "封面图设计与生图提示词",
            "多主播 TTS 配音方案",
            "Shownotes 与多平台发布文案",
        ],
    }


def get_suggestions() -> Dict[str, Any]:
    env = get_environment()
    suggestions: List[Dict[str, Any]] = [
        {
            "id": "podcast-plan",
            "title": "策划一期播客",
            "description": "从主题到结构，快速完成节目策划",
            "recipe_id": "podcast.plan",
            "params": {
                "topic": "AI 如何改变短视频创作",
                "format": "双人对话",
                "audience": "内容创作者",
                "tone": "轻松",
                "duration": 20,
            },
            "category": "plan",
            "priority": 95,
            "reason": "播客创作第一步",
        },
        {
            "id": "podcast-script",
            "title": "生成播客脚本",
            "description": "输入主题，生成带时间戳的完整对话脚本",
            "recipe_id": "podcast.script",
            "params": {
                "topic": "我用 AI 做了第一部短剧",
                "format": "双人对话",
                "hosts": "A（技术宅）, B（好奇小白）",
                "duration": 15,
                "tone": "轻松有梗",
            },
            "category": "write",
            "priority": 90,
            "reason": "脚本生成是核心场景",
        },
        {
            "id": "podcast-cover",
            "title": "设计播客封面",
            "description": "为播客生成封面视觉概念与 AI 生图提示词",
            "recipe_id": "podcast.cover",
            "params": {
                "title": "AI 创作者电台",
                "topic": "AI 内容创作",
                "style": "现代简约",
            },
            "category": "design",
            "priority": 85,
            "reason": "封面是播客的第一印象",
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
        "podcast_agent",
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
        task_id, status="running", progress=25, message="分析主题与节目形式", metadata={"steps": steps}
    )

    try:
        result = run_analysis(recipe_id, params)
    except Exception as exc:
        logger.error("[podcast_service] recipe %s failed: %s", recipe_id, exc, exc_info=True)
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
        message="播客创作完成",
        metadata={"steps": steps, "recipe_id": recipe_id},
    )
    return {"success": True, "status": "completed", "task_id": task_id, "result": result}


def get_task(task_id: str) -> Optional[Dict[str, Any]]:
    return task_manager.get_task(task_id)
