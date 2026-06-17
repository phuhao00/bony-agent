"""AI Short Drama Director — script, storyboard, scene generation and final assembly."""

from agents.base.bot import BaseAgent
from tools.short_drama_tools import SHORT_DRAMA_TOOLS
from utils.logger import setup_logger

logger = setup_logger("short_drama_agent")

AGENT_ID = "short_drama_agent"
AGENT_DESCRIPTION = "AI 短剧导演：剧本、分镜、场景生成、配音字幕与成片组装"
AGENT_CAPABILITIES = [
    "short_drama_production",
]

SYSTEM_PROMPT = """你是 AI Media Agent 的短剧导演（Short Drama Agent）。

## 核心能力

1. **短剧剧本**：`short_drama.script` — 一句话创意 → 完整剧本 + 角色卡
2. **短剧分镜**：`short_drama.storyboard` — 可视化分镜，含镜头、台词、情绪、BGM
3. **生成短剧成片**：`short_drama.produce` — 剧本 → 分镜 → 场景图 → 配音/字幕建议
4. **单场景重生成**：`short_drama.scene_regen` — 针对单个场景优化并重新生成画面

## 工作原则

1. **平台适配**：抖音/快手（9:16，节奏快、强情绪）、小红书（3:4，精致治愈）、YouTube Shorts（全球化、视觉强）
2. **节奏第一**：前 3 秒必须有强钩子，每 3-5 秒一个小转折
3. **角色精简**：不超过 4 个角色，外貌和服装描述要具体，便于 AI 生图保持一致性
4. **场景可控**：每个场景 3-12 秒，包含明确景别、运镜、画面描述、台词、字幕、情绪
5. **诚实降级**：如果图片/视频生成失败，返回完整分镜和素材生成计划，让用户手动继续

## 工具

- `list_short_drama_recipes` / `run_short_drama_recipe` — 结构化工作流
- `analyze_short_drama_brief` — 快速分析创意
- `build_short_drama_storyboard` — 生成分镜

回答使用中文，像短视频导演一样节奏感强、画面感强。"""


def _build_agent(api_key: str = "") -> BaseAgent:
    agent = BaseAgent(
        name="ShortDrama",
        system_prompt=SYSTEM_PROMPT,
        agent_id=AGENT_ID,
        description=AGENT_DESCRIPTION,
        capabilities=AGENT_CAPABILITIES,
        with_memory=False,
        with_rag=False,
    )
    agent.tools.extend(SHORT_DRAMA_TOOLS)
    logger.info("[short_drama_agent] built agent_id=%s tools=%d", AGENT_ID, len(agent.tools))
    return agent


def get_short_drama_agent(api_key: str = ""):
    return _build_agent(api_key).get_executor()


def get_short_drama_base_agent(api_key: str = ""):
    return _build_agent(api_key)
