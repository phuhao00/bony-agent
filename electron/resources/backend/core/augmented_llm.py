from __future__ import annotations

import asyncio
import time
from typing import Any, Iterable, List, Optional

from langchain_core.runnables import RunnableLambda
from langgraph.prebuilt import create_react_agent

from agents.base.message import AgentMessage
from agents.knowledge_scope import parse_knowledge_scope
from agents.preferences import preferences_to_augment_flags
from core.llm_provider import get_api_key, get_chat_llm
from tools._envelope import safe_tool
from tools.memory_tools import save_memory, search_memory
from tools.rag_tools import search_knowledge_base
from tools.session_search_tools import search_past_sessions
from tools.skill_tools import skill_index_prompt_block, skill_view, skills_list
from utils.logger import setup_logger

logger = setup_logger("augmented_llm")


def _tool_name(tool: Any) -> str:
    return getattr(tool, "name", getattr(tool, "__name__", str(tool)))


def _dedupe_tools(tools: Iterable[Any]) -> List[Any]:
    unique_tools: List[Any] = []
    seen = set()
    for tool in tools:
        name = _tool_name(tool)
        if name in seen:
            continue
        seen.add(name)
        unique_tools.append(tool)
    return unique_tools


def augment_system_prompt(system_prompt: str, *, with_skills: bool = True) -> str:
    """Append compact skill index block (Hermes progressive disclosure)."""
    if not with_skills:
        return system_prompt
    block = skill_index_prompt_block()
    if not block:
        return system_prompt
    return f"{system_prompt.rstrip()}\n\n{block}\n"


def resolve_augmented_tools(
    extra_tools: Optional[Iterable[Any]] = None,
    *,
    with_memory: bool = True,
    with_rag: bool = True,
    with_history: bool = True,
    with_web: bool = True,
    with_skills: bool = True,
    knowledge_scope: Optional[dict[str, str]] = None,
) -> List[Any]:
    tools = list(extra_tools or [])

    if with_skills:
        tools.extend([skills_list, skill_view])

    if with_memory:
        tools.extend([search_memory, save_memory, search_past_sessions])
    if with_rag:
        scope = knowledge_scope or {}
        if scope.get("category") or scope.get("doc_id"):
            from langchain.tools import tool

            @tool
            def search_knowledge_base_scoped(query: str) -> str:
                """Search private knowledge base within the user's selected scope."""
                return search_knowledge_base.invoke(
                    {
                        "query": query,
                        "category": scope.get("category"),
                        "doc_id": scope.get("doc_id"),
                    }
                )

            tools.append(search_knowledge_base_scoped)
        else:
            tools.append(search_knowledge_base)

    if with_web:
        try:
            from tools.web_search_tools import search_web

            tools.append(search_web)
        except Exception:
            pass

    if with_history:
        logger.debug("with_history enabled, but history injection is not wired yet")

    return [safe_tool(tool) for tool in _dedupe_tools(tools)]


def resolve_tools_from_preferences(
    extra_tools: Optional[Iterable[Any]] = None,
    preferences: Optional[dict] = None,
) -> List[Any]:
    from agents.chat_request import ChatPreferences

    prefs = ChatPreferences(**preferences) if preferences else ChatPreferences()
    flags = preferences_to_augment_flags(prefs)
    return resolve_augmented_tools(
        extra_tools,
        with_memory=flags["with_memory"],
        with_rag=flags["with_rag"],
        with_web=flags["with_web"],
        knowledge_scope=flags.get("knowledge_scope"),
    )


def _build_react_agent(system_prompt: str, tools: List[Any], model: Optional[str], *, streaming: bool):
    current_api_key = get_api_key()
    target_model = model if model and model != "glm-4-plus" else None
    tool_names = [_tool_name(t) for t in tools]
    logger.info(
        "[build_react_agent] model=%s streaming=%s tools=%s",
        target_model or "<provider_default>",
        streaming,
        tool_names,
    )
    t0 = time.monotonic()
    llm = get_chat_llm(
        temperature=0.7,
        streaming=streaming,
        api_key=current_api_key,
        model=target_model,
    )
    agent = create_react_agent(llm, tools, prompt=system_prompt)
    logger.debug(
        "[build_react_agent] compiled in %.3fs | prompt_len=%d chars",
        time.monotonic() - t0,
        len(system_prompt),
    )
    return agent


