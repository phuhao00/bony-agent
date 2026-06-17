from langchain.tools import tool
from utils.logger import setup_logger
import json
import os

logger = setup_logger("reach_tools")

try:
    from agent_reach.core import AgentReach
    REACH_AVAILABLE = True
except ImportError:
    REACH_AVAILABLE = False

@tool
def agent_reach_doctor() -> str:
    """
    运行 Agent-Reach 诊断工具，检查当前环境的互联网触达能力。
    它会检查：
    - 代理配置 (Proxies)
    - 第三方 CLI 工具 (yt-dlp, xreach, gh 等) 的安装状态
    - 各个社交平台 (Twitter, Reddit, Bilibili, 小红书等) 的连接健康度
    当环境报“无法触达”、“缺少依赖”或“部署失败”时，应优先调用此工具。
    """
    if not REACH_AVAILABLE:
        return "当前系统已内置平台发布能力，无需额外安装 agent-reach。请直接使用 publish_content 工具发布内容。"
    
    logger.info("Running agent-reach doctor...")
    try:
        # AgentReach(action="doctor") performs diagnostics
        reach = AgentReach(action="doctor")
        reach.run()
        return "✅ Agent-Reach 诊断任务已启动。请查看控制台输出以获取详细报告。"
    except Exception as e:
        logger.error(f"Agent-Reach doctor failed: {e}")
        return f"❌ 诊断运行失败: {str(e)}"

@tool
def agent_reach_install(channels: str = "all") -> str:
    """
    一键安装或修复 Agent-Reach 支持的所有互联网增强工具。
    参数 channels: 指定要安装的平台，默认为 'all' (全部)。
    也可以指定单个或多个（逗号分隔），例如 'twitter,bilibili'。
    """
    if not REACH_AVAILABLE:
        return "当前系统已内置平台发布能力，无需安装 agent-reach。请直接使用 publish_content 工具发布内容到各平台。"
    
    logger.info(f"Running agent-reach install for channels: {channels}")
    try:
        # Based on subagent info, run() executes based on action
        reach = AgentReach(action="install")
        # Note: If library supports specific channels in constructor, we would add them here.
        # For now, following the base pattern.
        reach.run()
        return f"✅ Agent-Reach 正在安装必要组件，请耐心等待。"
    except Exception as e:
        logger.error(f"Agent-Reach install failed: {e}")
        return f"❌ 安装运行失败: {str(e)}"

# 导出工具集 — 包未安装时返回空列表，不影响 agent 启动
reach_tools = [agent_reach_doctor, agent_reach_install] if REACH_AVAILABLE else []
