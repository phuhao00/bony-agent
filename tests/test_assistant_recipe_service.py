"""Tests for recipe events emitted into main chat SSE."""

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from agents.chat_graph import _recipe_event_from_tool_output


def test_recipe_tool_output_becomes_completed_event():
    payload = {
        "success": True,
        "task_id": "task-1",
        "status": "completed",
        "result": {
            "recipe_id": "style.guide",
            "recipe": "视觉风格指南",
            "report": "# 风格指南\n\n- 色彩",
        },
    }
    event = _recipe_event_from_tool_output(
        agent_id="game_art_agent",
        tool_name="run_game_art_recipe",
        content=json.dumps(payload),
    )
    assert event is not None
    assert event["type"] == "recipe_completed"
    assert event["task_id"] == "task-1"
    assert event["recipe_id"] == "style.guide"
    assert event["assistant"]["labs_href"] == "/game-art"


def test_non_recipe_tool_output_is_ignored():
    event = _recipe_event_from_tool_output(
        agent_id="game_art_agent",
        tool_name="collect_game_art_signals",
        content="{}",
    )
    assert event is None

