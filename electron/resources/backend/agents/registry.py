"""
Agent 注册表 (Agent Registry)

全局单例注册表，管理所有可用 Agent 的注册、查询和生命周期。
Orchestrator 和 Router 通过此注册表获取 Agent 信息。
"""

import threading
from typing import Any, Callable, Dict, List, Optional
from utils.logger import setup_logger

logger = setup_logger("agent_registry")


class _AgentEntry:
    """注册表中的一条 Agent 记录"""

    __slots__ = ("agent_id", "factory", "description", "capabilities", "_instance", "_lock")

    def __init__(
        self,
        agent_id: str,
        factory: Callable,
        description: str,
        capabilities: List[str],
    ):
        self.agent_id = agent_id
        self.factory = factory  # callable(api_key) -> BaseAgent instance
        self.description = description
        self.capabilities = capabilities
        self._instance = None  # lazy singleton per entry
        self._lock = threading.RLock()

    def get_instance(self, api_key: str = ""):
        """延迟实例化 Agent (单例缓存)"""
        with self._lock:
            if self._instance is None:
                logger.debug("[registry] instantiating agent_id=%s (first time)", self.agent_id)
                self._instance = self.factory(api_key)
                logger.debug("[registry] agent_id=%s instantiated", self.agent_id)
            else:
                logger.debug("[registry] agent_id=%s returned from cache", self.agent_id)
            return self._instance

    def info(self) -> dict:
        return {
            "agent_id": self.agent_id,
            "description": self.description,
            "capabilities": self.capabilities,
        }


class AgentRegistry:
    """
    全局 Agent 注册表 (Singleton)

    用法:
        registry = AgentRegistry()
        registry.register("media_agent", factory_fn, "媒体创作", ["image", "video"])
        agent = registry.get("media_agent")
    """

    _instance: Optional["AgentRegistry"] = None
    _instance_lock = threading.RLock()

    def __new__(cls):
        with cls._instance_lock:
            if cls._instance is None:
                cls._instance = super().__new__(cls)
                cls._instance._entries: Dict[str, _AgentEntry] = {}
                cls._instance._lock = threading.RLock()
        return cls._instance

    # ------------------------------------------------------------------
    # 注册
    # ------------------------------------------------------------------
    def register(
        self,
        agent_id: str,
        factory: Callable,
        description: str = "",
        capabilities: Optional[List[str]] = None,
    ):
        """注册一个 Agent 工厂函数"""
        with self._lock:
            if agent_id in self._entries:
                logger.warning(f"Agent '{agent_id}' already registered, overwriting.")
            self._entries[agent_id] = _AgentEntry(
                agent_id=agent_id,
                factory=factory,
                description=description,
                capabilities=capabilities or [],
            )
        logger.info(
            f"✅ Registered agent '{agent_id}' "
            f"(caps={capabilities or []})"
        )

    # ------------------------------------------------------------------
    # 查询
    # ------------------------------------------------------------------
    def get(self, agent_id: str, api_key: str = "") -> Any:
        """获取已注册 Agent 的实例"""
        with self._lock:
            entry = self._entries.get(agent_id)
        if entry is None:
            logger.error("[registry] agent '%s' not found. registered=%s", agent_id, list(self._entries.keys()))
            raise KeyError(f"Agent '{agent_id}' not found in registry.")
        logger.debug("[registry] get('%s') called", agent_id)
        return entry.get_instance(api_key)

    def get_entry(self, agent_id: str) -> Optional[_AgentEntry]:
        with self._lock:
            return self._entries.get(agent_id)

    def list_all(self) -> List[dict]:
        """列出所有已注册 Agent 的摘要"""
        with self._lock:
            result = [e.info() for e in self._entries.values()]
        logger.debug("[registry] list_all() returned %d agents", len(result))
        return result

    def get_by_capability(self, capability: str) -> List[str]:
        """按能力标签检索 Agent ID"""
        with self._lock:
            result = [
                e.agent_id
                for e in self._entries.values()
                if capability in e.capabilities
            ]
        logger.debug("[registry] get_by_capability('%s') → %s", capability, result)
        return result

    def has(self, agent_id: str) -> bool:
        with self._lock:
            return agent_id in self._entries

    @property
    def agent_ids(self) -> List[str]:
        with self._lock:
            return list(self._entries.keys())

    def reset(self):
        """清空注册表 (仅用于测试)"""
        with self._lock:
            logger.warning("[registry] reset() called — clearing %d entries", len(self._entries))
            self._entries.clear()

    def invalidate(self, agent_id: str) -> None:
        """Drop cached singleton for one agent (e.g. after MCP tools change)."""
        with self._lock:
            entry = self._entries.get(agent_id)
            if entry is not None:
                entry._instance = None
                logger.info("[registry] invalidated agent_id=%s", agent_id)

    def invalidate_all(self) -> None:
        """Drop all cached agent singletons."""
        with self._lock:
            for entry in self._entries.values():
                entry._instance = None
            logger.info("[registry] invalidated all agents (%d)", len(self._entries))