def build_augmented_executor(
    *,
    system_prompt: str,
    extra_tools: Optional[Iterable[Any]] = None,
    model: Optional[str] = None,
    with_memory: bool = True,
    with_rag: bool = True,
    with_history: bool = True,
    with_skills: bool = True,
) -> RunnableLambda:
    tools = resolve_augmented_tools(
        extra_tools,
        with_memory=with_memory,
        with_rag=with_rag,
        with_history=with_history,
        with_skills=with_skills,
    )
    prompt = augment_system_prompt(system_prompt, with_skills=with_skills)

    async def run_augmented_agent(input_state):
        msgs = input_state.get("messages", []) if isinstance(input_state, dict) else []
        logger.info("[executor] invoking | msg_count=%d", len(msgs))
        t0 = time.monotonic()
        agent = _build_react_agent(prompt, tools, model, streaming=True)
        result = await asyncio.wait_for(agent.ainvoke(input_state), timeout=75.0)
        elapsed = time.monotonic() - t0
        out_msgs = result.get("messages", []) if isinstance(result, dict) else []
        last_content = str(getattr(out_msgs[-1], "content", "")) if out_msgs else ""
        logger.info(
            "[executor] done in %.3fs | response_len=%d chars | preview=%.80r",
            elapsed, len(last_content), last_content,
        )
        return result

    return RunnableLambda(run_augmented_agent)


def build_preferences_augmented_node(
    *,
    agent_id: str,
    system_prompt: str,
    extra_tools: Optional[Iterable[Any]] = None,
    model: Optional[str] = None,
    with_memory: bool = True,
    with_rag: bool = True,
    with_history: bool = True,
):
    """Worker node that resolves tools from state['preferences'] (cached per prefs key)."""
    import json

    compiled_cache: dict[str, Any] = {}

    def _cache_key(prefs: dict) -> str:
        return json.dumps(prefs or {}, sort_keys=True, default=str)

    def _get_compiled(prefs: dict):
        key = _cache_key(prefs)
        if key not in compiled_cache:
            tools = resolve_tools_from_preferences(extra_tools, prefs or None)
            compiled_cache[key] = _build_react_agent(system_prompt, tools, model, streaming=False)
        return compiled_cache[key]

    # Warm default preferences at graph build time
    _get_compiled({})

    async def _node_fn(state: dict) -> dict:
        messages = state.get("messages", [])
        prefs = state.get("preferences") or {}
        compiled_agent = _get_compiled(prefs)
        logger.info(
            "[node:%s] ▶ start | msg_count=%d | prefs_keys=%s",
            agent_id,
            len(messages),
            list(prefs.keys()),
        )
        t0 = time.monotonic()
        result = await asyncio.wait_for(
            compiled_agent.ainvoke({"messages": messages}),
            timeout=75.0,
        )
        elapsed = time.monotonic() - t0
        response_content = result["messages"][-1].content if result.get("messages") else ""
        logger.info(
            "[node:%s] ✔ done in %.3fs | response_len=%d",
            agent_id,
            elapsed,
            len(str(response_content)),
        )
        msg = AgentMessage(sender=agent_id, content=response_content)
        return {
            "messages": [msg.to_langchain_message()],
            "completed_agents": [agent_id],
        }

    return _node_fn


def build_augmented_node(
    *,
    agent_id: str,
    system_prompt: str,
    extra_tools: Optional[Iterable[Any]] = None,
    model: Optional[str] = None,
    with_memory: bool = True,
    with_rag: bool = True,
    with_history: bool = True,
    with_skills: bool = True,
):
    tools = resolve_augmented_tools(
        extra_tools,
        with_memory=with_memory,
        with_rag=with_rag,
        with_history=with_history,
        with_skills=with_skills,
    )
    prompt = augment_system_prompt(system_prompt, with_skills=with_skills)
    # Pre-compile once so each invocation reuses the same compiled ReAct graph
    t_compile = time.monotonic()
    compiled_agent = _build_react_agent(prompt, tools, model, streaming=False)
    logger.info(
        "[node:%s] pre-compiled in %.3fs | tools=%s",
        agent_id,
        time.monotonic() - t_compile,
        [_tool_name(t) for t in tools],
    )

    async def _node_fn(state: dict) -> dict:
        messages = state.get("messages", [])
        logger.info(
            "[node:%s] ▶ start | msg_count=%d | last_human=%.60r",
            agent_id,
            len(messages),
            str(getattr(messages[-1], "content", ""))[:60] if messages else "",
        )
        t0 = time.monotonic()
        result = await asyncio.wait_for(
            compiled_agent.ainvoke({"messages": messages}),
            timeout=75.0,
        )
        elapsed = time.monotonic() - t0
        response_content = result["messages"][-1].content if result.get("messages") else ""
        logger.info(
            "[node:%s] ✔ done in %.3fs | response_len=%d chars | preview=%.80r",
            agent_id,
            elapsed,
            len(response_content),
            response_content[:80],
        )
        msg = AgentMessage(sender=agent_id, content=response_content)
        return {
            "messages": [msg.to_langchain_message()],
            "completed_agents": [agent_id],
        }

    return _node_fn
