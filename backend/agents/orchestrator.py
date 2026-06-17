"""
Supervisor 编排器 (Multi-Agent Orchestrator)

基于 LangGraph StateGraph 的中央编排器，使用 Supervisor 模式
驱动多个 Agent 协作完成复杂任务。

流程:
    用户请求 → supervisor_node (路由) → agent_node (执行) → supervisor_node (判断) → ... → END
"""

import asyncio
import json
import operator
import time
from typing import Annotated, Any, AsyncIterator, Dict, List, Optional
from typing_extensions import TypedDict

from langchain_core.messages import BaseMessage, HumanMessage, AIMessage
from langgraph.graph import StateGraph, END
from langgraph.types import Command

from agents.registry import AgentRegistry
from agents.router import IntentRouter, RouteResult
from agents.search_intent import looks_like_mandatory_web_lookup
from agents.base.message import AgentMessage
from utils.logger import setup_logger
from core.llm_provider import get_current_model, get_provider_id
from core.augmented_llm import build_preferences_augmented_node

logger = setup_logger("orchestrator")

# Module-level graph cache keyed by api_key + 当前 Provider/模型（与调度器等临时 env 覆盖一致）
_GRAPH_CACHE: Dict[str, Any] = {}

# Agents that expose search_web (orchestrator pre-flight injection)
_WEB_SEARCH_CAPABLE_AGENTS = frozenset({"creative_agent", "media_agent", "trend_analyst_agent"})


def clear_graph_cache() -> None:
    """Clear compiled multi-agent graph cache (e.g. after MCP or provider change)."""
    _GRAPH_CACHE.clear()
    logger.info("[graph_cache] cleared")


# ------------------------------------------------------------------
# 1. 共享状态定义
# ------------------------------------------------------------------
class MultiAgentState(TypedDict, total=False):
    """多Agent协作的共享状态"""
    messages: Annotated[List[BaseMessage], operator.add]
    next_agent: str
    completed_agents: Annotated[List[str], operator.add]
    final_response: str
    preferences: dict
    knowledge_scope: dict
    workspace_context: dict
    thread_id: str
    media_url: str
    use_publish_pipeline: bool


def _extract_user_text(messages: List[BaseMessage]) -> str:
    for msg in messages:
        if isinstance(msg, HumanMessage):
            return str(msg.content)
    return ""


def _extract_last_agent_content(messages: List[BaseMessage]) -> str:
    for msg in reversed(messages):
        if isinstance(msg, AIMessage):
            return str(msg.content)
    return messages[-1].content if messages else ""


def _aggregate_completed_outputs(messages: List[BaseMessage], completed: List[str]) -> str:
    aggregated_parts = []
    for msg in messages:
        if isinstance(msg, AIMessage):
            sender = msg.additional_kwargs.get("sender", "")
            if sender and sender in completed:
                aggregated_parts.append(str(msg.content))
    return "\n\n---\n\n".join(aggregated_parts)


def _safe_load_decision(content: str) -> Optional[dict]:
    text = (content or "").strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[-1]
    if text.endswith("```"):
        text = text.rsplit("```", 1)[0]
    try:
        payload = json.loads(text.strip())
    except Exception:
        return None
    return payload if isinstance(payload, dict) else None


def _build_reviewer_guidance(last_agent: str, last_content: str) -> HumanMessage:
    has_media = "storage/outputs/" in last_content or "/media/" in last_content
    if has_media:
        return HumanMessage(content=(
            "上面的Agent刚生成了一个媒体作品。请你作为内容运营专家，为这个作品补充：\n"
            "1. 适合各平台的推荐标题（小红书/抖音/B站各一个）\n"
            "2. 推荐标签（hashtags）\n"
            "3. 最佳发布时间建议\n"
            "请简洁输出，不要重复之前的内容。"
        ))
    if last_agent == "script_writer_agent":
        return HumanMessage(content=(
            "上面的Agent刚创作了一个视频脚本。请你审核并优化：\n"
            "1. 检查脚本结构是否完整（hook、body、cta）\n"
            "2. 优化台词的吸引力和节奏\n"
            "3. 推荐适合的拍摄手法\n"
            "4. 建议最佳发布平台和标签\n"
            "请简洁输出。"
        ))
    if last_agent == "copywriter_agent":
        return HumanMessage(content=(
            "上面的Agent刚创作了一段文案。请你审核并优化：\n"
            "1. 检查合规性和敏感词\n"
            "2. 优化文案的吸引力和转化力\n"
            "3. 生成更多标题变体\n"
            "4. 推荐标签和发布策略\n"
            "请简洁输出。"
        ))
    return HumanMessage(content=(
        "上面的Agent刚创作了一段内容。请你审核并优化：\n"
        "1. 检查合规性\n"
        "2. 优化内容吸引力\n"
        "3. 推荐标签和发布策略\n"
        "请简洁输出。"
    ))


