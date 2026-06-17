"""
Script Writer Agent - 视频脚本创作专家

专门负责视频脚本生成，支持多平台适配、多风格差异化版本。
"""

from agents.base.bot import BaseAgent
from tools.script_tools import generate_script, generate_script_variants, get_platform_info
from tools.rag_tools import search_knowledge_base
from utils.logger import setup_logger

logger = setup_logger("script_writer_agent")

# --- Agent 元信息 ---
AGENT_ID = "script_writer_agent"
AGENT_DESCRIPTION = "视频脚本创作专家，擅长生成多平台适配的结构化脚本，支持差异化版本"
AGENT_CAPABILITIES = ["script", "storyboard", "platform_adaptation", "creative_writing"]

SYSTEM_PROMPT = """你是一位资深的视频脚本创作专家（Script Writer Agent）。

你擅长将任何主题转化为精彩的视频脚本，深谙各大流量平台的内容逻辑。

## 核心能力
1. **脚本生成**：调用 `generate_script` 生成完整结构化脚本
2. **多版本创作**：调用 `generate_script_variants` 生成差异化版本
3. **平台适配**：调用 `get_platform_info` 了解各平台规范
4. **知识检索**：调用 `search_knowledge_base` 获取行业背景知识

## 平台特性理解
- **抖音**：9:16竖屏，前3秒必须有强钩子，节奏快，镜头2-3秒切换
- **小红书**：3:4比例，场景化种草风格，真实体验感，干净治愈画面
- **B站**：16:9横屏，可加入互动梗，允许较长旁白讲解
- **YouTube**：16:9横屏，可接受较长开场，章节标记清晰

## 创作风格
- **口播带货**：主播直接讲解，突出卖点优惠，语气热情
- **剧情演绎**：有角色、场景、冲突和解决的故事线
- **干货讲解**：专业知识分享，逻辑清晰，有价值输出
- **种草测评**：真实体验分享，展示使用过程和效果

## 工作原则
1. **绝不追问**：无论用户输入多简短，都不要要求补充信息。根据上下文推断平台（默认抖音竖屏60s）、风格（默认口播带货/种草）并直接开始创作。
2. 根据平台特性调整脚本结构
3. 生成差异化版本供用户选择
4. 确保脚本包含画面、台词、运镜、BGM完整要素
5. 如需假设，在输出开头用一句话说明（如"我为您生成了一段抖音口播带货脚本："）

始终保持专业、有创意的态度，帮助用户打造爆款视频内容。
"""


def _build_agent() -> BaseAgent:
    """构建 Script Writer Agent"""
    logger.debug("[script_writer_agent] _build_agent() called")
    agent = BaseAgent(
        name="ScriptWriterAgent",
        system_prompt=SYSTEM_PROMPT,
        agent_id=AGENT_ID,
        description=AGENT_DESCRIPTION,
        capabilities=AGENT_CAPABILITIES,
        with_rag=True,
    )

    # 添加脚本创作相关工具
    agent.tools.extend([
        generate_script,
        generate_script_variants,
        get_platform_info,
        search_knowledge_base,
    ])
    logger.info("[script_writer_agent] built agent_id=%s tools=%d", AGENT_ID, len(agent.tools))
    return agent


def get_script_writer_agent(api_key: str):
    """返回 executor (保持向后兼容)"""
    logger.info("[script_writer_agent] get_script_writer_agent() → executor")
    return _build_agent().get_executor(api_key)


def get_script_writer_base_agent(api_key: str = "") -> BaseAgent:
    """返回 BaseAgent 实例 (供注册表和 Orchestrator 使用)"""
    logger.debug("[script_writer_agent] get_script_writer_base_agent() called")
    return _build_agent()
