"""Tests for per-agent timeout configuration in augmented_llm."""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from core.augmented_llm import _agent_timeout, _LONG_RUNNING_AGENT_IDS


def test_media_agents_get_long_timeout():
    for agent_id in _LONG_RUNNING_AGENT_IDS:
        assert _agent_timeout(agent_id) == 600.0, agent_id


def test_unknown_agent_uses_default_timeout():
    assert _agent_timeout("creative_agent") == 75.0
    assert _agent_timeout(None) == 75.0
    assert _agent_timeout("") == 75.0


def test_custom_default_timeout():
    assert _agent_timeout("creative_agent", default=30.0) == 30.0
    assert _agent_timeout("media_agent", default=30.0) == 600.0
