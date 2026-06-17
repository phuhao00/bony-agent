"""Ad Campaign Assistant workflow service."""

from __future__ import annotations

import time
from typing import Any, Dict, List, Optional

from core.ad_campaign_analysis import gather_ad_signals, run_analysis
from core.ad_campaign_recipes import get_recipe, list_recipes
from utils.logger import setup_logger
from utils.task_manager import task_manager

logger = setup_logger("ad_campaign_service")


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
        "agent_id": "ad_campaign_agent",
        "recipe_count": len(recipes),
        "categories": categories,
        "focus_areas": [
            "全渠道投放策略与 KPI 框架",
            "高转化广告创意与 A/B 测试",
            "受众定向与人群细分",
            "预算分配与放量节奏",
            "投放效果复盘与优化",
        ],
    }


def get_suggestions() -> Dict[str, Any]:
    env = get_environment()
    suggestions: List[Dict[str, Any]] = [
        {
            "id": "strategy-saas",
            "title": "SaaS 产品获客投放策略",
            "description": "规划抖音+搜索+私域的组合投放与 KPI",
            "recipe_id": "strategy.plan",
            "params": {
                "product": "B2B SaaS 协作工具",
                "goal": "注册获客",
                "budget": "月预算 5-10 万",
                "platforms": "抖音, 小红书, 搜索广告",
            },
            "category": "strategy",
            "priority": 95,
            "reason": "新品上线前先做渠道策略框架",
        },
        {
            "id": "creative-ecom",
            "title": "电商大促创意文案",
            "description": "生成多组标题/正文/CTA 供 A/B 测试",
            "recipe_id": "creative.copy",
            "params": {
                "product": "美妆护肤礼盒",
                "audience": "25-35 岁女性",
                "platform": "抖音/小红书",
                "count": 5,
            },
            "category": "creative",
            "priority": 90,
            "reason": "大促前快速产出创意变体",
        },
        {
            "id": "audience-edu",
            "title": "在线教育受众定向",
            "description": "拆解 K12/职业培训人群画像与定向标签",
            "recipe_id": "audience.analyze",
            "params": {"product": "在线编程课程", "platform": "抖音, 微信"},
            "category": "audience",
            "priority": 85,
            "reason": "精准定向可降低 CPA",
        },
        {
            "id": "budget-q2",
            "title": "季度预算分配",
            "description": "按渠道与阶段切分预算并设定放量节奏",
            "recipe_id": "budget.allocate",
            "params": {
                "total_budget": "季度 30 万",
                "goal": "线索获客",
                "platforms": "抖音, 百度, 小红书",
                "duration": "3 个月",
            },
            "category": "budget",
            "priority": 80,
            "reason": "季度规划时统一预算切分逻辑",
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
        "ad_campaign_agent",
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
        task_id, status="running", progress=25, message="收集中：投放与市场信号", metadata={"steps": steps}
    )

    try:
        result = run_analysis(recipe_id, params)
    except Exception as exc:
        logger.error("[ad_campaign] recipe %s failed: %s", recipe_id, exc, exc_info=True)
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
        message="分析完成",
        metadata={"steps": steps, "recipe_id": recipe_id},
    )
    return {"success": True, "status": "completed", "task_id": task_id, "result": result}


def get_task(task_id: str) -> Optional[Dict[str, Any]]:
    return task_manager.get_task(task_id)


def preview_signals(topic: str) -> Dict[str, Any]:
    topic = (topic or "").strip()
    if not topic:
        raise ValueError("topic is required")
    return gather_ad_signals(topic)
