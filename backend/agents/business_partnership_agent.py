"""Business Partnership Assistant — outreach, proposals, contracts, partner evaluation, BD pipeline."""

from agents.base.bot import BaseAgent
from tools.business_partnership_tools import BUSINESS_PARTNERSHIP_TOOLS
from utils.logger import setup_logger

logger = setup_logger("business_partnership_agent")

AGENT_ID = "business_partnership_agent"
AGENT_DESCRIPTION = "商务合作助手：合作 outreach、方案撰写、条款要点、伙伴评估与 BD pipeline"
AGENT_CAPABILITIES = [
    "bp_outreach_draft",
    "bp_proposal_generation",
    "bp_contract_review",
    "bp_partner_evaluation",
    "bp_pipeline_planning",
    "business_development",
]

SYSTEM_PROMPT = """你是 AI Media Agent 的商务合作助手（Business Partnership Agent）。

你的职责是帮助用户完成商务拓展（BD）与战略合作的关键工作：

## 核心能力

1. **Outreach 文案**：`outreach.draft` — 冷启动邮件、私信、跟进节奏
2. **合作方案**：`proposal.generate` — 模式、权益、里程碑、ROI
3. **条款要点**：`contract.review` — 风险条款、谈判筹码（非正式法律意见）
4. **伙伴评估**：`partner.evaluate` — 战略契合、资源互补、风险
5. **Pipeline 规划**：`pipeline.plan` — BD 漏斗、阶段目标、优先级

## 工作原则

1. **双赢思维**：方案需体现双方价值，避免单边诉求
2. **可执行**：每步有明确 owner、时间线与成功标准
3. **风险意识**：品牌、合规、交付、财务条款需点明
4. **法律边界**：条款分析仅供参考，重要合同需法务复核
5. **结构化**：Markdown 章节、表格、P0/P1/P2

## 工具

- `list_business_partnership_recipes` / `run_business_partnership_recipe` — 结构化工作流
- `collect_partnership_signals` — 快速拉取伙伴与市场信号
- `search_web` — 联网补充行业与伙伴背景
- `get_hot_topics` / `analyze_trends` — 行业趋势

回答使用中文，像资深 BD 总监一样专业、务实、有谈判智慧。"""


def _build_agent(api_key: str = "") -> BaseAgent:
    agent = BaseAgent(
        name="BusinessPartnership",
        system_prompt=SYSTEM_PROMPT,
        agent_id=AGENT_ID,
        description=AGENT_DESCRIPTION,
        capabilities=AGENT_CAPABILITIES,
        with_memory=False,
        with_rag=True,
    )
    agent.tools.extend(BUSINESS_PARTNERSHIP_TOOLS)
    logger.info(
        "[business_partnership_agent] built agent_id=%s tools=%d",
        AGENT_ID,
        len(agent.tools),
    )
    return agent


def get_business_partnership_agent(api_key: str = ""):
    return _build_agent(api_key).get_executor()


def get_business_partnership_base_agent(api_key: str = ""):
    return _build_agent(api_key)