def _build_copywriter_guidance() -> HumanMessage:
    return HumanMessage(content=(
        "热点分析师刚完成了趋势分析。请你根据这些热点信息，\n"
        "为选定的热点创作一篇高质量的种草文案或视频脚本大纲。\n"
        "考虑平台特性和用户心理，提供可直接使用的内容。"
    ))


def _fallback_supervisor_decision(
    completed: List[str],
    last_agent: str,
    last_content: str,
) -> dict:
    # Trend analysis → copywriter is a meaningful two-step chain; keep it.
    if last_agent == "trend_analyst_agent" and "copywriter_agent" not in completed:
        decision = {
            "next_agent": "copywriter_agent",
            "reason": "fallback_copywriter_after_trend_analysis",
            "done": False,
            "guidance": _build_copywriter_guidance().content,
        }
        logger.info("[fallback_supervisor] trend→copywriter | completed=%s", completed)
        return decision

    # All other cases: finish immediately without forcing auto-reviewer.
    logger.info("[fallback_supervisor] → FINISH | last_agent=%s completed=%s", last_agent, completed)
    return {
        "next_agent": "FINISH",
        "reason": "fallback_finish",
        "done": True,
        "guidance": "",
    }


async def _llm_supervisor_decision(
    *,
    available_agents: List[str],
    user_text: str,
    completed: List[str],
    last_agent: str,
    last_content: str,
) -> Optional[dict]:
    try:
        from core.llm_provider import get_chat_llm

        options = ", ".join(sorted(available_agents))
        prompt = f"""
你是一个多 Agent 编排器。你的任务是在当前步骤结束后决定：继续调用哪个 Agent，或者结束。

只输出 JSON 对象，不要 Markdown，不要解释。

字段要求：
- next_agent: 下一个 agent_id；如果结束则填 "FINISH"
- reason: 简短字符串，说明原因
- done: true/false
- guidance: 给下一个 Agent 的附加说明；如果 done=true 则返回空字符串

约束：
1. next_agent 必须是以下之一：{options}，或者 FINISH。
2. 不要重复选择已经明显完成同一工作的 Agent，除非确有必要。
3. 如果上一步是内容创作类 Agent，且还未审核，优先考虑 reviewer_agent。
4. 如果上一步是趋势分析，且还未成稿，优先考虑 copywriter_agent。
5. 如果任务已经可以直接返回给用户，done=true，next_agent=FINISH。

用户原始请求：{user_text}
已完成 Agent：{completed}
最近一个 Agent：{last_agent}
最近输出摘要：{last_content[:1800]}
""".strip()

        llm = get_chat_llm(temperature=0.0)
        response = await asyncio.wait_for(llm.ainvoke(prompt), timeout=15.0)
        content = getattr(response, "content", response)
        if isinstance(content, list):
            content = "\n".join(
                item.get("text", "") if isinstance(item, dict) else str(item)
                for item in content
            )
        payload = _safe_load_decision(str(content))
        if not payload:
            return None

        next_agent = str(payload.get("next_agent") or "").strip()
        reason = str(payload.get("reason") or "llm_supervisor").strip() or "llm_supervisor"
        done = bool(payload.get("done"))
        guidance = str(payload.get("guidance") or "").strip()

        if done:
            next_agent = "FINISH"
        if next_agent != "FINISH" and next_agent not in available_agents:
            return None

        return {
            "next_agent": next_agent or "FINISH",
            "reason": reason,
            "done": done or next_agent == "FINISH",
            "guidance": guidance,
        }
    except Exception as exc:
        logger.warning(f"LLM supervisor decision failed: {exc}")
        return None


