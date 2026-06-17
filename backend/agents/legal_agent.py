"""Legal Advisor Agent — case research, compliance audit, and finance-related legal analysis."""

from agents.base.bot import BaseAgent
from tools.legal_tools import LEGAL_TOOLS
from utils.logger import setup_logger

logger = setup_logger("legal_agent")

AGENT_ID = "legal_agent"
AGENT_DESCRIPTION = "法律顾问助手：案例解读、公司合规体检、法规政策与合同金融风险分析"
AGENT_CAPABILITIES = [
    "legal_case_research",
    "legal_compliance_audit",
    "legal_regulation_interpret",
    "legal_contract_review",
    "legal_finance_advisory",
    "compliance_analysis",
    "case_research",
]

SYSTEM_PROMPT = """你是 AI Media Agent 的法律顾问助手（Legal Advisor Agent）。

你的职责是帮助企业与个人在工商、公司、经济、金融、财务相关领域获得更有依据的合规辅助：

## 核心能力

1. **案例检索与解读**：`case.research` — 司法案例、指导案例、行政处罚与裁判规则
2. **公司合规体检**：`compliance.audit` — 工商、治理、劳动、财税、数据、广告等合规风险
3. **法规政策解读**：`regulation.interpret` — 法律法规与监管政策对企业经营的影响
4. **合同风险审查**：`contract.risk` — 投融资、劳动、采购等合同高风险条款识别
5. **经济金融法律要点**：`finance.legal` — 税务、投融资、资金结算与个人经济纠纷边界

## 工作原则

1. **先检索后结论**：涉及法律判断时先用 `collect_legal_signals` 或 `search_web` 收集案例与规范信号
2. **结构化输出**：Markdown 章节、风险等级（高/中/低）、表格与行动清单
3. **标注依据**：区分法规条文、案例要点、监管实践；无法核实的内容标注「待核实」
4. **合规导向**：给出可落地的合规建议、文件留痕与内控要点
5. **明确边界**：你不是执业律师，不提供正式法律意见；重大事项应建议咨询专业律师

## 工具

- `list_legal_recipes` / `run_legal_recipe` — 结构化法律研究工作流
- `collect_legal_signals` — 案例、法规与执法信号检索
- `search_web` — 联网补充最新政策与案例动态

"""


def _build_agent(api_key: str = "") -> BaseAgent:
    agent = BaseAgent(
        name="LegalAdvisor",
        system_prompt=SYSTEM_PROMPT,
        agent_id=AGENT_ID,
        description=AGENT_DESCRIPTION,
        capabilities=AGENT_CAPABILITIES,
        with_memory=False,
        with_rag=True,
    )
    agent.tools.extend(LEGAL_TOOLS)
    logger.info("[legal_agent] built agent_id=%s tools=%d", AGENT_ID, len(agent.tools))
    return agent


def get_legal_agent(api_key: str = ""):
    return _build_agent(api_key).get_executor()


def get_legal_base_agent(api_key: str = ""):
    return _build_agent(api_key)
