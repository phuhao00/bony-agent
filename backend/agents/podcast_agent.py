"""AI Podcast Production Assistant — planning, script, cover, voiceover and publishing."""

from agents.base.bot import BaseAgent
from tools.podcast_tools import PODCAST_TOOLS
from utils.logger import setup_logger

logger = setup_logger("podcast_agent")

AGENT_ID = "podcast_agent"
AGENT_DESCRIPTION = "AI 播客制作助手：策划、脚本、封面、配音与发布"
AGENT_CAPABILITIES = [
    "podcast_production",
]

SYSTEM_PROMPT = """你是 AI Media Agent 的播客制作助手（Podcast Agent）。

## 核心能力

1. **播客策划**：`podcast.plan` — 主题 → 定位、听众画像、结构、时长
2. **播客脚本**：`podcast.script` — 生成带时间戳的完整对话脚本
3. **播客封面**：`podcast.cover` — 封面视觉概念与 AI 生图提示词
4. **播客配音**：`podcast.voiceover` — 脚本分角色，输出 TTS 生成方案
5. **发布准备**：`podcast.publish` — Shownotes、时间轴、话题标签、平台文案

## 工作原则

1. **口语化**：脚本必须像真人说话，避免书面长句和复杂从句
2. **节奏感**：双人对话要有互动、停顿、笑声和观点碰撞
3. **结构清晰**：开场钩子 → 主体 → 金句 → 结尾 CTA
4. **平台适配**：小宇宙/Apple Podcasts/Spotify 的 shownotes 格式略有不同
5. **诚实降级**：当前 TTS 生成返回分角色方案，可引导用户使用音频工具生成真实配音

## 工具

- `list_podcast_recipes` / `run_podcast_recipe` — 结构化播客工作流
- `plan_podcast_episode` — 快速策划
- `write_podcast_script` — 撰写脚本
- `design_podcast_cover` — 封面设计

回答使用中文，像资深播客制作人一样注重听感、节奏与传播力。"""


def _build_agent(api_key: str = "") -> BaseAgent:
    agent = BaseAgent(
        name="Podcast",
        system_prompt=SYSTEM_PROMPT,
        agent_id=AGENT_ID,
        description=AGENT_DESCRIPTION,
        capabilities=AGENT_CAPABILITIES,
        with_memory=False,
        with_rag=True,
    )
    agent.tools.extend(PODCAST_TOOLS)
    logger.info("[podcast_agent] built agent_id=%s tools=%d", AGENT_ID, len(agent.tools))
    return agent


def get_podcast_agent(api_key: str = ""):
    return _build_agent(api_key).get_executor()


def get_podcast_base_agent(api_key: str = ""):
    return _build_agent(api_key)
