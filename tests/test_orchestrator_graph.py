"""Integration tests for Orchestrator LangGraph (Command routing + registry)."""

import asyncio
import os
import sys
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))


def _ensure_registry():
    from agents.registry import AgentRegistry
    from agents.general_agent import get_creative_base_agent, AGENT_ID as CREATIVE_ID
    from agents.general_agent import AGENT_DESCRIPTION as CREATIVE_DESC
    from agents.general_agent import AGENT_CAPABILITIES as CREATIVE_CAPS

    registry = AgentRegistry()
    if CREATIVE_ID not in registry.agent_ids:
        registry.register(CREATIVE_ID, get_creative_base_agent, CREATIVE_DESC, CREATIVE_CAPS)
    return registry


def test_build_multi_agent_graph_compiles():
    _ensure_registry()
    from agents.orchestrator import build_multi_agent_graph, clear_graph_cache

    clear_graph_cache()
    graph = build_multi_agent_graph("")
    assert graph is not None


def test_supervisor_command_fast_finish():
    from agents.orchestrator import _build_supervisor_node
    from agents.router import IntentRouter
    from langchain_core.messages import HumanMessage, AIMessage
    from langgraph.types import Command
    from langgraph.graph import END

    router = IntentRouter(available_agent_ids=["creative_agent"])
    supervisor = _build_supervisor_node(router, ["creative_agent"])

    state = {
        "messages": [
            HumanMessage(content="写一句口号"),
            AIMessage(content="口号已写好", additional_kwargs={"sender": "creative_agent"}),
        ],
        "completed_agents": ["creative_agent"],
        "preferences": {},
    }

    result = asyncio.run(supervisor(state))
    assert isinstance(result, Command)
    assert result.goto is END
    assert result.update.get("final_response")


def test_stream_multi_agent_emits_decision(monkeypatch):
    _ensure_registry()
    from agents.orchestrator import clear_graph_cache, stream_multi_agent
    from agents.router import RouteResult

    clear_graph_cache()

    async def fake_route(self, _text):
        return RouteResult(agent_id="creative_agent", reason="test", confidence=1.0)

    async def fake_worker_invoke(_state):
        from langchain_core.messages import AIMessage

        return {"messages": [AIMessage(content="mock reply")]}

    with patch("agents.router.IntentRouter.route", new=fake_route):
        with patch(
            "core.augmented_llm._build_react_agent",
        ) as mock_build:
            mock_agent = AsyncMock()
            mock_agent.ainvoke = fake_worker_invoke
            mock_build.return_value = mock_agent

            async def collect():
                events = []
                async for ev in stream_multi_agent("你好", "", thread_id="test-orch-1"):
                    events.append(ev)
                return events

            events = asyncio.run(collect())

    types = [e.get("type") for e in events]
    assert "start" in types
    assert "decision" in types or "agent_result" in types
    assert "final" in types
