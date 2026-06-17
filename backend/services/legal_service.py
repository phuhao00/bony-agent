"""Legal Advisor Agent workflow service."""

from __future__ import annotations

import time
from typing import Any, Dict, List, Optional

from core.legal_analysis import gather_legal_signals, run_analysis
from core.legal_recipes import get_recipe, list_recipes
from utils.logger import setup_logger
from utils.task_manager import task_manager

logger = setup_logger("legal_service")


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
        "agent_id": "legal_agent",
        "recipe_count": len(recipes),
        "categories": categories,
        "focus_areas": [
            "案例检索与权威法律解读",
            "公司合规体检与风险治理",
            "法规政策实务解读",
            "合同条款风险审查",
            "经济金融财务法律要点",
        ],
    }


def get_suggestions() -> Dict[str, Any]:
    env = get_environment()
    suggestions: List[Dict[str, Any]] = [
        {
            "id": "case-labor-dispute",
            "title": "劳动争议案例解读",
            "description": "检索典型劳动争议案例，提炼裁判规则与用工合规要点",
            "recipe_id": "case.research",
            "params": {"topic": "劳动合同解除与经济补偿", "context": "科技公司用工"},
            "category": "case",
            "priority": 95,
            "reason": "劳动纠纷是企业高频合规风险",
        },
        {
            "id": "compliance-startup",
            "title": "初创公司合规体检",
            "description": "从工商、治理、劳动、财税、数据等维度评估合规缺口",
            "recipe_id": "compliance.audit",
            "params": {
                "company_profile": "互联网 SaaS 初创公司，50 人规模",
                "stage": "成长期",
            },
            "category": "compliance",
            "priority": 92,
            "reason": "融资或扩张前建议先做合规体检",
        },
        {
            "id": "regulation-data",
            "title": "数据合规法规解读",
            "description": "解读个人信息保护与数据出境相关规范对企业的影响",
            "recipe_id": "regulation.interpret",
            "params": {
                "regulation": "个人信息保护法",
                "business_scenario": "用户数据采集与跨境传输",
            },
            "category": "regulation",
            "priority": 90,
            "reason": "数据合规是近年监管重点",
        },
        {
            "id": "contract-investment",
            "title": "投融资协议风险审查",
            "description": "识别投资协议中对赌、回购、治理权等高风险条款",
            "recipe_id": "contract.risk",
            "params": {
                "contract_type": "股权投资协议",
                "party_role": "融资方（创业公司）",
            },
            "category": "contract",
            "priority": 88,
            "reason": "投融资条款直接影响股东权益",
        },
        {
            "id": "finance-tax",
            "title": "股权转让税务合规",
            "description": "梳理股权转让涉及的个税、企业所得税与申报义务",
            "recipe_id": "finance.legal",
            "params": {
                "topic": "股权转让税务合规",
                "entity": "有限责任公司股东（自然人）",
            },
            "category": "finance",
            "priority": 85,
            "reason": "股权交易常伴随税务与合规双重风险",
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
        "legal_agent",
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
    task_manager.update_task(task_id, status="running", progress=25, message="检索中：案例与法规信号", metadata={"steps": steps})

    try:
        result = run_analysis(recipe_id, params)
    except Exception as exc:
        logger.error("[legal_service] recipe %s failed: %s", recipe_id, exc, exc_info=True)
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
        message="法律分析完成",
        metadata={"steps": steps, "recipe_id": recipe_id},
    )
    return {"success": True, "status": "completed", "task_id": task_id, "result": result}


def get_task(task_id: str) -> Optional[Dict[str, Any]]:
    return task_manager.get_task(task_id)


def preview_signals(topic: str) -> Dict[str, Any]:
    topic = (topic or "").strip()
    if not topic:
        raise ValueError("topic is required")
    return gather_legal_signals(topic)
