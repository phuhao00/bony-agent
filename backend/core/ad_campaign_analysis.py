"""Ad campaign analysis helpers for Ad Campaign Assistant."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from langchain_core.messages import HumanMessage, SystemMessage

from core.llm_provider import get_chat_llm
from tools.web_search_tools import execute_web_search_sync
from utils.logger import setup_logger

logger = setup_logger("ad_campaign_analysis")

_AD_SYSTEM = """你是资深数字营销与广告投放专家，擅长：
- 全渠道投放策略：抖音、小红书、微信、B站、Google/Meta 等
- 创意文案：高 CTR 标题、卖点提炼、A/B 测试设计
- 受众定向：人群画像、兴趣标签、Lookalike、排除策略
- 预算优化：渠道分配、放量节奏、ROAS/CPA 目标
- 效果复盘：漏斗诊断、创意疲劳、落地页优化

输出要求：
1. 使用清晰 Markdown（## 章节、列表、表格）
2. 结合搜索信号，标注平台特性差异
3. 给出优先级（P0/P1/P2）与可执行下一步
4. 不编造具体 CPC/CPA 等硬数据；不确定时标注「待验证/需平台后台数据」
5. 回答使用中文"""


def _safe_hot_topics() -> str:
    try:
        from tools.social_trending import get_hot_topics

        return str(get_hot_topics.invoke({}) or "")[:4000]
    except Exception as exc:
        logger.warning("[ad_campaign_analysis] hot topics unavailable: %s", exc)
        return ""


def gather_ad_signals(
    topic: str,
    *,
    extra_queries: Optional[List[str]] = None,
    max_results: int = 8,
) -> Dict[str, Any]:
    topic = (topic or "").strip()
    if not topic:
        return {"topic": "", "searches": [], "hot_topics": ""}

    queries = [
        f"{topic} 广告投放 策略 2025 2026",
        f"{topic} 广告创意 案例",
        f"{topic} 受众 定向 营销",
    ]
    if extra_queries:
        queries.extend(q.strip() for q in extra_queries if q and q.strip())

    seen: set[str] = set()
    searches: List[Dict[str, str]] = []
    for q in queries:
        if q in seen:
            continue
        seen.add(q)
        try:
            text = execute_web_search_sync(q, max_results=max_results)
        except Exception as exc:
            logger.warning("[ad_campaign_analysis] search failed for %s: %s", q, exc)
            text = f"搜索失败: {exc}"
        searches.append({"query": q, "result": (text or "")[:6000]})

    return {
        "topic": topic,
        "searches": searches,
        "hot_topics": _safe_hot_topics(),
    }


def _format_signals(signals: Dict[str, Any]) -> str:
    parts = [f"主题：{signals.get('topic', '')}"]
    for row in signals.get("searches") or []:
        parts.append(f"\n### 搜索：{row.get('query', '')}\n{row.get('result', '')}")
    hot = (signals.get("hot_topics") or "").strip()
    if hot:
        parts.append(f"\n### 社媒热点快照\n{hot}")
    return "\n".join(parts)


def _run_llm(human: str, *, temperature: float = 0.35) -> str:
    llm = get_chat_llm(temperature=temperature)
    result = llm.invoke([SystemMessage(content=_AD_SYSTEM), HumanMessage(content=human)])
    return str(result.content or "").strip()


def run_strategy_plan(params: Dict[str, Any]) -> Dict[str, Any]:
    product = str(params.get("product") or "").strip()
    if not product:
        raise ValueError("product is required")
    goal = str(params.get("goal") or "获客与转化").strip()
    budget = str(params.get("budget") or "待定义").strip()
    platforms = str(params.get("platforms") or "抖音, 小红书, 微信").strip()

    signals = gather_ad_signals(
        product,
        extra_queries=[f"{product} {platforms} 投放", f"{product} 广告 KPI"],
    )
    prompt = (
        f"请为「{product}」制定全渠道广告投放策略。\n"
        f"投放目标：{goal}\n"
        f"预算范围：{budget}\n"
        f"目标平台：{platforms}\n\n"
        "报告结构：\n"
        "## 执行摘要\n"
        "## 目标与 KPI 框架\n"
        "## 渠道组合与平台特性匹配\n"
        "## 投放节奏（测试期/放量期/优化期）\n"
        "## 创意与落地页策略\n"
        "## 风险与合规注意\n"
        "## 首周行动清单（P0/P1）\n\n"
        f"参考信号：\n{_format_signals(signals)}"
    )
    report = _run_llm(prompt)
    return {"recipe": "strategy.plan", "product": product, "signals": signals, "report": report}


def run_creative_copy(params: Dict[str, Any]) -> Dict[str, Any]:
    product = str(params.get("product") or "").strip()
    if not product:
        raise ValueError("product is required")
    audience = str(params.get("audience") or "目标用户").strip()
    platform = str(params.get("platform") or "全平台").strip()
    tone = str(params.get("tone") or "专业且有吸引力").strip()
    count = max(3, min(10, int(params.get("count") or 5)))

    signals = gather_ad_signals(product, extra_queries=[f"{product} 广告文案 爆款", f"{platform} 广告 创意"])
    prompt = (
        f"请为「{product}」生成 {count} 组广告投放创意。\n"
        f"目标受众：{audience}\n"
        f"投放平台：{platform}\n"
        f"语气风格：{tone}\n\n"
        "每组包含：\n"
        "- 主标题（≤20字）\n"
        "- 副标题/正文（≤60字）\n"
        "- CTA 按钮文案\n"
        "- 核心卖点（3 条）\n"
        "- A/B 测试变量建议\n"
        "- 适用场景（信息流/搜索/开屏等）\n\n"
        "最后给出「优先测试 Top 2」及理由。\n\n"
        f"参考信号：\n{_format_signals(signals)}"
    )
    report = _run_llm(prompt, temperature=0.5)
    return {"recipe": "creative.copy", "product": product, "signals": signals, "report": report}


def run_audience_analyze(params: Dict[str, Any]) -> Dict[str, Any]:
    product = str(params.get("product") or "").strip()
    if not product:
        raise ValueError("product is required")
    core_users = str(params.get("core_users") or "").strip()
    platform = str(params.get("platform") or "抖音/小红书").strip()

    signals = gather_ad_signals(
        product,
        extra_queries=[f"{product} 用户画像", f"{product} {platform} 受众"],
    )
    prompt = (
        f"请为「{product}」做广告投放受众分析与定向建议。\n"
        f"已知核心用户：{core_users or '（待推断，请结合搜索）'}\n"
        f"主要平台：{platform}\n\n"
        "报告结构：\n"
        "## 核心人群画像（年龄/地域/兴趣/行为）\n"
        "## 细分人群矩阵（至少 3 个 segment）\n"
        "## 定向标签建议（含 Lookalike 方向）\n"
        "## 排除人群策略\n"
        "## 各平台定向参数映射\n"
        "## 验证实验设计\n\n"
        f"参考信号：\n{_format_signals(signals)}"
    )
    report = _run_llm(prompt)
    return {"recipe": "audience.analyze", "product": product, "signals": signals, "report": report}


def run_budget_allocate(params: Dict[str, Any]) -> Dict[str, Any]:
    total = str(params.get("total_budget") or "").strip()
    if not total:
        raise ValueError("total_budget is required")
    goal = str(params.get("goal") or "获客").strip()
    platforms = str(params.get("platforms") or "抖音, 小红书, 搜索").strip()
    duration = str(params.get("duration") or "1 个月").strip()

    signals = gather_ad_signals(
        f"{platforms} 广告预算",
        extra_queries=[f"{platforms} CPC CPA  benchmark", f"{goal} 投放 预算分配"],
    )
    prompt = (
        f"请制定广告投放预算分配方案。\n"
        f"总预算：{total}\n"
        f"核心目标：{goal}\n"
        f"投放平台：{platforms}\n"
        f"投放周期：{duration}\n\n"
        "报告结构：\n"
        "## 预算切分总览（表格：平台/占比/金额/目标 KPI）\n"
        "## 分阶段放量节奏（Week 1-4）\n"
        "## 测试预算 vs 放量预算\n"
        "## ROI/CPA 预期区间（标注假设）\n"
        "## 优化触发条件（何时加预算/砍渠道）\n"
        "## 风险提示\n\n"
        f"参考信号：\n{_format_signals(signals)}"
    )
    report = _run_llm(prompt)
    return {"recipe": "budget.allocate", "total_budget": total, "signals": signals, "report": report}


def run_report_review(params: Dict[str, Any]) -> Dict[str, Any]:
    name = str(params.get("campaign_name") or "").strip()
    if not name:
        raise ValueError("campaign_name is required")
    metrics = str(params.get("metrics") or "").strip()
    issues = str(params.get("issues") or "").strip()

    signals = gather_ad_signals(name, extra_queries=[f"{name} 广告优化", f"{name} 投放 诊断"])
    prompt = (
        f"请对广告投放活动「{name}」做效果复盘与优化建议。\n"
        f"关键指标：{metrics or '（用户未提供，请给出通用诊断框架并标注需补充的数据）'}\n"
        f"已知问题：{issues or '（无）'}\n\n"
        "报告结构：\n"
        "## 数据解读（漏斗/关键指标）\n"
        "## 表现亮点\n"
        "## 问题诊断（创意/受众/出价/落地页/时段）\n"
        "## 优化建议（按 P0/P1/P2）\n"
        "## 下一轮 A/B 实验清单\n"
        "## 需补充的数据字段\n\n"
        f"参考信号：\n{_format_signals(signals)}"
    )
    report = _run_llm(prompt)
    return {"recipe": "report.review", "campaign_name": name, "signals": signals, "report": report}


def run_analysis(recipe_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
    handlers = {
        "strategy.plan": run_strategy_plan,
        "creative.copy": run_creative_copy,
        "audience.analyze": run_audience_analyze,
        "budget.allocate": run_budget_allocate,
        "report.review": run_report_review,
    }
    handler = handlers.get(recipe_id)
    if not handler:
        raise ValueError(f"Unknown analysis recipe: {recipe_id}")
    return handler(params)
