"""Legal research and compliance analysis helpers for Legal Advisor Agent."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from langchain_core.messages import HumanMessage, SystemMessage

from core.llm_provider import get_chat_llm
from tools.web_search_tools import execute_web_search_sync
from utils.logger import setup_logger

logger = setup_logger("legal_analysis")

_LEGAL_SYSTEM = """你是资深公司法律顾问与合规专家，擅长：
- 案例研究：检索并解读司法案例、指导案例、行政处罚与监管通报
- 法规解读：公司法、民法典、证券法、劳动法、税法、反垄断、数据合规等
- 合规体检：工商登记、治理结构、劳动用工、广告营销、财税内控
- 合同审查：投融资、劳动、采购、合作、保密与竞业等条款风险
- 经济金融：投融资、关联交易、资金结算、个人经济纠纷的法律边界

输出要求：
1. 使用清晰 Markdown（## 章节、表格、风险等级标注）
2. 区分「高/中/低」风险，并说明依据（法规条文、案例要点、监管实践）
3. 引用时尽量标注来源类型（如：最高法指导案例、证监会处罚、市监总局通报）
4. 不编造具体案号、裁判日期等无法验证的细节；不确定时标注「待核实」
5. 文末必须包含免责声明：本分析为 AI 辅助研究，不构成正式法律意见，重大事项请咨询执业律师
6. 回答使用中文"""


def gather_legal_signals(
    topic: str,
    *,
    extra_queries: Optional[List[str]] = None,
    max_results: int = 8,
) -> Dict[str, Any]:
    """Collect web search snippets for legal cases, regulations and enforcement."""
    topic = (topic or "").strip()
    if not topic:
        return {"topic": "", "searches": []}

    queries = [
        f"{topic} 司法案例 裁判文书 最高人民法院",
        f"{topic} 行政处罚 市场监管 证监会",
        f"{topic} 法律法规 司法解释 合规",
        f"{topic} 企业合规 风险提示",
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
            logger.warning("[legal_analysis] search failed for %s: %s", q, exc)
            text = f"搜索失败: {exc}"
        searches.append({"query": q, "result": (text or "")[:6000]})

    return {"topic": topic, "searches": searches}


def _format_signals(signals: Dict[str, Any]) -> str:
    parts = [f"主题：{signals.get('topic', '')}"]
    for row in signals.get("searches") or []:
        parts.append(f"\n### 检索：{row.get('query', '')}\n{row.get('result', '')}")
    return "\n".join(parts)


def _run_llm(human: str, *, temperature: float = 0.25) -> str:
    llm = get_chat_llm(temperature=temperature)
    result = llm.invoke([SystemMessage(content=_LEGAL_SYSTEM), HumanMessage(content=human)])
    return str(result.content or "").strip()


def _disclaimer() -> str:
    return (
        "\n\n---\n"
        "**免责声明**：以上内容由 AI 基于公开检索信息整理，仅供研究与合规辅助参考，"
        "不构成正式法律意见。涉及诉讼、投融资、重大合同或监管调查等事项，请咨询执业律师或合规顾问。"
    )


def run_case_research(params: Dict[str, Any]) -> Dict[str, Any]:
    topic = str(params.get("topic") or "").strip()
    if not topic:
        raise ValueError("topic is required")
    context = str(params.get("context") or "").strip()
    jurisdiction = str(params.get("jurisdiction") or "中国").strip()

    signals = gather_legal_signals(
        topic,
        extra_queries=[
            f"{topic} 指导案例 公报案例",
            f"{topic} {jurisdiction} 裁判规则",
        ],
    )
    prompt = (
        f"请围绕「{topic}」撰写案例检索与权威法律解读报告。\n"
        f"业务背景：{context or '未提供'}\n"
        f"法域：{jurisdiction}\n\n"
        "报告结构：\n"
        "## 争议焦点与法律问题归纳\n"
        "## 权威规范依据（法律/司法解释/部门规章）\n"
        "## 代表性案例与裁判要点（表格：案由/法院层级/核心规则/实务启示）\n"
        "## 监管执法与行政处罚趋势（如有）\n"
        "## 对企业/个人的合规启示\n"
        "## 风险等级与应对建议（高/中/低）\n"
        "## 建议进一步核实的信息源\n\n"
        f"参考检索信号：\n{_format_signals(signals)}"
    )
    report = _run_llm(prompt) + _disclaimer()
    return {"recipe": "case.research", "topic": topic, "signals": signals, "report": report}


def run_compliance_audit(params: Dict[str, Any]) -> Dict[str, Any]:
    profile = str(params.get("company_profile") or "").strip()
    if not profile:
        raise ValueError("company_profile is required")
    concerns = str(params.get("concerns") or "").strip()
    stage = str(params.get("stage") or "").strip()

    signals = gather_legal_signals(
        profile,
        extra_queries=[
            f"{profile} 企业合规检查清单",
            f"{profile} 行政处罚 典型案例",
            "公司治理 劳动用工 数据合规 广告合规",
        ],
    )
    prompt = (
        f"请对以下企业做合规体检报告。\n"
        f"公司概况：{profile}\n"
        f"发展阶段：{stage or '未说明'}\n"
        f"已知疑虑：{concerns or '无'}\n\n"
        "报告结构：\n"
        "## 合规体检摘要（总体风险评级）\n"
        "## 工商与公司治理\n"
        "## 劳动用工与人力资源\n"
        "## 财税与财务内控\n"
        "## 数据安全与个人信息保护\n"
        "## 广告营销与不正当竞争\n"
        "## 行业专项合规（按业务推断）\n"
        "## 高风险项清单（P0 立即处理 / P1 30 天内 / P2 持续改进）\n"
        "## 合规体系建设建议\n\n"
        f"参考检索信号：\n{_format_signals(signals)}"
    )
    report = _run_llm(prompt) + _disclaimer()
    return {"recipe": "compliance.audit", "company_profile": profile, "signals": signals, "report": report}


def run_regulation_interpret(params: Dict[str, Any]) -> Dict[str, Any]:
    regulation = str(params.get("regulation") or "").strip()
    if not regulation:
        raise ValueError("regulation is required")
    scenario = str(params.get("business_scenario") or "").strip()
    entity_type = str(params.get("entity_type") or "公司").strip()

    signals = gather_legal_signals(
        regulation,
        extra_queries=[
            f"{regulation} 最新修订 解读",
            f"{regulation} {scenario} 合规要求" if scenario else f"{regulation} 企业适用",
        ],
    )
    prompt = (
        f"请解读法规/政策：「{regulation}」。\n"
        f"适用主体：{entity_type}\n"
        f"业务场景：{scenario or '一般企业经营'}\n\n"
        "报告结构：\n"
        "## 规范概述与立法/监管目的\n"
        "## 核心条款要点（表格：条款主题/要求/违规后果）\n"
        "## 对{entity_type}的实务影响\n"
        "## 与相关法规的衔接（如有）\n"
        "## 合规落地 checklist\n"
        "## 近期执法/案例动态（如有）\n"
        "## 行动建议与优先级\n\n"
        f"参考检索信号：\n{_format_signals(signals)}"
    )
    report = _run_llm(prompt) + _disclaimer()
    return {"recipe": "regulation.interpret", "regulation": regulation, "signals": signals, "report": report}


def run_contract_risk(params: Dict[str, Any]) -> Dict[str, Any]:
    contract_type = str(params.get("contract_type") or "").strip()
    if not contract_type:
        raise ValueError("contract_type is required")
    summary = str(params.get("summary") or "").strip()
    party_role = str(params.get("party_role") or "").strip()

    signals = gather_legal_signals(
        contract_type,
        extra_queries=[
            f"{contract_type} 合同 高风险条款",
            f"{contract_type} 合同纠纷 裁判规则",
        ],
    )
    prompt = (
        f"请对「{contract_type}」做条款风险审查要点报告。\n"
        f"我方角色：{party_role or '未指定'}\n"
        f"合同要点/摘要：\n{summary or '（未提供具体条款，请按该类合同常见风险做通用审查框架）'}\n\n"
        "报告结构：\n"
        "## 审查范围与假设\n"
        "## 必备条款检查清单\n"
        "## 高风险条款识别（表格：条款类型/风险/建议修订方向/风险等级）\n"
        "## 争议解决与管辖建议\n"
        "## 违约责任与赔偿上限\n"
        "## 保密、知识产权与竞业（如适用）\n"
        "## 签约前谈判要点\n"
        "## 需律师人工复核的事项\n\n"
        f"参考检索信号：\n{_format_signals(signals)}"
    )
    report = _run_llm(prompt) + _disclaimer()
    return {"recipe": "contract.risk", "contract_type": contract_type, "signals": signals, "report": report}


def run_finance_legal(params: Dict[str, Any]) -> Dict[str, Any]:
    topic = str(params.get("topic") or "").strip()
    if not topic:
        raise ValueError("topic is required")
    entity = str(params.get("entity") or "").strip()
    details = str(params.get("details") or "").strip()

    signals = gather_legal_signals(
        topic,
        extra_queries=[
            f"{topic} 税务 合规 风险",
            f"{topic} 金融监管 案例",
            f"{topic} 公司法 股东 责任",
        ],
    )
    prompt = (
        f"请围绕经济/金融/财务法律议题「{topic}」撰写要点分析报告。\n"
        f"涉及主体：{entity or '未指定'}\n"
        f"具体情况：{details or '未提供'}\n\n"
        "报告结构：\n"
        "## 议题概述与法律框架\n"
        "## 关键法律边界（什么能做 / 什么不能做）\n"
        "## 税务与财务合规要点\n"
        "## 投融资与资金往来风险（如适用）\n"
        "## 个人经济纠纷与民事责任（如适用）\n"
        "## 监管红线与典型案例\n"
        "## 合规操作建议与文件留痕\n"
        "## 风险等级总结\n\n"
        f"参考检索信号：\n{_format_signals(signals)}"
    )
    report = _run_llm(prompt) + _disclaimer()
    return {"recipe": "finance.legal", "topic": topic, "signals": signals, "report": report}


def run_analysis(recipe_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
    handlers = {
        "case.research": run_case_research,
        "compliance.audit": run_compliance_audit,
        "regulation.interpret": run_regulation_interpret,
        "contract.risk": run_contract_risk,
        "finance.legal": run_finance_legal,
    }
    handler = handlers.get(recipe_id)
    if not handler:
        raise ValueError(f"Unknown analysis recipe: {recipe_id}")
    return handler(params)
