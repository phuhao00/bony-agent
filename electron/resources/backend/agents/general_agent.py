from agents.base.bot import BaseAgent
from agents.mcp_tools import attach_mcp_tools
from tools.media_tools import generate_image, generate_video, remix_videos, edit_image
from tools.script_tools import generate_script
from tools.copywriting_tools import generate_copywriting
from tools.moderation_tools import check_content
from tools.web_search_tools import search_web
from utils.logger import setup_logger

logger = setup_logger("general_agent")

# --- Agent 元信息 (供注册表使用) ---
AGENT_ID = "creative_agent"
AGENT_DESCRIPTION = "全能媒体创作助理，集成图片/视频生成、脚本创作、文案编写、内容审核与联网搜索"
AGENT_CAPABILITIES = ["script", "copywriting", "moderation", "image", "video", "web_search", "image_edit"]


def _build_agent() -> BaseAgent:
    """构建 Creative Agent BaseAgent 实例"""
    logger.debug("[general_agent] _build_agent() called")
    system_prompt = (
        "你是一个全能的媒体创作助理，集成了图片生成、视频生成、脚本创作、文案编写、内容审核和联网搜索能力。\n\n"
        "**联网搜索规则：** 当用户询问天气、新闻、股价、汇率、实时数据或任何需要最新外部信息的问题时，"
        "必须先调用 search_web 工具获取结果，再根据搜索结果回答；禁止编造事实或让用户自行去查。\n"
        "回答时简要引用搜索摘要或来源 URL。\n\n"
        "**创作规则：绝不追问。** 涉及媒体创作时，无论用户输入多简短或模糊，都不要反问用户。\n"
        "根据上下文合理推断用户意图，直接执行并输出成品。\n"
        "如有假设，在输出开头用一句话说明（例如：我理解您想要一张宣传海报，以下是生成结果）。\n\n"
        "**图片编辑：** 当用户要求修改、编辑已有图片（换背景、局部重绘、去物体、扩图等），"
        "使用 edit_image 工具，传入 source_image_url 与对应 mode（instruction/inpaint/remove/outpaint）。"
    )
    agent = BaseAgent(
        name="CreativeAgent",
        system_prompt=system_prompt,
        agent_id=AGENT_ID,
        description=AGENT_DESCRIPTION,
        capabilities=AGENT_CAPABILITIES,
        with_memory=False,
        with_rag=False,
    )
    tools = [
        search_web,
        generate_image,
        edit_image,
        generate_video,
        remix_videos,
        generate_script,
        generate_copywriting,
        check_content,
    ]
    agent.tools.extend(attach_mcp_tools(tools))
    logger.info("[general_agent] built agent_id=%s tools=%d", AGENT_ID, len(agent.tools))
    return agent


def get_general_agent(api_key: str):
    """返回 executor (保持向后兼容)"""
    logger.info("[general_agent] get_general_agent() → executor")
    return get_creative_base_agent(api_key).get_executor(api_key)


def get_creative_base_agent(api_key: str = "") -> BaseAgent:
    """返回 BaseAgent 实例 (供注册表和 Orchestrator 使用)"""
    logger.debug("[general_agent] get_creative_base_agent() called")
    return _build_agent()

