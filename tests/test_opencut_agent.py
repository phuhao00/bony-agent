"""
OpenCut Agent 单元测试
验证 Agent 注册、路由命中、工具挂载。
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from agents.opencut_agent import (
    AGENT_ID,
    AGENT_DESCRIPTION,
    AGENT_CAPABILITIES,
    get_opencut_base_agent,
    get_opencut_agent,
)
from agents.router import IntentRouter
from agents.registry import AgentRegistry


class TestOpenCutAgent(unittest.TestCase):
    def test_agent_info(self):
        self.assertEqual(AGENT_ID, "opencut_agent")
        self.assertIn("opencut", AGENT_CAPABILITIES)
        self.assertIn("video_editing", AGENT_CAPABILITIES)

    def test_build_agent(self):
        agent = get_opencut_base_agent()
        self.assertEqual(agent.agent_id, AGENT_ID)
        self.assertTrue(len(agent.tools) > 0)
        tool_names = [getattr(t, "name", getattr(t, "__name__", str(t))) for t in agent.tools]
        self.assertIn("cut_video_segment", tool_names)
        self.assertIn("merge_clips", tool_names)

    def test_registry(self):
        registry = AgentRegistry()
        if not registry.has(AGENT_ID):
            registry.register(AGENT_ID, get_opencut_base_agent, AGENT_DESCRIPTION, AGENT_CAPABILITIES)
        self.assertTrue(registry.has(AGENT_ID))
        info = registry.get_entry(AGENT_ID)
        self.assertIsNotNone(info)
        self.assertIn("opencut", info.capabilities)

    def test_router_keyword(self):
        router = IntentRouter()
        result = router._keyword_route("用 OpenCut 帮我剪一个 30 秒 highlights")
        self.assertIsNotNone(result)
        self.assertEqual(result.agent_id, AGENT_ID)

    def test_router_keyword_pip(self):
        router = IntentRouter()
        result = router._keyword_route("画中画效果怎么做")
        self.assertIsNotNone(result)
        self.assertEqual(result.agent_id, AGENT_ID)


if __name__ == "__main__":
    unittest.main()
