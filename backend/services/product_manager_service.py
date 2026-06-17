"""Product Manager Agent workflow service."""

from __future__ import annotations

import time
from typing import Any, Dict, List, Optional

from core.product_analysis import gather_market_signals, run_analysis
from core.pm_skill_loader import PM_SKILL_IDS
from core.product_manager_recipes import get_recipe, list_recipes
from utils.logger import setup_logger
from utils.task_manager import task_manager

logger = setup_logger("product_manager_service")


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
        "agent_id": "product_manager_agent",
        "recipe_count": len(recipes),
        "categories": categories,
        "skill_count": len(PM_SKILL_IDS),
        "skill_ids": list(PM_SKILL_IDS),
        "focus_areas": [
            "市场洞察与趋势研判",
            "产品创意与 MVP 方向",
            "现有产品诊断与迭代",
            "竞品格局与差异化策略",
            "Discovery / JTBD / 战略 / 路线图 / 用户故事 / 优先级",
            "运营增长闭环建议",
        ],
    }


def get_suggestions() -> Dict[str, Any]:
    env = get_environment()
    suggestions: List[Dict[str, Any]] = [
        {
            "id": "market-ai-tools",
            "title": "AI 工具赛道市场洞察",
            "description": "扫描 AI 生产力工具的市场趋势与机会窗口",
            "recipe_id": "market.research",
            "params": {"topic": "AI 生产力工具", "audience": "知识工作者与创作者", "region": "中国"},
            "category": "market",
            "priority": 95,
            "reason": "AI 工具赛道变化快，适合先做市场扫描",
        },
        {
            "id": "idea-saas",
            "title": "B2B SaaS 产品创意",
            "description": "基于中小企业数字化痛点发散可落地创意",
            "recipe_id": "idea.generate",
            "params": {"market": "中小企业数字化办公", "constraints": "6 个月内可 MVP", "count": 5},
            "category": "idea",
            "priority": 90,
            "reason": "从市场空白出发快速 brainstorm",
        },
        {
            "id": "optimize-retention",
            "title": "留存优化迭代方案",
            "description": "为现有产品设计适应市场变化的迭代路线",
            "recipe_id": "product.optimize",
            "params": {
                "product_name": "你的产品名称",
                "goals": "提升 7 日留存与核心功能渗透率",
            },
            "category": "product",
            "priority": 85,
            "reason": "已有产品时优先做迭代规划",
        },
        {
            "id": "competitor-scan",
            "title": "竞品格局扫描",
            "description": "识别主要竞品、差异化空白与策略位",
            "recipe_id": "competitor.scan",
            "params": {"category": "你的品类/赛道"},
            "category": "competitor",
            "priority": 80,
            "reason": "进入新赛道或改版前建议先做竞品扫描",
        },
        {
            "id": "pm-discovery",
            "title": "Discovery 假设验证",
            "description": "从问题假设到实验设计的完整 Discovery 循环",
            "recipe_id": "pm.discovery",
            "params": {"problem": "用户留存下降的原因假设", "context": "B2B SaaS 产品"},
            "category": "discovery",
            "priority": 88,
            "reason": "PM 方法论：先验证问题再投入开发",
        },
        {
            "id": "pm-roadmap",
            "title": "Now/Next/Later 路线图",
            "description": "将业务目标转化为可沟通的战略路线图",
            "recipe_id": "pm.roadmap",
            "params": {"goals": "提升留存与 ARR", "horizon": "Q1-Q2"},
            "category": "delivery",
            "priority": 86,
            "reason": "季度规划与 stakeholder 对齐",
        },
        {
            "id": "pm-user-story",
            "title": "用户故事 + 验收标准",
            "description": "Mike Cohn + Gherkin 格式，开发就绪 backlog",
            "recipe_id": "pm.user_story",
            "params": {"feature": "用户可导出 PDF 报告", "persona": "运营经理"},
            "category": "delivery",
            "priority": 84,
            "reason": "需求评审前快速产出标准用户故事",
        },
        {
            "id": "pm-prioritize",
            "title": "Initiative 优先级排序",
            "description": "RICE/ICE 框架下的取舍与排序建议",
            "recipe_id": "pm.prioritize",
            "params": {
                "initiatives": "移动端 App、企业 SSO、AI 助手、报表导出",
                "constraints": "2 个工程师，1 个季度",
            },
            "category": "strategy",
            "priority": 82,
            "reason": "资源有限时的 PM 决策辅助",
        },
        {
            "id": "pm-strategy",
            "title": "产品战略工作坊",
            "description": "愿景、差异化与战略 bet 的结构化输出",
            "recipe_id": "pm.strategy",
            "params": {"vision": "成为 AI 原生协作平台", "market": "中小企业数字化"},
            "category": "strategy",
            "priority": 78,
            "reason": "年度/季度战略对齐",
        },
    ]
    suggestions.sort(key=lambda s: -s.get("priority", 0))
    return {"environment": env, "suggestions": suggestions}


def _enrich_steps_from_execution(
    steps: List[Dict[str, Any]],
    execution: Optional[Dict[str, Any]],
) -> None:
    """Attach per-step summaries from execution logs."""
    if not execution:
        return
    logs = execution.get("logs") or []
    search_queries = execution.get("search_queries") or []
    skill_id = execution.get("skill_id")
    for step in steps:
        kind = step.get("kind") or ""
        step_id = step.get("id") or ""
        if step_id == "collect" or kind in {"research"}:
            step["result"] = {
                "search_queries": search_queries,
                "query_count": len(search_queries),
            }
        elif kind in {"skill", "synthesize", "generate", "analyze"} or step_id in {
            "synthesize",
            "analyze",
            "ideate",
            "diagnose",
            "optimize",
        }:
            llm_logs = [l for l in logs if l.get("phase") == "llm"]
            step["result"] = {
                "skill_id": skill_id,
                "model": execution.get("model"),
                "provider": execution.get("provider"),
                "temperature": execution.get("temperature"),
                "llm_calls": len([l for l in llm_logs if "调用 LLM" in str(l.get("message") or "")]),
            }
        if skill_id and kind == "skill":
            step["result"] = {
                **(step.get("result") or {}),
                "skill_id": skill_id,
                "has_template": execution.get("has_template"),
                "has_example": execution.get("has_example"),
            }


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
        "product_manager_agent",
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
    task_manager.update_task(task_id, status="running", progress=25, message="收集中：市场信号", metadata={"steps": steps})

    try:
        result = run_analysis(recipe_id, params)
    except Exception as exc:
        logger.error("[product_manager] recipe %s failed: %s", recipe_id, exc, exc_info=True)
        task_manager.update_task(
            task_id,
            status="failed",
            progress=100,
            message=str(exc),
            result={"error": str(exc)},
        )
        return {"success": False, "status": "failed", "task_id": task_id, "error": str(exc)}

    now = time.time()
    execution = result.get("execution") if isinstance(result, dict) else None
    _enrich_steps_from_execution(steps, execution if isinstance(execution, dict) else None)
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
        metadata={
            "steps": steps,
            "recipe_id": recipe_id,
            "execution": execution,
        },
    )
    return {"success": True, "status": "completed", "task_id": task_id, "result": result}


def get_task(task_id: str) -> Optional[Dict[str, Any]]:
    return task_manager.get_task(task_id)


def preview_signals(topic: str) -> Dict[str, Any]:
    topic = (topic or "").strip()
    if not topic:
        raise ValueError("topic is required")
    return gather_market_signals(topic)
