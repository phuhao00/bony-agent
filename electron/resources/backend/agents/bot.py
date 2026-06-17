from tools.media_tools import generate_image, generate_video, edit_image
from tools.memory_tools import save_memory, search_memory
from tools.session_search_tools import search_past_sessions
from tools.rag_tools import search_knowledge_base
from tools.publisher_tools import publish_content_tool, get_publish_accounts_tool
from utils.logger import setup_logger
from core.prompts.agent_prompts import get_media_agent_system_prompt

from tools.script_tools import script_tools
from tools.reach_tools import reach_tools

# 初始化日志记录器
logger = setup_logger("agent_bot")

# --- Agent 元信息 (供注册表使用) ---
AGENT_ID = "media_agent"
AGENT_DESCRIPTION = "多媒体创作Agent，擅长图片生成、视频生成、记忆检索与知识库查询"
AGENT_CAPABILITIES = ["image", "video", "memory", "knowledge", "publish", "image_edit"]


def get_agent_executor(api_key: str):
    """返回 executor (保持向后兼容)。"""
    logger.info("Initializing Agent executor via BaseAgent")
    return get_media_base_agent(api_key).get_executor(api_key)


def get_media_base_agent(api_key: str = ""):
    """返回 BaseAgent 实例 (供注册表和 Orchestrator 使用)"""
    from agents.base.bot import BaseAgent

    basic_tools = [
        generate_image, edit_image, generate_video, search_memory, save_memory, search_past_sessions,
        search_knowledge_base, publish_content_tool, get_publish_accounts_tool,
    ]
    tools = basic_tools + script_tools + reach_tools

    # Inject tools from enabled MCP servers (silently skip unavailable servers)
    from agents.mcp_tools import attach_mcp_tools
    tools = attach_mcp_tools(tools)

    agent = BaseAgent(
        name="MediaAgent",
        system_prompt=get_media_agent_system_prompt(),
        agent_id=AGENT_ID,
        description=AGENT_DESCRIPTION,
        capabilities=AGENT_CAPABILITIES,
        with_memory=True,
        with_rag=True,
    )
    agent.tools.extend(tools)
    return agent

