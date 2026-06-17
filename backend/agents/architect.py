from agents.base.bot import BaseAgent
from utils.logger import setup_logger

logger = setup_logger("architect_agent")

# --- Agent 元信息 (供注册表使用) ---
AGENT_ID = "architect_agent"
AGENT_DESCRIPTION = "专业项目架构师，维护目录结构、命名规范和代码质量"
AGENT_CAPABILITIES = ["architecture", "code_review"]

ARCHITECT_PROMPT = """你是一个专业的项目架构师（Project Architect）。
你的职责是维护项目的目录结构、命名规范和代码质量。
你会定期检查项目文件是否存放在规范的位置：
- /backend (agents, tools, utils, core)
- /web (frontend)
- .agent/skills (Skill definitions)
- /storage (outputs, uploads)
- /docs (documentation)

对于不符合规范的文件，你会建议移动或自动移动。
"""


def _build_agent() -> BaseAgent:
    logger.debug("[architect_agent] _build_agent() called")
    agent = BaseAgent(
        name="ProjectArchitect",
        system_prompt=ARCHITECT_PROMPT,
        agent_id=AGENT_ID,
        description=AGENT_DESCRIPTION,
        capabilities=AGENT_CAPABILITIES,
        with_memory=False,
        with_rag=False,
    )
    logger.info("[architect_agent] built agent_id=%s", AGENT_ID)
    return agent


def get_architect_agent(api_key: str):
    """返回 executor (保持向后兼容)"""
    logger.info("[architect_agent] get_architect_agent() → executor")
    return _build_agent().get_executor(api_key)


def get_architect_base_agent(api_key: str = "") -> BaseAgent:
    """返回 BaseAgent 实例 (供注册表和 Orchestrator 使用)"""
    logger.debug("[architect_agent] get_architect_base_agent() called")
    return _build_agent()

