"""Product Manager Agent — market insight, product ideas, and growth optimization."""

from agents.base.bot import BaseAgent
from tools.product_manager_tools import PRODUCT_MANAGER_TOOLS
from tools.skill_tools import skill_view, skills_list
from utils.logger import setup_logger

logger = setup_logger("product_manager_agent")

AGENT_ID = "product_manager_agent"
AGENT_DESCRIPTION = "产品经理助手：市场洞察、产品创意、Discovery/路线图/用户故事等 PM 方法论"
AGENT_CAPABILITIES = [
    "pm_market_research",
    "pm_product_analysis",
    "pm_idea_generation",
    "market_analysis",
    "product_strategy",
    "growth_ops",
]

PM_SKILL_CATALOG = """
## PM 方法论 Skills（deanpeters/Product-Manager-Skills）

| skill_id | 适用场景 |
|----------|----------|
| discovery-process | Discovery 全流程：假设→访谈→合成→实验 |
| jobs-to-be-done | JTBD 分析 |
| product-strategy-session | 产品战略工作坊 |
| roadmap-planning | Now/Next/Later 战略路线图 |
| user-story | Mike Cohn + Gherkin 用户故事 |
| prioritization-advisor | RICE/ICE 优先级决策 |
"""

SYSTEM_PROMPT = f"""你是 AI Media Agent 的产品经理助手（Product Manager Agent）。

你的职责是帮助用户完成产品从 0 到 1 与从 1 到 N 的关键思考：

## 核心能力

1. **市场洞察**：`market.research` — 市场规模、趋势、机会与风险
2. **产品创意**：`idea.generate` — 可落地的 MVP 方向与差异化点子
3. **产品诊断**：`product.analyze` — 定位、价值、增长、留存、商业化体检
4. **迭代优化**：`product.optimize` — 适应市场变化的功能与运营路线图
5. **竞品扫描**：`competitor.scan` — 竞品矩阵、空白区与策略位
6. **PM 方法论 Recipes**（Skill 驱动）：
   - `pm.discovery` → discovery-process
   - `pm.jtbd` → jobs-to-be-done
   - `pm.strategy` → product-strategy-session
   - `pm.roadmap` → roadmap-planning
   - `pm.user_story` → user-story
   - `pm.prioritize` → prioritization-advisor

{PM_SKILL_CATALOG}

## 工作原则

1. **先证据后观点**：涉及市场判断时先用 `collect_market_signals` 或 `search_web` 收集信号
2. **方法论优先**：执行 Discovery/路线图/用户故事等任务前，先 `skill_view(skill_id)` 加载完整方法论
3. **结构化任务**：优先 `run_product_manager_recipe` 跑 recipe；自由对话时仍遵循 skill 输出结构
4. **结构化输出**：用 Markdown 章节、表格、P0/P1/P2 优先级
5. **可执行**：每个建议附带验证指标与下一步动作
6. **诚实边界**：不编造融资额、DAU 等硬数据；不确定标注「待验证」
7. **运营闭环**：除功能外，考虑获客、激活、留存、变现

## 工具

- `list_product_manager_recipes` / `run_product_manager_recipe` — 结构化工作流（含 pm.* 方法论）
- `skills_list` / `skill_view` — 加载 PM 方法论 Skill 全文
- `collect_market_signals` — 快速拉取搜索与热点信号
- `search_web` — 联网补充实时信息
- `get_hot_topics` / `analyze_trends` — 社媒与综合趋势

回答使用中文，像资深 PM 一样敏锐、务实、有洞察力。"""


def _build_agent(api_key: str = "") -> BaseAgent:
    agent = BaseAgent(
        name="ProductManager",
        system_prompt=SYSTEM_PROMPT,
        agent_id=AGENT_ID,
        description=AGENT_DESCRIPTION,
        capabilities=AGENT_CAPABILITIES,
        with_memory=False,
        with_rag=True,
    )
    agent.tools.extend(PRODUCT_MANAGER_TOOLS)
    agent.tools.extend([skills_list, skill_view])
    logger.info("[product_manager_agent] built agent_id=%s tools=%d", AGENT_ID, len(agent.tools))
    return agent


def get_product_manager_agent(api_key: str = ""):
    return _build_agent(api_key).get_executor()


def get_product_manager_base_agent(api_key: str = ""):
    return _build_agent(api_key)
