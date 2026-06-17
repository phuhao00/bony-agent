"""Market and product analysis helpers for Product Manager Agent."""

from __future__ import annotations

import time
from typing import Any, Callable, Dict, List, Optional

from langchain_core.messages import HumanMessage, SystemMessage

from core.llm_provider import get_chat_llm, get_current_model, get_llm_kwargs, get_provider_id
from core.pm_skill_loader import load_pm_skill_bundle
from tools.web_search_tools import execute_web_search_sync
from utils.logger import setup_logger

logger = setup_logger("product_analysis")

_PM_SYSTEM = """你是资深产品经理与增长运营专家，擅长：
- 市场洞察：从噪声中提炼趋势、机会窗口与风险
- 产品诊断：定位、价值主张、增长漏斗、留存与商业化
- 创意发散：可落地的 MVP 方向，而非空泛概念
- 运营策略：获客、激活、留存、变现的闭环建议

输出要求：
1. 使用清晰 Markdown（## 章节、列表、表格）
2. 观点要有依据，引用你看到的信号（搜索/热点）
3. 给出优先级（P0/P1/P2）与可执行下一步
4. 不编造具体融资额、用户数等无法验证的硬数据；不确定时标注「待验证」
5. 回答使用中文"""


def _llm_runtime_snapshot(temperature: float) -> Dict[str, Any]:
    pid = get_provider_id()
    kwargs = get_llm_kwargs(temperature=temperature)
    return {
        "provider": pid,
        "model": kwargs.get("model") or get_current_model(),
        "temperature": temperature,
    }


def _execution_log(
    logs: List[Dict[str, Any]],
    phase: str,
    message: str,
    *,
    level: str = "info",
    detail: Optional[Dict[str, Any]] = None,
) -> None:
    logs.append(
        {
            "phase": phase,
            "level": level,
            "message": message,
            "detail": detail or {},
            "ts": time.time(),
        }
    )


