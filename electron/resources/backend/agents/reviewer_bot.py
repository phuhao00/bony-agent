from tools.moderation_tools import check_content, fix_content
from tools.trend_tools import analyze_trends, generate_hashtags
from utils.logger import setup_logger

# 初始化日志记录器
logger = setup_logger("reviewer_bot")

# --- Agent 元信息 (供注册表使用) ---
AGENT_ID = "reviewer_agent"
AGENT_DESCRIPTION = "资深内容主编，负责内容审查、合规检测、趋势洞察与文案润色"
AGENT_CAPABILITIES = ["review", "moderation", "optimization", "trends"]

REVIEWER_SYSTEM_PROMPT = """你是一位资深的社交媒体内容主编和创意总监（Reviewer Agent）。

你的职责是审查、优化和提升内容质量。你不仅要检查错误，更要提供提升点击率和互动率的专业建议。

## 你的能力
1. **内容审查**：使用 `check_content` 检查是否合规。
2. **趋势洞察**：使用 `analyze_trends` 了解当前热点，判断内容是否过时。
3. **标签优化**：使用 `generate_hashtags` 建议最佳流量标签。
4. **内容润色**：使用 `fix_content` 或自身的创作能力修改文案。

## 工作流程
当用户发来一段内容（文案或脚本）时：
1. 首先评估其吸引力、逻辑和情感价值。
2. 检查合规性。
3. 结合当前趋势给出修改建议。
4. 如果用户要求，直接进行修改和润色。

请保持专业、犀利但建设性的态度。你的目标是打造爆款内容。
"""

def get_reviewer_executor(api_key: str):
    """返回 executor (保持向后兼容)。"""
    logger.info("Initializing Reviewer Agent executor via BaseAgent")
    return get_reviewer_base_agent(api_key).get_executor(api_key)


def get_reviewer_base_agent(api_key: str = ""):
    """返回 BaseAgent 实例 (供注册表和 Orchestrator 使用)"""
    logger.info("[reviewer_bot] get_reviewer_base_agent() called")
    from agents.base.bot import BaseAgent

    agent = BaseAgent(
        name="ReviewerAgent",
        system_prompt=REVIEWER_SYSTEM_PROMPT,
        agent_id=AGENT_ID,
        description=AGENT_DESCRIPTION,
        capabilities=AGENT_CAPABILITIES,
        with_memory=False,
        with_rag=False,
    )
    agent.tools.extend([check_content, fix_content, analyze_trends, generate_hashtags])
    logger.info("[reviewer_bot] built agent_id=%s tools=%d", AGENT_ID, len(agent.tools))
    return agent

