"""Procurement Assistant workflow service."""

from __future__ import annotations

import time
from typing import Any, Dict, List, Optional

from core.procurement_analysis import gather_procurement_signals, run_analysis
from core.procurement_recipes import get_recipe, list_recipes
from utils.logger import setup_logger
from utils.task_manager import task_manager

logger = setup_logger("procurement_service")


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
        "agent_id": "procurement_agent",
        "recipe_count": len(recipes),
        "categories": categories,
        "focus_areas": [
            "供应商评估与尽职调查",
            "RFQ/RFP 需求起草",
            "报价对比与 TCO 分析",
            "采购合同条款审查",
            "成本优化与降本策略",
            "品类寻源策略规划",
        ],
    }


def get_suggestions() -> Dict[str, Any]:
    env = get_environment()
    suggestions: List[Dict[str, Any]] = [
        {
            "id": "rfq-it-hardware",
            "title": "IT 设备 RFQ 起草",
            "description": "生成笔记本/服务器等 IT 采购询价需求与评分标准",
            "recipe_id": "rfq.draft",
            "params": {
                "item": "企业 IT 办公设备（笔记本）",
                "quantity": "200 台",
                "deadline": "45 天内交付",
                "budget": "单价 5000-8000 元",
            },
            "category": "rfq",
            "priority": 95,
            "reason": "设备采购前先标准化 RFQ 可减少返工",
        },
        {
            "id": "vendor-eval",
            "title": "核心供应商评估",
            "description": "从交付、质量、财务与合规维度做尽职评估",
            "recipe_id": "vendor.evaluate",
            "params": {
                "vendor_name": "目标供应商名称",
                "category": "你的采购品类",
                "requirements": "交期稳定、ISO 认证、账期 60 天",
            },
            "category": "vendor",
            "priority": 90,
            "reason": "新供应商准入或年度复审时优先执行",
        },
        {
            "id": "quote-compare",
            "title": "三家报价对比",
            "description": "结构化对比报价差异并给出采购建议",
            "recipe_id": "quote.compare",
            "params": {
                "item": "办公耗材",
                "quotes": "A 公司: 单价 10 元, 交期 7 天, 账期 30 天\nB 公司: 单价 9.5 元, 交期 14 天, 账期 45 天",
                "criteria": "价格 40%、交期 30%、账期 30%",
            },
            "category": "quote",
            "priority": 85,
            "reason": "收到多家报价后快速做 TCO 对比",
        },
        {
            "id": "cost-optimize",
            "title": "品类降本分析",
            "description": "识别集采、规格标准化与谈判降本机会",
            "recipe_id": "cost.optimize",
            "params": {
                "category": "MRO 间接物料",
                "current_spend": "年 spend 约 500 万",
                "pain_points": "供应商分散、规格不统一、紧急采购溢价高",
            },
            "category": "cost",
            "priority": 80,
            "reason": "Spend Review 季度复盘时适用",
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
        "procurement_agent",
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
        message="收集中：采购与市场信号",
        metadata={"steps": steps},
    )

    try:
        result = run_analysis(recipe_id, params)
    except Exception as exc:
        logger.error("[procurement] recipe %s failed: %s", recipe_id, exc, exc_info=True)
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
    return gather_procurement_signals(topic)
