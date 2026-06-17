"""Game Art Agent — visual style, character/scene briefs, UI art guidelines."""

from agents.base.bot import BaseAgent
from tools.game_art_tools import GAME_ART_TOOLS
from utils.logger import setup_logger

logger = setup_logger("game_art_agent")

AGENT_ID = "game_art_agent"
AGENT_DESCRIPTION = "游戏美术助手：视觉风格、角色场景 Brief、UI 规范与竞品视觉分析"
AGENT_CAPABILITIES = [
    "ga_visual_design",
    "ga_character_scene",
    "visual_style",
    "character_design",
    "scene_concept",
    "game_ui_art",
]

SYSTEM_PROMPT = """你是 AI Media Agent 的游戏美术助手（Game Art Agent）。

## 核心能力

1. **视觉风格指南** `style.guide` — 色彩、光影、材质与统一性
2. **角色设计 Brief** `character.brief` — 形体、服装层级与交付清单
3. **场景概念** `scene.concept` — 氛围、地标与关卡可读性
4. **UI 美术规范** `ui.art.guide` — 界面层级、组件与动效原则
5. **竞品视觉分析** `visual.research` — 赛道画面差异化

## 工作原则

1. 描述要「可画」：形体、比例、材质、光照、镜头
2. 给出具体参考方向（游戏/影视），避免空泛形容词
3. 考虑产能：LOD、模块化、风格复杂度
4. 与策划/玩法衔接：可读性、UI 遮挡、性能边界
5. 涉及市场趋势时用 `get_gaming_trends` 与 `search_web` 补充

## 工具

- `list_game_art_recipes` / `run_game_art_recipe` — 结构化工作流
- `collect_game_art_signals` — 视觉与游戏参考信号
- `search_web` — 联网补充参考
- `get_gaming_trends` / `analyze_gaming_trends` — 游戏热点

回答使用中文，像美术总监一样专业、具体、可交付。"""


def _build_agent(api_key: str = "") -> BaseAgent:
    agent = BaseAgent(
        name="GameArt",
        system_prompt=SYSTEM_PROMPT,
        agent_id=AGENT_ID,
        description=AGENT_DESCRIPTION,
        capabilities=AGENT_CAPABILITIES,
        with_memory=False,
        with_rag=True,
    )
    agent.tools.extend(GAME_ART_TOOLS)
    logger.info("[game_art_agent] built agent_id=%s tools=%d", AGENT_ID, len(agent.tools))
    return agent


def get_game_art_agent(api_key: str = ""):
    return _build_agent(api_key).get_executor()


def get_game_art_base_agent(api_key: str = ""):
    return _build_agent(api_key)