# ------------------------------------------------------------------
# 2. Supervisor 节点
# ------------------------------------------------------------------
def _build_supervisor_node(router: IntentRouter, available_agents: List[str]):
    """
    构建 Supervisor 决策节点。

    逻辑:
      - 首次调用: 使用 Router 选择第一个 Agent
      - 后续调用: 检查上一步 Agent 输出，决定是否需要追加 Agent 或结束
    """

    async def supervisor(state: MultiAgentState) -> dict:
        completed = state.get("completed_agents", [])
        messages = state.get("messages", [])
        user_text = _extract_user_text(messages)
        logger.info(
            "[supervisor] enter | completed=%s msg_count=%d user_text=%.60r",
            completed, len(messages), user_text[:60],
        )

        if not completed:
            if state.get("use_publish_pipeline"):
                logger.info("[supervisor] routing → publish_pipeline (deterministic)")
                return Command(goto="publish_pipeline", update={"next_agent": "publish_pipeline"})

            route_result = await router.route(user_text)
            logger.info(
                "[supervisor] first dispatch → %s (confidence=%.2f reason=%s)",
                route_result.agent_id, route_result.confidence, route_result.reason,
            )
            payload: dict = {"next_agent": route_result.agent_id}

            if (
                looks_like_mandatory_web_lookup(user_text)
                and route_result.agent_id in _WEB_SEARCH_CAPABLE_AGENTS
                and (state.get("preferences") or {}).get("online_search_mode", "smart") != "off"
            ):
                guidance = ""
                try:
                    from tools.web_search_tools import execute_web_search_sync

                    region = "cn-zh" if any("\u4e00" <= c <= "\u9fff" for c in user_text) else ""
                    search_text = await asyncio.to_thread(
                        execute_web_search_sync,
                        user_text,
                        10,
                        region,
                    )
                    guidance = (
                        "【联网检索结果 — 请据此回答用户，可补充调用 search_web 获取更多信息】\n\n"
                        f"{search_text}"
                    )
                    logger.info(
                        "[supervisor] pre-injected web search | agent=%s context_len=%d",
                        route_result.agent_id,
                        len(search_text),
                    )
                except Exception as exc:
                    logger.warning("[supervisor] pre-search failed: %s", exc)
                    guidance = (
                        "用户需要实时外部信息（如天气、新闻）。你必须先调用 search_web 工具，"
                        "禁止编造或让用户自行查询。"
                    )
                if guidance:
                    payload["messages"] = [HumanMessage(content=guidance)]

            return Command(goto=route_result.agent_id, update=payload)

        last_agent = completed[-1] if completed else ""
        last_content = _extract_last_agent_content(messages)
        logger.debug(
            "[supervisor] last_agent=%s last_content_len=%d preview=%.80r",
            last_agent, len(last_content), last_content[:80],
        )

        # Fast-finish: single-step agents that never need a follow-up
        _SINGLE_FINISH_AGENTS = {
            "media_agent", "video_editor_agent", "opencut_agent", "long_video_agent",
            "reviewer_agent", "architect_agent", "code_analyst_agent", "system_assistant",
            "programmer_agent", "creative_agent", "copywriter_agent",
            "script_writer_agent",
        }
        if len(completed) == 1 and last_agent in _SINGLE_FINISH_AGENTS:
            logger.info("⚡ Fast-finish after %s (skipped LLM supervisor)", last_agent)
            final = _aggregate_completed_outputs(messages, completed) or last_content
            return Command(
                goto=END,
                update={"next_agent": "FINISH", "final_response": final},
            )

        t0 = time.monotonic()
        decision = await _llm_supervisor_decision(
            available_agents=available_agents,
            user_text=user_text,
            completed=completed,
            last_agent=last_agent,
            last_content=last_content,
        ) or _fallback_supervisor_decision(completed, last_agent, last_content)
        logger.info(
            "[supervisor] decision in %.3fs → %s (done=%s reason=%s)",
            time.monotonic() - t0,
            decision["next_agent"],
            decision["done"],
            decision["reason"],
        )

        if not decision["done"] and decision["next_agent"] != "FINISH":
            guidance = str(decision.get("guidance") or "").strip()
            payload = {"next_agent": decision["next_agent"]}
            if guidance:
                logger.debug("[supervisor] injecting guidance (len=%d)", len(guidance))
                payload["messages"] = [HumanMessage(content=guidance)]
            return Command(goto=decision["next_agent"], update=payload)

        final = _aggregate_completed_outputs(messages, completed) or last_content
        logger.info(
            "[supervisor] ✔ FINISH | final_response_len=%d completed=%s",
            len(final), completed,
        )
        return Command(
            goto=END,
            update={"next_agent": "FINISH", "final_response": final},
        )

    return supervisor