def _build_execution(
    logs: List[Dict[str, Any]],
    *,
    recipe_id: str,
    started_at: float,
    temperature: float,
    skill_id: Optional[str] = None,
    skill_bundle: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    llm = _llm_runtime_snapshot(temperature)
    search_queries = [
        str(entry.get("detail", {}).get("query") or "")
        for entry in logs
        if entry.get("phase") == "search" and entry.get("detail", {}).get("query")
    ]
    return {
        "recipe_id": recipe_id,
        "skill_id": skill_id,
        "skill_loaded": bool(skill_id and skill_bundle),
        "has_template": bool(skill_bundle and skill_bundle.get("has_template")),
        "has_example": bool(skill_bundle and skill_bundle.get("has_example")),
        "model": llm["model"],
        "provider": llm["provider"],
        "temperature": temperature,
        "duration_ms": max(0, int((time.time() - started_at) * 1000)),
        "search_queries": search_queries,
        "logs": logs,
    }


def _run_recipe_with_execution(
    recipe_id: str,
    params: Dict[str, Any],
    *,
    temperature: float,
    skill_id: Optional[str] = None,
    skill_bundle: Optional[Dict[str, Any]] = None,
    collect: Callable[[List[Dict[str, Any]]], Dict[str, Any]],
    synthesize: Callable[[Dict[str, Any], List[Dict[str, Any]]], str],
    payload: Dict[str, Any],
) -> Dict[str, Any]:
    """Shared wrapper: collect signals → LLM synthesize → attach execution metadata."""
    started_at = time.time()
    logs: List[Dict[str, Any]] = []
    if skill_id:
        _execution_log(
            logs,
            "skill",
            f"已加载 PM Skill：{skill_id}",
            detail={
                "skill_id": skill_id,
                "has_template": bool(skill_bundle and skill_bundle.get("has_template")),
                "has_example": bool(skill_bundle and skill_bundle.get("has_example")),
                "skill_body_chars": len((skill_bundle or {}).get("skill_body") or ""),
            },
        )
    else:
        _execution_log(
            logs,
            "recipe",
            f"运行内置工作流：{recipe_id}（未绑定 PM Skill）",
            detail={"recipe_id": recipe_id},
        )

    signals = collect(logs)
    report = synthesize(signals, logs)
    payload = {
        **payload,
        "recipe": recipe_id,
        "params": params,
        "signals": signals,
        "report": report,
    }
    if skill_id:
        payload["skill_id"] = skill_id
    payload["execution"] = _build_execution(
        logs,
        recipe_id=recipe_id,
        started_at=started_at,
        temperature=temperature,
        skill_id=skill_id,
        skill_bundle=skill_bundle,
    )
    return payload


def _safe_hot_topics() -> str:
    try:
        from tools.social_trending import get_hot_topics

        return str(get_hot_topics.invoke({}) or "")[:4000]
    except Exception as exc:
        logger.warning("[product_analysis] hot topics unavailable: %s", exc)
        return ""


def gather_market_signals(
    topic: str,
    *,
    extra_queries: Optional[List[str]] = None,
    max_results: int = 8,
    logs: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """Collect web search snippets and social hot topics for a topic."""
    topic = (topic or "").strip()
    if not topic:
        return {"topic": "", "searches": [], "hot_topics": ""}

    queries = [f"{topic} 市场 趋势 2025 2026", f"{topic} 用户痛点 需求", f"{topic} 竞品 对比"]
    if extra_queries:
        queries.extend(q.strip() for q in extra_queries if q and q.strip())

    if logs is not None:
        _execution_log(
            logs,
            "collect",
            f"开始收集市场信号：{topic}",
            detail={"topic": topic, "planned_queries": len(queries)},
        )

    seen: set[str] = set()
    searches: List[Dict[str, str]] = []
    for q in queries:
        if q in seen:
            continue
        seen.add(q)
        try:
            text = execute_web_search_sync(q, max_results=max_results)
        except Exception as exc:
            logger.warning("[product_analysis] search failed for %s: %s", q, exc)
            text = f"搜索失败: {exc}"
            if logs is not None:
                _execution_log(
                    logs,
                    "search",
                    f"搜索失败：{q}",
                    level="warn",
                    detail={"query": q, "error": str(exc)},
                )
        else:
            if logs is not None:
                _execution_log(
                    logs,
                    "search",
                    f"联网搜索：{q}",
                    detail={"query": q, "result_chars": len(text or "")},
                )
        searches.append({"query": q, "result": (text or "")[:6000]})

    hot_topics = _safe_hot_topics()
    if logs is not None:
        _execution_log(
            logs,
            "collect",
            "社媒热点快照已获取" if hot_topics.strip() else "社媒热点不可用，已跳过",
            detail={"hot_topics_chars": len(hot_topics or "")},
        )

    return {
        "topic": topic,
        "searches": searches,
        "hot_topics": hot_topics,
    }


def _format_signals(signals: Dict[str, Any]) -> str:
    parts = [f"主题：{signals.get('topic', '')}"]
    for row in signals.get("searches") or []:
        parts.append(f"\n### 搜索：{row.get('query', '')}\n{row.get('result', '')}")
    hot = (signals.get("hot_topics") or "").strip()
    if hot:
        parts.append(f"\n### 社媒热点快照\n{hot}")
    return "\n".join(parts)


def _run_llm(
    human: str,
    *,
    temperature: float = 0.35,
    system: Optional[str] = None,
    logs: Optional[List[Dict[str, Any]]] = None,
) -> str:
    meta = _llm_runtime_snapshot(temperature)
    if logs is not None:
        _execution_log(
            logs,
            "llm",
            f"调用 LLM 生成报告：{meta['provider']} / {meta['model']}",
            detail=meta,
        )
    llm = get_chat_llm(temperature=temperature)
    result = llm.invoke(
        [SystemMessage(content=system or _PM_SYSTEM), HumanMessage(content=human)]
    )
    content = str(result.content or "").strip()
    if logs is not None:
        _execution_log(
            logs,
            "llm",
            "LLM 报告生成完成",
            detail={"report_chars": len(content), **meta},
        )
    return content


def _format_params(params: Dict[str, Any]) -> str:
    lines = []
    for key, value in params.items():
        if value is None or value == "":
            continue
        lines.append(f"- **{key}**: {value}")
    return "\n".join(lines) if lines else "（无额外参数）"


def _run_skill_recipe(
    recipe_id: str,
    skill_id: str,
    params: Dict[str, Any],
    *,
    topic_for_signals: Optional[str] = None,
    extra_instructions: str = "",
    temperature: float = 0.35,
) -> Dict[str, Any]:
    bundle = load_pm_skill_bundle(skill_id)

    system = (
        f"{_PM_SYSTEM}\n\n"
        "## 方法论 Skill（必须严格遵循）\n\n"
        f"{bundle['skill_body']}"
    )

    parts = [
        f"请使用 **{skill_id}** 方法论，为以下输入生成完整、可交付的 PM 产出。",
        f"\n## 用户输入\n{_format_params(params)}",
    ]
    if extra_instructions:
        parts.append(f"\n## 额外要求\n{extra_instructions}")
    if bundle.get("template"):
        parts.append(
            "\n## 输出模板（必须按此结构输出 Markdown）\n"
            f"{bundle['template']}"
        )
    if bundle.get("example"):
        parts.append(
            "\n## 格式参考示例（仅作结构与粒度参考，勿照抄内容）\n"
            f"{bundle['example'][:8000]}"
        )
    human_prompt = "\n".join(parts)
    human_prompt += "\n请使用中文输出，章节清晰，可直接用于团队评审。"

    def collect(logs: List[Dict[str, Any]]) -> Dict[str, Any]:
        if not topic_for_signals:
            if logs:
                _execution_log(logs, "collect", "本工作流未配置联网采集，跳过市场信号")
            return {}
        return gather_market_signals(topic_for_signals, logs=logs)

    def synthesize(signals: Dict[str, Any], logs: List[Dict[str, Any]]) -> str:
        prompt_parts = [human_prompt]
        if signals:
            prompt_parts.append(f"\n## 参考市场信号\n{_format_signals(signals)}")
        return _run_llm("\n".join(prompt_parts), system=system, temperature=temperature, logs=logs)

    return _run_recipe_with_execution(
        recipe_id,
        params,
        temperature=temperature,
        skill_id=skill_id,
        skill_bundle=bundle,
        collect=collect,
        synthesize=synthesize,
        payload={},
    )


def run_market_research(params: Dict[str, Any]) -> Dict[str, Any]:
    topic = str(params.get("topic") or "").strip()
    if not topic:
        raise ValueError("topic is required")
    audience = str(params.get("audience") or "").strip()
    region = str(params.get("region") or "中国").strip()
    temperature = 0.35

    def collect(logs: List[Dict[str, Any]]) -> Dict[str, Any]:
        return gather_market_signals(
            topic,
            extra_queries=[f"{topic} {region} 市场规模", f"{topic} 机会 挑战"],
            logs=logs,
        )

    def synthesize(signals: Dict[str, Any], logs: List[Dict[str, Any]]) -> str:
        prompt = (
            f"请撰写「{topic}」市场洞察报告。\n"
            f"目标用户：{audience or '待定义'}\n"
            f"关注区域：{region}\n\n"
            "报告结构：\n"
            "## 执行摘要\n"
            "## 市场概况与规模判断\n"
            "## 关键趋势（至少 3 条）\n"
            "## 用户痛点与未满足需求\n"
            "## 机会窗口与切入策略\n"
            "## 风险与不确定性\n"
            "## 建议的下一步验证动作（P0/P1）\n\n"
            f"参考信号：\n{_format_signals(signals)}"
        )
        return _run_llm(prompt, temperature=temperature, logs=logs)

    return _run_recipe_with_execution(
        "market.research",
        params,
        temperature=temperature,
        collect=collect,
        synthesize=synthesize,
        payload={"topic": topic},
    )


def run_idea_generation(params: Dict[str, Any]) -> Dict[str, Any]:
    market = str(params.get("market") or "").strip()
    if not market:
        raise ValueError("market is required")
    constraints = str(params.get("constraints") or "").strip()
    count = max(3, min(10, int(params.get("count") or 5)))
    temperature = 0.5

    def collect(logs: List[Dict[str, Any]]) -> Dict[str, Any]:
        return gather_market_signals(
            market,
            extra_queries=[f"{market} 新产品 创意", f"{market} MVP"],
            logs=logs,
        )

    def synthesize(signals: Dict[str, Any], logs: List[Dict[str, Any]]) -> str:
        prompt = (
            f"请为「{market}」生成 {count} 个可落地的产品创意。\n"
            f"约束条件：{constraints or '无特殊约束'}\n\n"
            "每个创意包含：\n"
            "- 一句话定位\n"
            "- 目标用户与核心痛点\n"
            "- 差异化亮点\n"
            "- MVP 范围（2-4 周可验证）\n"
            "- 获客/运营切入点\n"
            "- 风险与验证指标\n"
            "- 优先级 P0/P1/P2\n\n"
            "最后给出「最值得先做的 1 个」及原因。\n\n"
            f"参考信号：\n{_format_signals(signals)}"
        )
        return _run_llm(prompt, temperature=temperature, logs=logs)

    return _run_recipe_with_execution(
        "idea.generate",
        params,
        temperature=temperature,
        collect=collect,
        synthesize=synthesize,
        payload={"market": market},
    )


def run_product_analyze(params: Dict[str, Any]) -> Dict[str, Any]:
    name = str(params.get("product_name") or "").strip()
    if not name:
        raise ValueError("product_name is required")
    description = str(params.get("description") or "").strip()
    target_users = str(params.get("target_users") or "").strip()
    temperature = 0.35

    def collect(logs: List[Dict[str, Any]]) -> Dict[str, Any]:
        return gather_market_signals(
            name,
            extra_queries=[f"{name} 产品 评价", f"{name} 用户 反馈"],
            logs=logs,
        )

    def synthesize(signals: Dict[str, Any], logs: List[Dict[str, Any]]) -> str:
        prompt = (
            f"请对现有产品「{name}」做全面诊断。\n"
            f"产品描述：{description or '（用户未提供，请结合公开信息推断并标注）'}\n"
            f"目标用户：{target_users or '待明确'}\n\n"
            "报告结构：\n"
            "## 产品定位与价值主张\n"
            "## 目标用户与使用场景\n"
            "## 优势与护城河\n"
            "## 短板与体验断点\n"
            "## 增长与留存洞察\n"
            "## 商业化与定价观察\n"
            "## 运营可改进点（按 P0/P1/P2）\n"
            "## 30 天行动建议\n\n"
            f"参考信号：\n{_format_signals(signals)}"
        )
        return _run_llm(prompt, temperature=temperature, logs=logs)

    return _run_recipe_with_execution(
        "product.analyze",
        params,
        temperature=temperature,
        collect=collect,
        synthesize=synthesize,
        payload={"product_name": name},
    )


def run_product_optimize(params: Dict[str, Any]) -> Dict[str, Any]:
    name = str(params.get("product_name") or "").strip()
    if not name:
        raise ValueError("product_name is required")
    description = str(params.get("description") or "").strip()
    pain_points = str(params.get("pain_points") or "").strip()
    goals = str(params.get("goals") or "").strip()
    temperature = 0.35

    def collect(logs: List[Dict[str, Any]]) -> Dict[str, Any]:
        return gather_market_signals(
            name,
            extra_queries=[f"{name} 迭代 功能", f"{name} 行业 变化"],
            logs=logs,
        )

    def synthesize(signals: Dict[str, Any], logs: List[Dict[str, Any]]) -> str:
        prompt = (
            f"请为产品「{name}」制定适应市场变化的迭代与运营优化方案。\n"
            f"当前形态：{description or '（待补充）'}\n"
            f"已知痛点/反馈：{pain_points or '（待补充）'}\n"
            f"业务目标：{goals or '提升留存与增长'}\n\n"
            "报告结构：\n"
            "## 市场变化对产品的影响\n"
            "## 用户旅程中的关键断点\n"
            "## 功能迭代路线图（Now / Next / Later）\n"
            "## 运营策略（获客/激活/留存/变现）\n"
            "## 实验清单（含假设与成功指标）\n"
            "## 资源与节奏建议\n"
            "## 本周可启动的 3 件事\n\n"
            f"参考信号：\n{_format_signals(signals)}"
        )
        return _run_llm(prompt, temperature=temperature, logs=logs)

    return _run_recipe_with_execution(
        "product.optimize",
        params,
        temperature=temperature,
        collect=collect,
        synthesize=synthesize,
        payload={"product_name": name},
    )


def run_competitor_scan(params: Dict[str, Any]) -> Dict[str, Any]:
    category = str(params.get("category") or "").strip()
    if not category:
        raise ValueError("category is required")
    competitors = str(params.get("competitors") or "").strip()
    our_product = str(params.get("our_product") or "").strip()
    temperature = 0.35

    extra = [f"{category} 竞品 分析", f"{category} 头部产品 对比"]
    if competitors:
        for c in competitors.split(","):
            c = c.strip()
            if c:
                extra.append(f"{c} 产品 功能 定价")

    def collect(logs: List[Dict[str, Any]]) -> Dict[str, Any]:
        return gather_market_signals(category, extra_queries=extra, logs=logs)

    def synthesize(signals: Dict[str, Any], logs: List[Dict[str, Any]]) -> str:
        prompt = (
            f"请扫描「{category}」赛道的竞品格局。\n"
            f"已知竞品：{competitors or '（请结合搜索自行识别主要玩家）'}\n"
            f"我方产品：{our_product or '（未指定，做中立分析）'}\n\n"
            "报告结构：\n"
            "## 赛道概览\n"
            "## 竞品矩阵（表格：产品/定位/核心功能/定价/优势/劣势）\n"
            "## 差异化空白区\n"
            "## 可进攻位与需防守位\n"
            "## 对我方的策略建议\n"
            "## 持续监控指标与信息源\n\n"
            f"参考信号：\n{_format_signals(signals)}"
        )
        return _run_llm(prompt, temperature=temperature, logs=logs)

    return _run_recipe_with_execution(
        "competitor.scan",
        params,
        temperature=temperature,
        collect=collect,
        synthesize=synthesize,
        payload={"category": category},
    )


def run_pm_discovery(params: Dict[str, Any]) -> Dict[str, Any]:
    problem = str(params.get("problem") or "").strip()
    if not problem:
        raise ValueError("problem is required")
    context = str(params.get("context") or "").strip()
    return _run_skill_recipe(
        "pm.discovery",
        "discovery-process",
        {"problem": problem, "context": context or "（未提供）"},
        topic_for_signals=problem,
        extra_instructions="覆盖：问题框架、访谈计划、洞察合成、实验设计与决策建议。",
    )


def run_pm_jtbd(params: Dict[str, Any]) -> Dict[str, Any]:
    product = str(params.get("product") or "").strip()
    if not product:
        raise ValueError("product is required")
    segment = str(params.get("segment") or "").strip()
    return _run_skill_recipe(
        "pm.jtbd",
        "jobs-to-be-done",
        {"product": product, "segment": segment or "（待定义）"},
        topic_for_signals=f"{product} 用户 Jobs to be Done",
    )


def run_pm_strategy(params: Dict[str, Any]) -> Dict[str, Any]:
    vision = str(params.get("vision") or "").strip()
    if not vision:
        raise ValueError("vision is required")
    market = str(params.get("market") or "").strip()
    return _run_skill_recipe(
        "pm.strategy",
        "product-strategy-session",
        {"vision": vision, "market": market or "（待定义）"},
        topic_for_signals=market or vision,
        extra_instructions="输出战略选择、差异化定位、关键 bet 与衡量指标。",
    )


def run_pm_roadmap(params: Dict[str, Any]) -> Dict[str, Any]:
    goals = str(params.get("goals") or "").strip()
    if not goals:
        raise ValueError("goals is required")
    horizon = str(params.get("horizon") or "").strip()
    return _run_skill_recipe(
        "pm.roadmap",
        "roadmap-planning",
        {"goals": goals, "horizon": horizon or "Now/Next/Later"},
        topic_for_signals=goals,
    )


def run_pm_user_story(params: Dict[str, Any]) -> Dict[str, Any]:
    feature = str(params.get("feature") or "").strip()
    if not feature:
        raise ValueError("feature is required")
    persona = str(params.get("persona") or "").strip()
    return _run_skill_recipe(
        "pm.user_story",
        "user-story",
        {"feature": feature, "persona": persona or "（待定义）"},
        temperature=0.3,
        extra_instructions="每条故事含 As a / I want / so that 与 Gherkin 验收标准；过大需求需拆分。",
    )


def run_pm_prioritize(params: Dict[str, Any]) -> Dict[str, Any]:
    initiatives = str(params.get("initiatives") or "").strip()
    if not initiatives:
        raise ValueError("initiatives is required")
    constraints = str(params.get("constraints") or "").strip()
    return _run_skill_recipe(
        "pm.prioritize",
        "prioritization-advisor",
        {"initiatives": initiatives, "constraints": constraints or "（无特殊约束）"},
        extra_instructions="给出评分框架、排序结果、取舍理由与建议的下一步。",
    )


def run_analysis(recipe_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
    handlers: Dict[str, Callable[[Dict[str, Any]], Dict[str, Any]]] = {
        "market.research": run_market_research,
        "idea.generate": run_idea_generation,
        "product.analyze": run_product_analyze,
        "product.optimize": run_product_optimize,
        "competitor.scan": run_competitor_scan,
        "pm.discovery": run_pm_discovery,
        "pm.jtbd": run_pm_jtbd,
        "pm.strategy": run_pm_strategy,
        "pm.roadmap": run_pm_roadmap,
        "pm.user_story": run_pm_user_story,
        "pm.prioritize": run_pm_prioritize,
    }
    handler = handlers.get(recipe_id)
    if not handler:
        raise ValueError(f"Unknown analysis recipe: {recipe_id}")
    return handler(params)
