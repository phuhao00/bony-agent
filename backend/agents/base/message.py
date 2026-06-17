"""
Agent 间通信消息协议 (Inter-Agent Message Protocol)

定义 Agent 之间传递信息的统一格式，确保不同 Agent 能够
理解彼此的输出并进行协作。
"""

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional
from datetime import datetime
from langchain_core.messages import HumanMessage, AIMessage


@dataclass
class AgentMessage:
    """Agent 间通信的标准消息格式"""

    sender: str                          # 发送者 Agent ID (如 "media_agent")
    content: str                         # 消息正文
    artifacts: List[str] = field(default_factory=list)   # 关联产出物 (URL/路径)
    metadata: Dict[str, Any] = field(default_factory=dict)  # 扩展信息
    timestamp: str = field(default_factory=lambda: datetime.now().isoformat())

    def to_langchain_message(self) -> AIMessage:
        """转换为 LangChain AIMessage，附带 artifact 信息"""
        parts = [self.content]
        if self.artifacts:
            parts.append("\n📎 Artifacts: " + ", ".join(self.artifacts))
        return AIMessage(
            content="\n".join(parts),
            additional_kwargs={
                "sender": self.sender,
                "artifacts": self.artifacts,
                "metadata": self.metadata,
            },
        )

    def to_dict(self) -> dict:
        return {
            "sender": self.sender,
            "content": self.content,
            "artifacts": self.artifacts,
            "metadata": self.metadata,
            "timestamp": self.timestamp,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "AgentMessage":
        return cls(
            sender=data["sender"],
            content=data["content"],
            artifacts=data.get("artifacts", []),
            metadata=data.get("metadata", {}),
            timestamp=data.get("timestamp", datetime.now().isoformat()),
        )