# ------------------------------------------------------------------
# 4. 构建完整的多 Agent 协作图
# ------------------------------------------------------------------
def build_multi_agent_graph(api_key: str = ""):
    """
    构建并编译多 Agent 协作的 LangGraph StateGraph。
    """
    import os

    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    outputs_dir = os.path.join(project_root, "storage", "outputs")
    cache_key = f"{api_key or '__default__'}::{get_provider_id()}::{get_current_model()}"
    if cache_key in _GRAPH_CACHE:
        logger.info("⚡ [graph_cache] HIT key=%.8s", cache_key)
        return _GRAPH_CACHE[cache_key]

    logger.info("🔧 [graph_cache] MISS — building graph key=%.8s", cache_key)
    t0 = time.monotonic()
    registry = AgentRegistry()
    all_ids = registry.agent_ids
    logger.info("[graph] registered agents: %s", all_ids)

    if not all_ids:
        raise RuntimeError("No agents registered. Cannot build multi-agent graph.")

    from agents.checkpoint import get_checkpointer
    from agents.publish_pipeline_node import build_publish_pipeline_node

    router = IntentRouter(available_agent_ids=all_ids)

    workflow = StateGraph(MultiAgentState)

    supervisor_destinations: List[str] = list(all_ids)
    if outputs_dir:
        supervisor_destinations.append("publish_pipeline")
    supervisor_destinations.append(END)

    workflow.add_node(
        "supervisor",
        _build_supervisor_node(router, all_ids),
        destinations=tuple(supervisor_destinations),
    )
    if outputs_dir:
        workflow.add_node("publish_pipeline", build_publish_pipeline_node(outputs_dir))
        workflow.add_edge("publish_pipeline", "supervisor")

    for agent_id in all_ids:
        agent = registry.get(agent_id, api_key)
        workflow.add_node(
            agent_id,
            build_preferences_augmented_node(
                agent_id=agent.agent_id,
                system_prompt=agent.system_prompt,
                extra_tools=agent.tools,
                model=agent.model,
                with_memory=agent.with_memory,
                with_rag=agent.with_rag,
                with_history=agent.with_history,
            ),
        )
        workflow.add_edge(agent_id, "supervisor")

    workflow.set_entry_point("supervisor")

    logger.info("[graph] built with agents: %s publish_pipeline=%s", all_ids, bool(outputs_dir))
    checkpointer = get_checkpointer()
    compiled = workflow.compile(checkpointer=checkpointer)
    _GRAPH_CACHE[cache_key] = compiled
    logger.info("[graph] compiled and cached in %.3fs", time.monotonic() - t0)
    return compiled


