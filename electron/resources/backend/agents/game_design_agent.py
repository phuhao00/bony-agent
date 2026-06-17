"""Game Design Agent — concept, systems, levels, narrative, balance."""

from agents.base.bot import BaseAgent
from tools.game_design_tools import GAME_DESIGN_TOOLS
from utils.logger import setup_logger

logger = setup_logger("game_design_agent")

AGENT_ID = "game_design_agent"
AGENT_DESCRIPTION = "游戏策划助手：概念案、核心循环、系统设计、关卡规划与数值框架"
AGENT_CAPABILITIES = [
    "gd_concept_system",
    "gd_level_content",
    "gd_narrative_balance",
    "game_design",
    "system_design",
    "level_design",
    "game_balance",
]

SYSTEM_PROMPT = """你是 AI Media Agent 的游戏策划助手（Game Design Agent）。

## 核心能力

1. **概念案** `concept.pitch` — 卖点、用户、MVP 与验证
2. **核心循环** `core.loop` — 动机、反馈、留存钩子
3. **系统设计** `system.design` — 机制、边界与耦合
4. **关卡规划** `level.plan` — 难度曲线与内容节奏
5. **剧情世界观** `narrative.outline` — 主题、冲突与角色弧光
6. **数值框架** `balance.framework` — 成长曲线与验证思路

## 工作原则

1. 机制可落地：输入、规则、输出、边界案例
2. 优先级 P0/P1/P2 与可验证指标
3. 不编造销量/DAU；不确定标注「待验证」
4. 系统间耦合与反滥用边界要写清
5. 用 `get_gaming_trends` 与 `search_web` 了解赛道与对标

## 工具

- `list_game_design_recipes` / `run_game_design_recipe` — 结构化工作流
- `collect_game_design_signals` — 玩法与市场信号
- `search_web` — 联网调研
- `get_gaming_trends` / `analyze_gaming_trends` — 游戏热点

回答使用中文，像主策一样结构清晰、可执行。"""


def _build_agent(api_key: str = "") -> BaseAgent:
    agent = BaseAgent(
        name="GameDesign",
        system_prompt=SYSTEM_PROMPT,
        agent_id=AGENT_ID,
        description=AGENT_DESCRIPTION,
        capabilities=AGENT_CAPABILITIES,
        with_memory=False,
        with_rag=True,
    )
    agent.tools.extend(GAME_DESIGN_TOOLS)
    logger.info("[game_design_agent] built agent_id=%s tools=%d", AGENT_ID, len(agent.tools))
    return agent


def get_game_design_agent(api_key: str = ""):
    return _build_agent(api_key).get_executor()


def get_game_design_base_agent(api_key: str = ""):
    return _build_agent(api_key)
