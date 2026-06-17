"""Business Partnership Assistant workflow service."""

from __future__ import annotations

import time
from typing import Any, Dict, List, Optional

from core.business_partnership_analysis import gather_partnership_signals, run_analysis
from core.business_partnership_recipes import get_recipe, list_recipes
from utils.logger import setup_logger
from utils.task_manager import task_manager

logger = setup_logger("business_partnership_service")


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
        "agent_id": "business_partnership_agent",
        "recipe_count": len(recipes),
        "categories": categories,
        "focus_areas": [
            "合作 outreach 与跟进话术",
            "结构化商务合作方案",
            "合作条款要点审查",
            "潜在伙伴评估与筛选",
            "BD Pipeline 规划与管理",
        ],
    }


def get_suggestions() -> Dict[str, Any]:
    env = get_environment()
    suggestions: List[Dict[str, Any]] = [
        {
            "id": "outreach-brand",
            "title": "品牌联名 Outreach",
            "description": "撰写面向目标品牌的合作首触达与跟进节奏",
            "recipe_id": "outreach.draft",
            "params": {
                "our_company": "你的品牌名",
                "target_partner": "目标品牌",
                "cooperation_type": "品牌联名",
                "value_prop": "用户群互补 + 联合营销",
            },
            "category": "outreach",
            "priority": 95,
            "reason": "冷启动合作时优先准备专业 outreach",
        },
        {
            "id": "proposal-channel",
            "title": "渠道合作方案",
            "description": "输出渠道分销/代理合作的完整方案框架",
            "recipe_id": "proposal.generate",
            "params": {
                "our_company": "你的公司",
                "partner_name": "目标渠道伙伴",
                "cooperation_goal": "拓展区域市场",
            },
            "category": "proposal",
            "priority": 90,
            "reason": "正式会议前需结构化方案",
        },
        {
            "id": "evaluate-supplier",
            "title": "供应商伙伴评估",
            "description": "从战略与风险维度评估候选供应商/伙伴",
            "recipe_id": "partner.evaluate",
            "params": {
                "partner_name": "候选伙伴名称",
                "industry": "你的行业",
                "cooperation_intent": "供应链/联合研发",
            },
            "category": "partner",
            "priority": 85,
            "reason": "签约前做伙伴尽职评估",
        },
        {
            "id": "pipeline-q2",
            "title": "Q2 BD Pipeline",
            "description": "规划季度合作漏斗、目标与关键动作",
            "recipe_id": "pipeline.plan",
            "params": {
                "business_goal": "拓展 3 家战略渠道伙伴",
                "target_segments": "SaaS 渠道商, MCN 机构",
                "timeline": "Q2",
            },
            "category": "pipeline",
            "priority": 80,
            "reason": "季度初统一 BD 节奏",
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
        "business_partnership_agent",
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
        if step.get("id") in {"collect", "parse"} and step.get("status") == "pending":
            step["status"] = "running"
            step["updated_at"] = time.time()
            break
    task_manager.update_task(
        task_id, status="running", progress=25, message="收集中：伙伴与市场信号", metadata={"steps": steps}
    )

    try:
        result = run_analysis(recipe_id, params)
    except Exception as exc:
        logger.error("[business_partnership] recipe %s failed: %s", recipe_id, exc, exc_info=True)
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
    return gather_partnership_signals(topic)