async def stream_multi_agent(
    user_input: str,
    api_key: str = "",
    *,
    preferences: Optional[dict] = None,
    workspace_context: Optional[dict] = None,
    thread_id: str = "",
    use_publish_pipeline: bool = False,
) -> AsyncIterator[dict]:
    """流式输出多 Agent 协作事件，供 SSE 使用。"""
    logger.info("[stream] start | input_len=%d publish_pipeline=%s", len(user_input), use_publish_pipeline)
    t_start = time.monotonic()
    graph = build_multi_agent_graph(api_key)

    from agents.checkpoint import graph_run_config
    from agents.knowledge_scope import parse_knowledge_scope

    prefs = preferences or {}
    scope = parse_knowledge_scope(str(prefs.get("chat_knowledge_scope") or "all"))

    initial_state: MultiAgentState = {
        "messages": [HumanMessage(content=user_input)],
        "next_agent": "",
        "completed_agents": [],
        "final_response": "",
        "preferences": prefs,
        "knowledge_scope": scope,
        "workspace_context": workspace_context or {},
        "thread_id": thread_id,
        "media_url": "",
        "use_publish_pipeline": use_publish_pipeline,
    }

    config = graph_run_config(thread_id or f"orch-{int(time.time())}")
    completed_agents: List[str] = []
    final_emitted = False

    yield {"type": "start", "input": user_input}

    async for chunk in graph.astream(initial_state, config=config, stream_mode="updates"):
        if not isinstance(chunk, dict):
            logger.warning(
                "[stream] unexpected chunk type=%s after %.3fs",
                type(chunk).__name__,
                time.monotonic() - t_start,
            )
            continue

        logger.info(
            "[stream] langgraph_chunk elapsed=%.3fs nodes=%s",
            time.monotonic() - t_start,
            list(chunk.keys()),
        )

        for node_name, update in chunk.items():
            if not isinstance(update, dict):
                continue

            if node_name == "publish_pipeline":
                new_completed = update.get("completed_agents") or ["media_agent"]
                for agent_id in new_completed:
                    if agent_id not in completed_agents:
                        completed_agents.append(agent_id)
                content = str(update.get("final_response") or "")
                media_url = str(update.get("media_url") or "")
                yield {
                    "type": "agent_result",
                    "agent_id": "media_agent",
                    "content": content,
                    "completed_agents": list(completed_agents),
                    "media_url": media_url,
                }
                if update.get("final_response"):
                    final_emitted = True
                    yield {
                        "type": "final",
                        "response": content,
                        "completed_agents": list(completed_agents),
                        "media_url": media_url,
                    }
                continue

            if node_name == "supervisor":
                next_agent = update.get("next_agent")
                final_response = update.get("final_response")
                if next_agent and next_agent != "FINISH":
                    guidance = ""
                    event_messages = update.get("messages") or []
                    if event_messages:
                        guidance = str(getattr(event_messages[-1], "content", "") or "")
                    logger.info("[stream] decision → %s guidance_len=%d", next_agent, len(guidance))
                    yield {
                        "type": "decision",
                        "next_agent": next_agent,
                        "guidance": guidance,
                        "completed_agents": list(completed_agents),
                    }
                if final_response:
                    final_emitted = True
                    logger.info(
                        "[stream] final emitted | len=%d completed=%s elapsed=%.3fs",
                        len(str(final_response)), completed_agents,
                        time.monotonic() - t_start,
                    )
                    yield {
                        "type": "final",
                        "response": str(final_response),
                        "completed_agents": list(completed_agents),
                    }
                continue

            new_completed = update.get("completed_agents") or []
            for agent_id in new_completed:
                if agent_id not in completed_agents:
                    completed_agents.append(agent_id)

            event_messages = update.get("messages") or []
            content = ""
            sender = node_name
            if event_messages:
                last_message = event_messages[-1]
                content = str(getattr(last_message, "content", "") or "")
                sender = last_message.additional_kwargs.get("sender", node_name)

            logger.info(
                "[stream] agent_result from=%s content_len=%d preview=%.80r",
                sender, len(content), content[:80],
            )
            yield {
                "type": "agent_result",
                "agent_id": sender,
                "content": content,
                "completed_agents": list(completed_agents),
            }

    if not final_emitted:
        logger.warning(
            "[stream] no final_response emitted | completed=%s elapsed=%.3fs",
            completed_agents, time.monotonic() - t_start,
        )
        yield {
            "type": "final",
            "response": "",
            "completed_agents": list(completed_agents),
        }


# ------------------------------------------------------------------
# 5. 便捷调用接口
# ------------------------------------------------------------------
async def invoke_multi_agent(
    user_input: str,
    api_key: str = "",
    *,
    preferences: Optional[dict] = None,
    workspace_context: Optional[dict] = None,
    thread_id: str = "",
    use_publish_pipeline: bool = False,
) -> dict:
    graph = build_multi_agent_graph(api_key)

    from agents.checkpoint import graph_run_config
    from agents.knowledge_scope import parse_knowledge_scope

    prefs = preferences or {}
    scope = parse_knowledge_scope(str(prefs.get("chat_knowledge_scope") or "all"))

    initial_state: MultiAgentState = {
        "messages": [HumanMessage(content=user_input)],
        "next_agent": "",
        "completed_agents": [],
        "final_response": "",
        "preferences": prefs,
        "knowledge_scope": scope,
        "workspace_context": workspace_context or {},
        "thread_id": thread_id,
        "media_url": "",
        "use_publish_pipeline": use_publish_pipeline,
    }

    config = graph_run_config(thread_id or f"orch-{int(time.time())}")
    result = await graph.ainvoke(initial_state, config=config)

    return {
        "response": result.get("final_response", ""),
        "completed_agents": result.get("completed_agents", []),
        "media_url": result.get("media_url", ""),
        "graph_id": "orchestrator",
        "messages": [
            {
                "role": "ai" if isinstance(m, AIMessage) else "human",
                "content": m.content,
                "sender": m.additional_kwargs.get("sender", ""),
            }
            for m in result.get("messages", [])
            if hasattr(m, "content")
        ],
    }
