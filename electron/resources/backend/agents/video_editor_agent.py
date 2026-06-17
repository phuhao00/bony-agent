from agents.base.bot import BaseAgent
from tools.media_tools import remix_videos, ai_remix_videos
from utils.logger import setup_logger

logger = setup_logger("video_editor_agent")

# --- Agent 元信息 (供注册表使用) ---
AGENT_ID = "video_editor_agent"
AGENT_DESCRIPTION = "专业视频剪辑助手，支持合并、裁剪、转场、AI智能混剪"
AGENT_CAPABILITIES = ["video_editing", "remix"]

SYSTEM_PROMPT = """你是一个专业的视频剪辑助手。
你可以帮助用户合并、裁剪、添加转场等。
请根据用户的需求，调用相应的工具完成任务。
"""


def _build_agent() -> BaseAgent:
    logger.debug("[video_editor_agent] _build_agent() called")
    agent = BaseAgent(
        name="VideoEditorAgent",
        system_prompt=SYSTEM_PROMPT,
        agent_id=AGENT_ID,
        description=AGENT_DESCRIPTION,
        capabilities=AGENT_CAPABILITIES,
        with_memory=False,
        with_rag=False,
    )
    agent.tools.extend([remix_videos, ai_remix_videos])
    logger.info("[video_editor_agent] built agent_id=%s tools=%d", AGENT_ID, len(agent.tools))
    return agent


def get_video_editor_agent(api_key: str):
    """返回 executor (保持向后兼容)"""
    logger.info("[video_editor_agent] get_video_editor_agent() → executor")
    return _build_agent().get_executor(api_key)


def get_video_editor_base_agent(api_key: str = "") -> BaseAgent:
    """返回 BaseAgent 实例 (供注册表和 Orchestrator 使用)"""
    logger.debug("[video_editor_agent] get_video_editor_base_agent() called")
    return _build_agent()

