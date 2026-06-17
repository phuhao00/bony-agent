"""Procurement Assistant — vendor evaluation, RFQ, quote comparison, and cost optimization."""

from agents.base.bot import BaseAgent
from tools.procurement_tools import PROCUREMENT_TOOLS
from utils.logger import setup_logger

logger = setup_logger("procurement_agent")

AGENT_ID = "procurement_agent"
AGENT_DESCRIPTION = "采购助手：供应商评估、RFQ 起草、报价比对、合同审查与成本优化"
AGENT_CAPABILITIES = [
    "procurement_vendor_eval",
    "procurement_rfq",
    "procurement_quote_compare",
    "procurement_contract_review",
    "procurement_cost_optimize",
    "procurement_sourcing",
    "vendor_management",
    "spend_analysis",
]

SYSTEM_PROMPT = """你是 AI Media Agent 的采购助手（Procurement Assistant）。

你的职责是帮助用户完成企业采购与供应链关键决策：

## 核心能力

1. **供应商评估**：`vendor.evaluate` — 资质、交付、质量、财务与合规尽职调查
2. **RFQ 起草**：`rfq.draft` — 结构化询价/招标需求与评分标准
3. **报价对比**：`quote.compare` — TCO 分析、条款差异与采购建议
4. **合同审查**：`contract.review` — 采购合同条款风险识别（非正式法律意见）
5. **成本优化**：`cost.optimize` — Spend 分析与降本策略
6. **寻源策略**：`sourcing.strategy` — 品类寻源与供应商池规划

## 工作原则

1. **先证据后建议**：涉及市场/供应商判断时先用 `collect_procurement_signals` 或 `search_web`
2. **结构化输出**：Markdown 章节、对比表格、P0/P1/P2 优先级
3. **风险透明**：标注高/中/低风险；不编造未经证实的供应商负面信息
4. **合规边界**：合同/法律相关内容注明「仅供参考，请咨询法务」
5. **TCO 思维**：除单价外考虑交期、质保、付款、隐性成本

## 工具

- `list_procurement_recipes` / `run_procurement_recipe` — 结构化工作流
- `collect_procurement_signals` — 采购与市场信号
- `search_web` — 联网补充行情与规范

回答使用中文，像资深采购经理一样务实、严谨、可执行。"""


def _build_agent(api_key: str = "") -> BaseAgent:
    agent = BaseAgent(
        name="ProcurementAssistant",
        system_prompt=SYSTEM_PROMPT,
        agent_id=AGENT_ID,
        description=AGENT_DESCRIPTION,
        capabilities=AGENT_CAPABILITIES,
        with_memory=False,
        with_rag=True,
    )
    agent.tools.extend(PROCUREMENT_TOOLS)
    logger.info("[procurement_agent] built agent_id=%s tools=%d", AGENT_ID, len(agent.tools))
    return agent


def get_procurement_agent(api_key: str = ""):
    return _build_agent(api_key).get_executor()


def get_procurement_base_agent(api_key: str = ""):
    return _build_agent(api_key)
