"""
多Agent协作架构 — 单元测试

测试内容:
1. AgentRegistry 注册/查询/过滤
2. IntentRouter 关键词路由
3. AgentMessage 序列化
"""

import os
import sys
import unittest

# Add backend to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))


class TestAgentMessage(unittest.TestCase):
    """AgentMessage 消息协议测试"""

    def test_create_message(self):
        from agents.base.message import AgentMessage

        msg = AgentMessage(
            sender="test_agent",
            content="Hello from test",
            artifacts=["/path/to/file.png"],
            metadata={"key": "value"},
        )
        self.assertEqual(msg.sender, "test_agent")
        self.assertEqual(msg.content, "Hello from test")
        self.assertEqual(len(msg.artifacts), 1)

    def test_to_langchain_message(self):
        from agents.base.message import AgentMessage

        msg = AgentMessage(sender="media_agent", content="Generated image!", artifacts=["http://example.com/img.png"])
        lc_msg = msg.to_langchain_message()
        self.assertIn("Generated image!", lc_msg.content)
        self.assertIn("http://example.com/img.png", lc_msg.content)
        self.assertEqual(lc_msg.additional_kwargs["sender"], "media_agent")

    def test_serialization(self):
        from agents.base.message import AgentMessage

        msg = AgentMessage(sender="a", content="b", artifacts=["c"])
        d = msg.to_dict()
        msg2 = AgentMessage.from_dict(d)
        self.assertEqual(msg.sender, msg2.sender)
        self.assertEqual(msg.content, msg2.content)
        self.assertEqual(msg.artifacts, msg2.artifacts)


class TestAgentRegistry(unittest.TestCase):
    """Agent 注册表测试"""

    def setUp(self):
        from agents.registry import AgentRegistry
        self.registry = AgentRegistry()
        self.registry.reset()

    def tearDown(self):
        self.registry.reset()

    def test_register_and_get(self):
        self.registry.register(
            "test_agent",
            lambda api_key: {"name": "TestAgent"},
            "A test agent",
            ["testing"],
        )
        self.assertTrue(self.registry.has("test_agent"))
        agent = self.registry.get("test_agent")
        self.assertEqual(agent["name"], "TestAgent")

    def test_list_all(self):
        self.registry.register("a1", lambda k: None, "Agent 1", ["cap1"])
        self.registry.register("a2", lambda k: None, "Agent 2", ["cap2"])
        result = self.registry.list_all()
        self.assertEqual(len(result), 2)
        ids = [r["agent_id"] for r in result]
        self.assertIn("a1", ids)
        self.assertIn("a2", ids)

    def test_get_by_capability(self):
        self.registry.register("img_agent", lambda k: None, "Image agent", ["image", "video"])
        self.registry.register("text_agent", lambda k: None, "Text agent", ["text"])
        self.registry.register("hybrid", lambda k: None, "Hybrid", ["image", "text"])

        image_agents = self.registry.get_by_capability("image")
        self.assertEqual(len(image_agents), 2)
        self.assertIn("img_agent", image_agents)
        self.assertIn("hybrid", image_agents)

    def test_get_nonexistent_raises(self):
        with self.assertRaises(KeyError):
            self.registry.get("nonexistent")


class TestIntentRouter(unittest.TestCase):
    """意图路由器测试"""

    def test_keyword_image(self):
        from agents.router import IntentRouter
        router = IntentRouter()
        result = router._keyword_route("帮我生成一张图片")
        self.assertIsNotNone(result)
        self.assertEqual(result.agent_id, "media_agent")

    def test_keyword_video_edit(self):
        from agents.router import IntentRouter
        router = IntentRouter()
        result = router._keyword_route("请帮我混剪这些视频")
        self.assertIsNotNone(result)
        self.assertEqual(result.agent_id, "video_editor_agent")

    def test_keyword_long_video(self):
        from agents.router import IntentRouter
        router = IntentRouter()
        result = router._keyword_route("用长视频工坊帮我做一段关于春天的叙事片")
        self.assertIsNotNone(result)
        self.assertEqual(result.agent_id, "long_video_agent")

    def test_keyword_review(self):
        from agents.router import IntentRouter
        router = IntentRouter()
        result = router._keyword_route("审核一下这段文案")
        self.assertIsNotNone(result)
        self.assertEqual(result.agent_id, "reviewer_agent")

    def test_keyword_copywriting(self):
        from agents.router import IntentRouter
        router = IntentRouter()
        result = router._keyword_route("写一段文案")
        self.assertIsNotNone(result)
        self.assertEqual(result.agent_id, "copywriter_agent")

    def test_keyword_no_match(self):
        from agents.router import IntentRouter
        router = IntentRouter()
        result = router._keyword_route("今天天气怎么样")
        self.assertIsNone(result)

    def test_available_filter(self):
        from agents.router import IntentRouter
        router = IntentRouter(available_agent_ids=["creative_agent"])
        # 图片关键词应匹配 media_agent，但它不在可用列表中
        result = router._keyword_route("帮我画一张图")
        self.assertIsNone(result)


if __name__ == "__main__":
    unittest.main()
