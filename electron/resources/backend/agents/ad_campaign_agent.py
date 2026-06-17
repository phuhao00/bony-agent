"""Ad Campaign Assistant — ad strategy, creative, audience, budget, and performance review."""

from agents.base.bot import BaseAgent
from tools.ad_campaign_tools import AD_CAMPAIGN_TOOLS
from utils.logger import setup_logger

logger = setup_logger("ad_campaign_agent")

AGENT_ID = "ad_campaign_agent"
AGENT_DESCRIPTION = "广告投放助手：投放策略、创意文案、受众定向、预算分配与效果复盘"
AGENT_CAPABILITIES = [
    "ad_strategy_planning",
    "ad_creative_generation",
    "ad_audience_analysis",
    "ad_budget_allocation",
    "ad_performance_review",
    "digital_marketing",
]

SYSTEM_PROMPT = """你是 AI Media Agent 的广告投放助手（Ad Campaign Agent）。

你的职责是帮助用户完成数字广告投放的全链路规划与优化：

## 核心能力

1. **投放策略**：`strategy.plan` — 渠道组合、KPI 框架、投放节奏
2. **创意文案**：`creative.copy` — 标题/正文/CTA、A/B 测试方向
3. **受众定向**：`audience.analyze` — 人群画像、标签、Lookalike
4. **预算分配**：`budget.allocate` — 渠道切分、放量节奏
5. **效果复盘**：`report.review` — 诊断、优化、实验清单

## 工作原则

1. **平台差异**：抖音/小红书/微信/B站/Google/Meta 各有特性，勿一刀切
2. **数据诚实**：不编造 CPC/CPA/ROAS；缺数据时给诊断框架并标注需补充字段
3. **可测试**：每个建议尽量附带 A/B 假设与成功指标
4. **结构化**：Markdown 章节、表格、P0/P1/P2 优先级
5. **合规**：注意广告法、虚假宣传、行业禁投规则

## 工具

- `list_ad_campaign_recipes` / `run_ad_campaign_recipe` — 结构化工作流
- `collect_ad_signals` — 快速拉取投放与市场信号
- `search_web` — 联网补充平台政策与案例
- `get_hot_topics` / `analyze_trends` — 热点与趋势

回答使用中文，像资深投放负责人一样务实、数据驱动。"""


def _build_agent(api_key: str = "") -> BaseAgent:
    agent = BaseAgent(
        name="AdCampaign",
        system_prompt=SYSTEM_PROMPT,
        agent_id=AGENT_ID,
        description=AGENT_DESCRIPTION,
        capabilities=AGENT_CAPABILITIES,
        with_memory=False,
        with_rag=True,
    )
    agent.tools.extend(AD_CAMPAIGN_TOOLS)
    logger.info("[ad_campaign_agent] built agent_id=%s tools=%d", AGENT_ID, len(agent.tools))
    return agent


def get_ad_campaign_agent(api_key: str = ""):
    return _build_agent(api_key).get_executor()


def get_ad_campaign_base_agent(api_key: str = ""):
    return _build_agent(api_key)
