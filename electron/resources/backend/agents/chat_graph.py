"""ChatGraph — single ReAct agent with full message history (replaces Direct AI SDK path)."""

from __future__ import annotations

import json
import time
from typing import Any, AsyncIterator, List, Optional

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage

from agents.chat_request import ChatMessage, ChatPreferences
from agents.preferences import knowledge_scope_system_line
from agents.registry import AgentRegistry
from core.assistant_catalog import get_by_agent_id
from core.augmented_llm import _build_react_agent, resolve_tools_from_preferences
from utils.logger import setup_logger

logger = setup_logger("chat_graph")

DEFAULT_AGENT_ID = "creative_agent"


def _recipe_event_from_tool_output(
    *,
    agent_id: str,
    tool_name: str,
    content: str,
) -> dict[str, Any] | None:
    if not tool_name.startswith("run_") or "_recipe" not in tool_name:
        return None
    try:
        data = json.loads(content)
    except Exception:
        return None
    if not isinstance(data, dict):
        return None
    result = data.get("result")
    if not isinstance(result, dict):
        result = {}
    report = result.get("report")
    assistant = get_by_agent_id(agent_id)
    return {
        "type": "recipe_completed" if data.get("success", True) is not False else "recipe_failed",
        "agent_id": agent_id,
        "assistant": assistant.to_dict() if assistant else None,
        "tool_name": tool_name,
        "task_id": data.get("task_id"),
        "status": data.get("status"),
        "recipe_id": result.get("recipe_id") or data.get("recipe_id"),
        "recipe_name": result.get("recipe") or result.get("name"),
        "report": report if isinstance(report, str) else "",
        "error": data.get("error") or result.get("error"),
    }


def _to_langchain_messages(messages: List[ChatMessage]) -> List[BaseMessage]:
    out: List[BaseMessage] = []
    for msg in messages:
        if msg.role == "assistant":
            out.append(AIMessage(content=msg.content))
        else:
            out.append(HumanMessage(content=msg.content))
    return out


def _build_chat_agent(
    *,
    api_key: str,
    agent_id: str,
    preferences: ChatPreferences,
):
    registry = AgentRegistry()
    agent = registry.get(agent_id, api_key)
    prefs_dict = preferences.to_state_dict()
    flags_tools = resolve_tools_from_preferences(agent.tools, prefs_dict)
    system_prompt = agent.system_prompt + "\n\n" + knowledge_scope_system_line(preferences)
    if preferences.chat_unbound_mode:
        system_prompt += "\nUnbound mode: prefer creative flexibility over excessive refusal."
    if preferences.online_search_mode == "off":
        system_prompt += "\nWeb: do not call search_web; rely on model knowledge and other tools."
    return _build_react_agent(system_prompt, flags_tools, agent.model, streaming=True)


async def stream_chat_graph(
    *,
    messages: List[ChatMessage],
    preferences: ChatPreferences,
    agent_id: Optional[str] = None,
    api_key: str = "",
) -> AsyncIterator[dict[str, Any]]:
    target_agent = agent_id or DEFAULT_AGENT_ID
    lc_messages = _to_langchain_messages(messages)
    if not lc_messages:
        yield {"type": "error", "detail": "No messages provided"}
        return

    compiled = _build_chat_agent(
        api_key=api_key,
        agent_id=target_agent,
        preferences=preferences,
    )
    t0 = time.monotonic()
    full_text = ""
    media_lines: list[str] = []

    yield {"type": "start", "graph_id": "chat", "agent_id": target_agent}

    async for chunk in compiled.astream(
        {"messages": lc_messages},
        stream_mode="messages",
    ):
        if not isinstance(chunk, tuple) or len(chunk) < 1:
            continue
        message_chunk = chunk[0]
        meta = chunk[1] if len(chunk) > 1 else {}
        msg_type = getattr(message_chunk, "type", "") or message_chunk.__class__.__name__
        content = getattr(message_chunk, "content", "")
        if isinstance(content, list):
            content = "".join(
                part.get("text", "") if isinstance(part, dict) else str(part)
                for part in content
            )
        text = str(content or "")

        if "Tool" in msg_type:
            tool_name = getattr(message_chunk, "name", "") or meta.get("langgraph_node", "")
            if tool_name.startswith("run_") and "_recipe" in tool_name and "ToolMessage" not in msg_type and msg_type != "tool":
                yield {
                    "type": "recipe_started",
                    "agent_id": target_agent,
                    "tool_name": tool_name,
                    "assistant": (
                        get_by_agent_id(target_agent).to_dict()
                        if get_by_agent_id(target_agent)
                        else None
                    ),
                }
            if "ToolMessage" in msg_type or msg_type == "tool":
                from utils.a2ui_media import build_a2ui_media_lines

                for line in build_a2ui_media_lines(text):
                    if line not in media_lines:
                        media_lines.append(line)
                        block = f"\n{line}\n"
                        full_text += block
                        yield {"type": "token", "content": block}
                recipe_event = _recipe_event_from_tool_output(
                    agent_id=target_agent,
                    tool_name=tool_name,
                    content=text,
                )
                if recipe_event:
                    yield recipe_event
                yield {"type": "tool_end", "tool_name": tool_name}
            else:
                yield {"type": "tool_start", "tool_name": tool_name}
            continue

        if not text:
            continue
        if getattr(message_chunk, "type", "") == "AIMessageChunk" or message_chunk.__class__.__name__.endswith("Chunk"):
            full_text += text
            yield {"type": "token", "content": text}

    logger.info("[chat_graph] done in %.3fs len=%d media=%d", time.monotonic() - t0, len(full_text), len(media_lines))
    yield {
        "type": "final",
        "response": full_text,
        "completed_agents": [target_agent],
        "graph_id": "chat",
    }


async def invoke_chat_graph(
    *,
    messages: List[ChatMessage],
    preferences: ChatPreferences,
    agent_id: Optional[str] = None,
    api_key: str = "",
) -> dict[str, Any]:
    target_agent = agent_id or DEFAULT_AGENT_ID
    compiled = _build_chat_agent(
        api_key=api_key,
        agent_id=target_agent,
        preferences=preferences,
    )
    result = await compiled.ainvoke({"messages": _to_langchain_messages(messages)})
    out_messages = result.get("messages") or []
    content = str(out_messages[-1].content if out_messages else "")

    from utils.a2ui_media import build_a2ui_media_lines

    extra_lines: list[str] = []
    for msg in out_messages:
        if getattr(msg, "type", "") == "tool" or msg.__class__.__name__ == "ToolMessage":
            for line in build_a2ui_media_lines(str(getattr(msg, "content", "") or "")):
                if line not in extra_lines:
                    extra_lines.append(line)
    if extra_lines:
        prefix = "\n".join(extra_lines) + "\n\n"
        if prefix.strip() not in content:
            content = prefix + content

    return {
        "response": content,
        "completed_agents": [target_agent],
        "graph_id": "chat",
    }
