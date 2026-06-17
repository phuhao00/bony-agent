"""Unified chat / multi-agent request models (LangGraph entry)."""

from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


GraphHint = Literal["auto", "orchestrator", "planning", "lobster", "chat", "claude_code"]
ChatMode = Literal["multi"]


class ChatMessage(BaseModel):
    role: str
    content: str


class WorkspaceContext(BaseModel):
    root: Optional[str] = None
    attached_files: list[str] = Field(default_factory=list)
    attachments: list[dict[str, Any]] = Field(default_factory=list)
    branch: Optional[str] = None
    source_message_id: Optional[str] = None
    trace_id: Optional[str] = None

    @classmethod
    def from_raw(cls, raw: Optional[dict]) -> "WorkspaceContext":
        if not raw or not isinstance(raw, dict):
            return cls()
        attached = raw.get("attached_files") or raw.get("attachedFiles") or []
        if not isinstance(attached, list):
            attached = []
        attachments = raw.get("attachments") or []
        if not isinstance(attachments, list):
            attachments = []
        return cls(
            root=str(raw.get("root") or "").strip() or None,
            attached_files=[str(p).strip() for p in attached if str(p).strip()],
            attachments=[a for a in attachments if isinstance(a, dict)],
            branch=str(raw.get("branch") or "").strip() or None,
            source_message_id=str(raw.get("source_message_id") or raw.get("sourceMessageId") or "").strip() or None,
            trace_id=str(raw.get("trace_id") or raw.get("traceId") or "").strip() or None,
        )

    def to_state_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {}
        if self.root:
            out["root"] = self.root
        if self.attached_files:
            out["attached_files"] = self.attached_files
        if self.attachments:
            out["attachments"] = self.attachments
        if self.branch:
            out["branch"] = self.branch
        if self.source_message_id:
            out["source_message_id"] = self.source_message_id
        if self.trace_id:
            out["trace_id"] = self.trace_id
        return out


class ChatPreferences(BaseModel):
    online_search_mode: str = "smart"
    chat_knowledge_mode: str = "smart"
    chat_knowledge_scope: str = "all"
    chat_memory_recall: bool = True
    chat_unbound_mode: bool = False
    chat_memory_enabled: bool = True

    @classmethod
    def from_camel(cls, raw: Optional[dict]) -> "ChatPreferences":
        if not raw:
            return cls()
        return cls(
            online_search_mode=str(raw.get("onlineSearchMode") or raw.get("online_search_mode") or "smart"),
            chat_knowledge_mode=str(raw.get("chatKnowledgeMode") or raw.get("chat_knowledge_mode") or "smart"),
            chat_knowledge_scope=str(raw.get("chatKnowledgeScope") or raw.get("chat_knowledge_scope") or "all"),
            chat_memory_recall=bool(
                raw.get("chatMemoryRecall", raw.get("chat_memory_recall", True))
            ),
            chat_unbound_mode=bool(raw.get("unboundMode", raw.get("chat_unbound_mode", False))),
            chat_memory_enabled=bool(
                raw.get("chatMemoryEnabled", raw.get("chat_memory_enabled", True))
            ),
        )

    def to_state_dict(self) -> dict[str, Any]:
        return self.model_dump()


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(default_factory=list)
    input: Optional[str] = None
    preferences: ChatPreferences = Field(default_factory=ChatPreferences)
    workspace_context: WorkspaceContext = Field(default_factory=WorkspaceContext)
    agent_id: Optional[str] = None
    graph_hint: GraphHint = "auto"
    mode: ChatMode = "multi"
    thread_id: Optional[str] = None
    stream: bool = True

    def resolved_input(self) -> str:
        if self.input and self.input.strip():
            return self.input.strip()
        for msg in reversed(self.messages):
            if msg.role == "user" and msg.content.strip():
                return msg.content.strip()
        return ""

    @classmethod
    def from_legacy_multi(cls, raw: dict) -> "ChatRequest":
        return cls(
            input=str(raw.get("input") or ""),
            agent_id=raw.get("agent_id"),
            mode="multi",
            preferences=ChatPreferences.from_camel(raw.get("preferences")),
            thread_id=raw.get("thread_id"),
        )

    @classmethod
    def from_legacy_direct(cls, raw: dict) -> "ChatRequest":
        messages = [
            ChatMessage(role=str(m.get("role") or "user"), content=str(m.get("content") or ""))
            for m in (raw.get("messages") or [])
        ]
        return cls(
            messages=messages,
            mode="multi",
            preferences=ChatPreferences.from_camel(raw.get("preferences")),
            thread_id=raw.get("thread_id"),
        )
