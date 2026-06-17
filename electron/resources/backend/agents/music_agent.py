"""Music Production Assistant — text-to-music, lyrics-to-music, style reference and BGM."""

from agents.base.bot import BaseAgent
from tools.music_tools import MUSIC_TOOLS
from utils.logger import setup_logger

logger = setup_logger("music_agent")

AGENT_ID = "music_agent"
AGENT_DESCRIPTION = "AI 音乐制作助手：文本生成音乐、歌词谱曲、参考风格迁移、视频 BGM"
AGENT_CAPABILITIES = [
    "music_production",
]

SYSTEM_PROMPT = """你是 AI Media Agent 的音乐制作助手（Music Agent）。

## 核心能力

1. **文本生成音乐**：`music.text_to_music` — 根据风格、情绪、时长等描述生成音乐
2. **歌词生成音乐**：`music.lyrics_to_music` — 粘贴歌词，AI 谱曲
3. **参考风格生成**：`music.reference_style` — 参考音频风格生成新音乐
4. **视频配乐生成**：`music.bgm_for_video` — 为视频主题生成可循环 BGM

## 工作原则

1. **风格清晰**：引导用户明确风格、情绪、时长、是否纯音乐
2. **结构可控**：支持 Intro/Verse/Chorus/Bridge/Outro 等结构标签
3. **诚实透明**：当前 music 功能默认使用 mock provider 输出示例音频；真实 MiniMax/Suno API 接入后结果将自动升级
4. **与媒体工作流联动**：生成的音乐可用于短剧、短视频、Vlog 等项目的 BGM
5. **输出结构化**：返回音频 URL、元数据和使用建议

## 工具

- `list_music_recipes` / `run_music_recipe` — 结构化音乐工作流
- `generate_music` — 直接生成音乐
- `describe_music_provider` — 查看可用 provider

回答使用中文，像音乐制作人一样专业、有审美、注重细节。"""


def _build_agent(api_key: str = "") -> BaseAgent:
    agent = BaseAgent(
        name="Music",
        system_prompt=SYSTEM_PROMPT,
        agent_id=AGENT_ID,
        description=AGENT_DESCRIPTION,
        capabilities=AGENT_CAPABILITIES,
        with_memory=False,
        with_rag=False,
    )
    agent.tools.extend(MUSIC_TOOLS)
    logger.info("[music_agent] built agent_id=%s tools=%d", AGENT_ID, len(agent.tools))
    return agent


def get_music_agent(api_key: str = ""):
    return _build_agent(api_key).get_executor()


def get_music_base_agent(api_key: str = ""):
    return _build_agent(api_key)
