from typing import Any, Dict, List, Optional

from core.augmented_llm import build_augmented_executor, build_augmented_node


class BaseAgent:
    """
    Base class for all agents.
    Provides a standardized way to initialize agents with skills,
    and supports multi-agent collaboration via registry & orchestrator.
    """

    def __init__(
        self,
        name: str,
        system_prompt: str,
        model: str = "glm-4-plus",
        agent_id: str = "",
        description: str = "",
        capabilities: Optional[List[str]] = None,
        with_memory: bool = False,
        with_rag: bool = False,
        with_history: bool = False,
    ):
        self.name = name
        self.system_prompt = system_prompt
        self.model = model
        self.tools: List[Any] = []
        self.with_memory = with_memory
        self.with_rag = with_rag
        self.with_history = with_history

        # --- 协作属性 ---
        self.agent_id = agent_id or name.lower().replace(" ", "_")
        self.description = description or system_prompt[:80]
        self.capabilities: List[str] = capabilities or []

    def add_skill(self, skill: Any):
        # Support both new Skill objects and direct tool lists
        if hasattr(skill, 'get_tools'):
            self.tools.extend(skill.get_tools())
        else:
            self.tools.extend(skill)

    # ------------------------------------------------------------------
    # Backward-compatible executor (单独使用, 保持现有端点正常)
    # ------------------------------------------------------------------
    def get_executor(self, api_key: str):
        return build_augmented_executor(
            system_prompt=self.system_prompt,
            extra_tools=self.tools,
            model=self.model,
            with_memory=self.with_memory,
            with_rag=self.with_rag,
            with_history=self.with_history,
        )

    # ------------------------------------------------------------------
    # LangGraph node 接口 (供 Orchestrator StateGraph 使用)
    # ------------------------------------------------------------------
    def as_node(self):
        """
        返回一个可直接作为 LangGraph StateGraph node 的函数。

        node 签名: (state: MultiAgentState) -> dict
        从 state["messages"] 获取任务，执行后返回 AgentMessage。
        """
        return build_augmented_node(
            agent_id=self.agent_id,
            system_prompt=self.system_prompt,
            extra_tools=self.tools,
            model=self.model,
            with_memory=self.with_memory,
            with_rag=self.with_rag,
            with_history=self.with_history,
        )

    def info(self) -> Dict[str, Any]:
        """返回 Agent 的摘要信息 (供 API / 路由器使用)"""
        return {
            "agent_id": self.agent_id,
            "name": self.name,
            "description": self.description,
            "capabilities": self.capabilities,
        }
