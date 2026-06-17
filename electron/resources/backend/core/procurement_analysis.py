"""Procurement analysis helpers for Procurement Assistant."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from langchain_core.messages import HumanMessage, SystemMessage

from core.llm_provider import get_chat_llm
from tools.web_search_tools import execute_web_search_sync
from utils.logger import setup_logger

logger = setup_logger("procurement_analysis")

_PROCUREMENT_SYSTEM = """你是资深采购与供应链专家，擅长：
- 供应商评估：资质、交付、质量、财务健康、ESG 与合规
- 寻源策略：品类管理、供应商池建设、区域布局与风险分散
- RFQ/RFP：需求规格、评分标准、交付与验收条款
- 报价比对：TCO 分析、隐性成本、条款差异
- 合同审查：付款、交付、质保、SLA、违约与知识产权（注明非正式法律意见）
- 成本优化：Spend 分析、集采、替代料、谈判杠杆

输出要求：
1. 使用清晰 Markdown（## 章节、列表、表格）
2. 风险按高/中/低标注，建议按 P0/P1/P2 排序
3. 引用搜索信号作为依据；不确定处标注「待验证」
4. 不编造具体审计结论或未经证实的供应商负面信息
5. 合同/合规内容需注明「仅供参考，重大决策请咨询法务/采购合规」
6. 回答使用中文"""


def gather_procurement_signals(
    topic: str,
    *,
    extra_queries: Optional[List[str]] = None,
    max_results: int = 8,
) -> Dict[str, Any]:
    """Collect web search snippets for procurement topics."""
    topic = (topic or "").strip()
    if not topic:
        return {"topic": "", "searches": []}

    queries = [
        f"{topic} 采购 供应商 评估",
        f"{topic} 采购 成本 优化 2025 2026",
        f"{topic} 供应链 风险 合规",
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
            logger.warning("[procurement_analysis] search failed for %s: %s", q, exc)
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
    result = llm.invoke([SystemMessage(content=_PROCUREMENT_SYSTEM), HumanMessage(content=human)])
    return str(result.content or "").strip()


def run_vendor_evaluate(params: Dict[str, Any]) -> Dict[str, Any]:
    vendor = str(params.get("vendor_name") or "").strip()
    if not vendor:
        raise ValueError("vendor_name is required")
    category = str(params.get("category") or "").strip()
    requirements = str(params.get("requirements") or "").strip()

    signals = gather_procurement_signals(
        vendor,
        extra_queries=[f"{vendor} 供应商 资质", f"{category} 供应商 对比" if category else ""],
    )
    prompt = (
        f"请对供应商「{vendor}」做采购尽职评估。\n"
        f"采购品类：{category or '待明确'}\n"
        f"关键要求：{requirements or '（待补充）'}\n\n"
        "报告结构：\n"
        "## 执行摘要\n"
        "## 供应商概况\n"
        "## 评估维度（表格：维度/评分1-5/依据/风险）\n"
        "  - 资质与合规\n"
        "  - 交付与产能\n"
        "  - 质量与售后\n"
        "  - 财务与稳定性\n"
        "  - ESG 与声誉\n"
        "## 关键风险（高/中/低）\n"
        "## 建议的验证动作（P0/P1）\n"
        "## 是否建议进入短名单及条件\n\n"
        f"参考信号：\n{_format_signals(signals)}"
    )
    report = _run_llm(prompt)
    return {"recipe": "vendor.evaluate", "vendor_name": vendor, "signals": signals, "report": report}


def run_rfq_draft(params: Dict[str, Any]) -> Dict[str, Any]:
    item = str(params.get("item") or "").strip()
    if not item:
        raise ValueError("item is required")
    quantity = str(params.get("quantity") or "").strip()
    deadline = str(params.get("deadline") or "").strip()
    budget = str(params.get("budget") or "").strip()

    signals = gather_procurement_signals(
        item,
        extra_queries=[f"{item} 询价 RFQ 模板", f"{item} 采购 规格 标准"],
    )
    prompt = (
        f"请为「{item}」起草一份 RFQ/询价需求文档。\n"
        f"数量/规模：{quantity or '待确认'}\n"
        f"期望交付：{deadline or '待确认'}\n"
        f"预算范围：{budget or '待确认'}\n\n"
        "文档结构：\n"
        "## 项目背景\n"
        "## 采购范围与规格要求\n"
        "## 交付与验收标准\n"
        "## 商务条款（付款、质保、违约）\n"
        "## 供应商资质要求\n"
        "## 报价表格模板（含列说明）\n"
        "## 评分标准与权重建议\n"
        "## 时间节点与联系人占位\n\n"
        f"参考信号：\n{_format_signals(signals)}"
    )
    report = _run_llm(prompt)
    return {"recipe": "rfq.draft", "item": item, "signals": signals, "report": report}


def run_quote_compare(params: Dict[str, Any]) -> Dict[str, Any]:
    item = str(params.get("item") or "").strip()
    quotes = str(params.get("quotes") or "").strip()
    if not item:
        raise ValueError("item is required")
    if not quotes:
        raise ValueError("quotes is required")
    criteria = str(params.get("criteria") or "").strip()

    signals = gather_procurement_signals(item, extra_queries=[f"{item} 采购 价格 行情"])
    prompt = (
        f"请对比以下「{item}」采购报价并给出建议。\n\n"
        f"报价输入：\n{quotes}\n\n"
        f"评估关注点：{criteria or '价格、交期、质保、付款条件、TCO'}\n\n"
        "报告结构：\n"
        "## 报价概览\n"
        "## 对比矩阵（表格：供应商/单价/总价/交期/质保/付款/隐性成本）\n"
        "## 条款差异分析\n"
        "## TCO 与风险对比\n"
        "## 推荐方案及理由\n"
        "## 谈判要点与备选方案\n\n"
        f"参考信号：\n{_format_signals(signals)}"
    )
    report = _run_llm(prompt)
    return {"recipe": "quote.compare", "item": item, "signals": signals, "report": report}


def run_contract_review(params: Dict[str, Any]) -> Dict[str, Any]:
    summary = str(params.get("contract_summary") or "").strip()
    if not summary:
        raise ValueError("contract_summary is required")
    vendor = str(params.get("vendor_name") or "").strip()
    deal_value = str(params.get("deal_value") or "").strip()

    signals = gather_procurement_signals(
        "采购合同 条款",
        extra_queries=["采购合同 付款 交付 质保 违约 审查要点"],
    )
    prompt = (
        f"请审查以下采购合同关键条款（非正式法律意见）。\n"
        f"供应商：{vendor or '未指定'}\n"
        f"合同金额：{deal_value or '未指定'}\n\n"
        f"合同摘要/条款：\n{summary}\n\n"
        "报告结构：\n"
        "## 合同概况\n"
        "## 条款审查（表格：条款/现状/风险等级/建议修改）\n"
        "  覆盖：标的、价格、付款、交付、验收、质保、知识产权、保密、违约、争议解决\n"
        "## 采购侧需关注的 red flags\n"
        "## 建议谈判修改清单（P0/P1）\n"
        "## 免责声明：本分析仅供参考，重大合同请咨询法务\n\n"
        f"参考信号：\n{_format_signals(signals)}"
    )
    report = _run_llm(prompt)
    return {"recipe": "contract.review", "vendor_name": vendor, "signals": signals, "report": report}


def run_cost_optimize(params: Dict[str, Any]) -> Dict[str, Any]:
    category = str(params.get("category") or "").strip()
    if not category:
        raise ValueError("category is required")
    current_spend = str(params.get("current_spend") or "").strip()
    pain_points = str(params.get("pain_points") or "").strip()

    signals = gather_procurement_signals(
        category,
        extra_queries=[f"{category} 采购 降本", f"{category} 集采 策略"],
    )
    prompt = (
        f"请为采购品类「{category}」制定成本优化方案。\n"
        f"当前 spend：{current_spend or '（待补充）'}\n"
        f"已知问题：{pain_points or '（待补充）'}\n\n"
        "报告结构：\n"
        "## 成本结构分析\n"
        "## 降本机会（表格：措施/预期节省/难度/风险）\n"
        "## 集采与供应商整合建议\n"
        "## 规格标准化与替代方案\n"
        "## 谈判杠杆与合同优化\n"
        "## 90 天行动计划（P0/P1/P2）\n\n"
        f"参考信号：\n{_format_signals(signals)}"
    )
    report = _run_llm(prompt)
    return {"recipe": "cost.optimize", "category": category, "signals": signals, "report": report}


def run_sourcing_strategy(params: Dict[str, Any]) -> Dict[str, Any]:
    category = str(params.get("category") or "").strip()
    if not category:
        raise ValueError("category is required")
    context = str(params.get("business_context") or "").strip()
    constraints = str(params.get("constraints") or "").strip()

    signals = gather_procurement_signals(
        category,
        extra_queries=[f"{category} 供应商 格局", f"{category} 寻源 策略"],
    )
    prompt = (
        f"请为品类「{category}」制定寻源策略。\n"
        f"业务背景：{context or '（待补充）'}\n"
        f"约束条件：{constraints or '无特殊约束'}\n\n"
        "报告结构：\n"
        "## 品类与 spend 概况\n"
        "## 供应市场格局\n"
        "## 寻源策略（单一/双源/多源）及理由\n"
        "## 供应商池建设建议\n"
        "## 区域与风险分散\n"
        "## 关键谈判要点\n"
        "## 监控指标与复盘节奏\n\n"
        f"参考信号：\n{_format_signals(signals)}"
    )
    report = _run_llm(prompt)
    return {"recipe": "sourcing.strategy", "category": category, "signals": signals, "report": report}


def run_analysis(recipe_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
    handlers = {
        "vendor.evaluate": run_vendor_evaluate,
        "rfq.draft": run_rfq_draft,
        "quote.compare": run_quote_compare,
        "contract.review": run_contract_review,
        "cost.optimize": run_cost_optimize,
        "sourcing.strategy": run_sourcing_strategy,
    }
    handler = handlers.get(recipe_id)
    if not handler:
        raise ValueError(f"Unknown analysis recipe: {recipe_id}")
    return handler(params)
