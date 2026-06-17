"""Music Production workflow service."""

from __future__ import annotations

import time
from typing import Any, Dict, List, Optional

from core.music_analysis import run_analysis
from core.music_recipes import get_recipe, list_recipes
from utils.logger import setup_logger
from utils.task_manager import task_manager

logger = setup_logger("music_service")


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
        "agent_id": "music_agent",
        "recipe_count": len(recipes),
        "categories": categories,
        "providers": ["mock", "minimax", "suno"],
        "focus_areas": [
            "文本生成音乐",
            "歌词生成音乐",
            "参考风格迁移",
            "短视频/短剧 BGM",
            "音乐结构标签控制",
        ],
    }


def get_suggestions() -> Dict[str, Any]:
    env = get_environment()
    suggestions: List[Dict[str, Any]] = [
        {
            "id": "music-vlog",
            "title": "Vlog 轻快 BGM",
            "description": "为日常 Vlog 生成一段 30 秒轻快可循环背景音乐",
            "recipe_id": "music.bgm_for_video",
            "params": {"prompt": "轻快明亮的日常 Vlog 背景音乐，吉他与人声哼唱", "duration": 30, "loop": True},
            "category": "video",
            "priority": 95,
            "reason": "短视频最常见需求",
        },
        {
            "id": "music-pop-lyrics",
            "title": "流行歌曲创作",
            "description": "输入歌词，生成一段 60 秒流行抒情曲",
            "recipe_id": "music.lyrics_to_music",
            "params": {
                "lyrics": "星空下的约定，\n时间静止在这一刻，\n你的笑容是我最美的风景。",
                "style": "流行",
                "mood": "抒情",
                "duration": 60,
            },
            "category": "compose",
            "priority": 90,
            "reason": "歌词到音乐是音乐 AI 的核心场景",
        },
        {
            "id": "music-short-drama",
            "title": "短剧氛围音乐",
            "description": "为悬疑短剧生成紧张氛围配乐",
            "recipe_id": "music.text_to_music",
            "params": {"prompt": "悬疑短剧紧张氛围，低频弦乐与电子音效", "style": "电子", "mood": "紧张", "duration": 45},
            "category": "compose",
            "priority": 85,
            "reason": "与短剧功能形成联动",
        },
        {
            "id": "music-instrumental",
            "title": "治愈纯音乐",
            "description": "生成一段 60 秒治愈钢琴纯音乐",
            "recipe_id": "music.text_to_music",
            "params": {"prompt": "治愈系钢琴纯音乐，适合阅读与冥想", "style": "古典", "mood": "治愈", "duration": 60, "instrumental": True},
            "category": "compose",
            "priority": 80,
            "reason": "纯音乐需求高频",
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
        "music_agent",
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
        if step.get("id") == "parse" and step.get("status") == "pending":
            step["status"] = "running"
            step["updated_at"] = time.time()
            break
    task_manager.update_task(
        task_id, status="running", progress=25, message="解析音乐需求与风格参数", metadata={"steps": steps}
    )

    try:
        result = run_analysis(recipe_id, params)
    except Exception as exc:
        logger.error("[music_service] recipe %s failed: %s", recipe_id, exc, exc_info=True)
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
        message="音乐生成完成",
        metadata={"steps": steps, "recipe_id": recipe_id},
    )
    return {"success": True, "status": "completed", "task_id": task_id, "result": result}


def get_task(task_id: str) -> Optional[Dict[str, Any]]:
    return task_manager.get_task(task_id)
