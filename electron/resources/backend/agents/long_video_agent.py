from agents.base.bot import BaseAgent
from tools.long_video_tools import produce_long_video
from utils.logger import setup_logger

logger = setup_logger("long_video_agent")

AGENT_ID = "long_video_agent"
AGENT_DESCRIPTION = "长视频工坊导演：多分镜规划 + 通义 Wan 分段并行生成 + 成片拼接（适合成片较长或连续叙事的需求）"
AGENT_CAPABILITIES = ["long_video", "video", "wan", "storytelling"]

SYSTEM_PROMPT = """你是「长视频工坊」编导 Agent。
- 当用户想用自然语言产出「较长的一整条视频」（多镜头、可分镜连续叙事），请优先调用 produce_long_video 工具完成制作。
- 目标时长：用户在对话里写明要多少秒（如「做 90 秒的」）或明显表达长度时，把对应秒数传给 duration_sec；否则用默认 30 秒。风格未说明时可用 cinematic。
- 若用户只是要几秒钟的短视频、单镜头试玩，应提醒他们使用普通短视频生成（本 Agent 专注分段长片管线），不要调用 produce_long_video。
- 工具返回后，用简洁中文说明成片亮点、任务 ID、以及预览链接（若有 Markdown 图片/视频语法请保留便于前端展示）。
"""


def _build_agent() -> BaseAgent:
    agent = BaseAgent(
        name="LongVideoWorkshopAgent",
        system_prompt=SYSTEM_PROMPT,
        agent_id=AGENT_ID,
        description=AGENT_DESCRIPTION,
        capabilities=AGENT_CAPABILITIES,
        with_memory=False,
        with_rag=False,
    )
    agent.tools.extend([produce_long_video])
    logger.info("[long_video_agent] built tools=%d", len(agent.tools))
    return agent


def get_long_video_base_agent(api_key: str = "") -> BaseAgent:
    return _build_agent()
