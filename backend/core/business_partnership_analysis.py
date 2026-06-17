"""Business partnership analysis helpers for Business Partnership Assistant."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from langchain_core.messages import HumanMessage, SystemMessage

from core.llm_provider import get_chat_llm
from tools.web_search_tools import execute_web_search_sync
from utils.logger import setup_logger

logger = setup_logger("business_partnership_analysis")

_BP_SYSTEM = """你是资深商务拓展（BD）与战略合作专家，擅长：
- 合作 outreach：冷启动邮件、私信、会议邀约话术
- 合作方案：商业模式、权益分配、里程碑与 ROI
- 条款审查：识别合作合同中的关键风险点（非正式法律意见）
- 伙伴评估：战略契合、资源互补、品牌与合规风险
- Pipeline 管理：BD 漏斗、阶段目标与优先级

输出要求：
1. 使用清晰 Markdown（## 章节、列表、表格）
2. 结合搜索信号，观点务实可执行
3. 给出优先级（P0/P1/P2）与下一步动作
4. 不编造具体融资、营收等硬数据；不确定时标注「待验证」
5. 涉及法律条款时注明「需法务复核，本分析仅供参考」
6. 回答使用中文"""


def gather_partnership_signals(
    topic: str,
    *,
    extra_queries: Optional[List[str]] = None,
    max_results: int = 8,
) -> Dict[str, Any]:
    topic = (topic or "").strip()
    if not topic:
        return {"topic": "", "searches": [], "hot_topics": ""}

    queries = [
        f"{topic} 商务合作 案例",
        f"{topic} 战略合作 模式",
        f"{topic} 行业 伙伴",
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
            logger.warning("[business_partnership_analysis] search failed for %s: %s", q, exc)
            text = f"搜索失败: {exc}"
        searches.append({"query": q, "result": (text or "")[:6000]})

    return {"topic": topic, "searches": searches}


def _format_signals(signals: Dict[str, Any]) -> str:
    parts = [f"主题：{signals.get('topic', '')}"]
    for row in signals.get("searches") or []:
        parts.append(f"\n### 搜索：{row.get('query', '')}\n{row.get('result', '')}")
    return "\n".join(parts)


def _run_llm(human: str, *, temperature: float = 0.35) -> str:
    llm = get_chat_llm(temperature=temperature)
    result = llm.invoke([SystemMessage(content=_BP_SYSTEM), HumanMessage(content=human)])
    return str(result.content or "").strip()


def run_outreach_draft(params: Dict[str, Any]) -> Dict[str, Any]:
    our = str(params.get("our_company") or "").strip()
    target = str(params.get("target_partner") or "").strip()
    if not our or not target:
        raise ValueError("our_company and target_partner are required")
    coop_type = str(params.get("cooperation_type") or "战略合作").strip()
    value_prop = str(params.get("value_prop") or "").strip()

    signals = gather_partnership_signals(target, extra_queries=[f"{target} 公司 业务", f"{our} {target} 合作"])
    prompt = (
        f"请撰写面向「{target}」的商务合作 outreach 文案。\n"
        f"我方：{our}\n"
        f"合作类型：{coop_type}\n"
        f"价值主张：{value_prop or '（请结合搜索推断并标注）'}\n\n"
        "输出：\n"
        "## 合作切入点分析\n"
        "## 首触达邮件/私信（正式版 + 简洁版）\n"
        "## LinkedIn/微信跟进话术\n"
        "## 跟进节奏（Day 0/3/7/14）\n"
        "## 会议邀约模板\n"
        "## 常见拒绝应对\n\n"
        f"参考信号：\n{_format_signals(signals)}"
    )
    report = _run_llm(prompt, temperature=0.45)
    return {"recipe": "outreach.draft", "target_partner": target, "signals": signals, "report": report}


def run_proposal_generate(params: Dict[str, Any]) -> Dict[str, Any]:
    our = str(params.get("our_company") or "").strip()
    partner = str(params.get("partner_name") or "").strip()
    if not our or not partner:
        raise ValueError("our_company and partner_name are required")
    goal = str(params.get("cooperation_goal") or "").strip()
    scope = str(params.get("scope") or "").strip()

    signals = gather_partnership_signals(
        partner,
        extra_queries=[f"{partner} {our} 合作方案", f"{partner} 商业模式"],
    )
    prompt = (
        f"请撰写「{our} × {partner}」商务合作方案。\n"
        f"合作目标：{goal or '互利共赢，拓展市场'}\n"
        f"合作范围：{scope or '（待定义，请给出建议选项）'}\n\n"
        "方案结构：\n"
        "## 合作背景与机会\n"
        "## 双方价值与资源互补\n"
        "## 合作模式（含权益分配框架）\n"
        "## 里程碑与时间表\n"
        "## 预期 ROI / 成功指标\n"
        "## 风险与退出机制\n"
        "## 下一步行动\n\n"
        f"参考信号：\n{_format_signals(signals)}"
    )
    report = _run_llm(prompt)
    return {"recipe": "proposal.generate", "partner_name": partner, "signals": signals, "report": report}


def run_contract_review(params: Dict[str, Any]) -> Dict[str, Any]:
    summary = str(params.get("contract_summary") or "").strip()
    if not summary:
        raise ValueError("contract_summary is required")
    coop_type = str(params.get("cooperation_type") or "").strip()
    our_role = str(params.get("our_role") or "").strip()

    prompt = (
        f"请对以下合作条款做商务视角的要点审查（非正式法律意见，需法务复核）。\n"
        f"合作类型：{coop_type or '（未指定）'}\n"
        f"我方角色：{our_role or '（未指定）'}\n\n"
        "条款摘要：\n"
        f"{summary}\n\n"
        "报告结构：\n"
        "## 条款概览\n"
        "## 高风险条款（🔴 需重点谈判）\n"
        "## 中风险条款（🟡 建议优化）\n"
        "## 对我方有利的条款\n"
        "## 谈判筹码与替代方案\n"
        "## 需法务/财务复核清单\n"
        "## 免责声明\n"
    )
    report = _run_llm(prompt, temperature=0.25)
    return {"recipe": "contract.review", "report": report}


def run_partner_evaluate(params: Dict[str, Any]) -> Dict[str, Any]:
    partner = str(params.get("partner_name") or "").strip()
    if not partner:
        raise ValueError("partner_name is required")
    industry = str(params.get("industry") or "").strip()
    intent = str(params.get("cooperation_intent") or "").strip()
    our = str(params.get("our_company") or "").strip()

    signals = gather_partnership_signals(
        partner,
        extra_queries=[f"{partner} 公司 评价", f"{partner} {industry} 合作"],
    )
    prompt = (
        f"请评估潜在合作方「{partner}」。\n"
        f"行业：{industry or '（待推断）'}\n"
        f"拟合作方向：{intent or '（待定义）'}\n"
        f"我方公司：{our or '（未指定，做中立评估）'}\n\n"
        "报告结构：\n"
        "## 伙伴背景速览\n"
        "## 评估维度打分表（战略契合/资源互补/品牌风险/执行可行性，1-5 分）\n"
        "## 合作机会点\n"
        "## 风险与红旗信号\n"
        "## Go / No-Go 建议\n"
        "## 若推进：建议的合作模式与首步动作\n\n"
        f"参考信号：\n{_format_signals(signals)}"
    )
    report = _run_llm(prompt)
    return {"recipe": "partner.evaluate", "partner_name": partner, "signals": signals, "report": report}


def run_pipeline_plan(params: Dict[str, Any]) -> Dict[str, Any]:
    goal = str(params.get("business_goal") or "").strip()
    if not goal:
        raise ValueError("business_goal is required")
    segments = str(params.get("target_segments") or "").strip()
    timeline = str(params.get("timeline") or "本季度").strip()
    resources = str(params.get("resources") or "").strip()

    signals = gather_partnership_signals(
        goal,
        extra_queries=[f"{segments or goal} BD 合作 pipeline", f"{goal} 战略合作 策略"],
    )
    prompt = (
        f"请规划商务合作 BD Pipeline。\n"
        f"业务目标：{goal}\n"
        f"目标伙伴类型：{segments or '（请给出细分建议）'}\n"
        f"时间窗口：{timeline}\n"
        f"可用资源：{resources or '（标准 BD 团队）'}\n\n"
        "报告结构：\n"
        "## Pipeline 阶段定义（Lead → Qualified → Proposal → Negotiation → Closed）\n"
        "## 各阶段目标数量与转化率假设\n"
        "## 优先级伙伴清单模板（Top 10 筛选标准）\n"
        "## 每周/每月关键动作\n"
        "## KPI 与复盘节奏\n"
        "## 资源分配建议\n"
        "## 首月启动计划\n\n"
        f"参考信号：\n{_format_signals(signals)}"
    )
    report = _run_llm(prompt)
    return {"recipe": "pipeline.plan", "business_goal": goal, "signals": signals, "report": report}


def run_analysis(recipe_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
    handlers = {
        "outreach.draft": run_outreach_draft,
        "proposal.generate": run_proposal_generate,
        "contract.review": run_contract_review,
        "partner.evaluate": run_partner_evaluate,
        "pipeline.plan": run_pipeline_plan,
    }
    handler = handlers.get(recipe_id)
    if not handler:
        raise ValueError(f"Unknown analysis recipe: {recipe_id}")
    return handler(params)
