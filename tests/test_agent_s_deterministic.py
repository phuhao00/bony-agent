"""Deterministic search planner tests."""

from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from services.agent_s.deterministic_planner import plan_deterministic_action
from services.agent_s.result_extractor import digest_indicates_search_results

_RESULT_DIGEST = {
    "url": "https://html.duckduckgo.com/html/?q=%E6%B7%B1%E5%9C%B3%E5%A4%A9%E6%B0%94",
    "title": "深圳天气 at DuckDuckGo",
    "text_excerpt": (
        "深圳 weather forecast results\n"
        "Shenzhen weather today humidity wind\n"
        "wiki wikipedia news forecast 7 day\n"
        + "line of excerpt content\n" * 12
    ),
}


class TestDeterministicPlanner(unittest.TestCase):
    def test_digest_detects_results(self):
        self.assertTrue(
            digest_indicates_search_results(_RESULT_DIGEST, "深圳天气")
        )
        self.assertFalse(
            digest_indicates_search_results({"text_excerpt": "DuckDuckGo"}, "深圳天气")
        )

    def test_search_portal_types_query(self):
        act, plan = plan_deterministic_action(
            goal="在搜索框输入「深圳天气」并搜索，等结果出来后截图",
            page_url="https://html.duckduckgo.com/html/",
            history=[],
            bootstrap_query=None,
        )
        self.assertEqual(act["action"], "type")
        self.assertIn("深圳天气", act["text"])

    def test_after_bootstrap_runs_full_flow_before_done(self):
        history = [
            {"action": "fill", "ok": True, "step": 1, "bootstrap": True},
            {"action": "press", "ok": True, "step": 2, "bootstrap": True},
            {"action": "wait", "ok": True, "step": 3, "bootstrap": True},
        ]
        goal = "在搜索框输入「深圳天气」并搜索，等结果出来后截图"

        act, plan = plan_deterministic_action(
            goal=goal,
            page_url="https://html.duckduckgo.com/html/",
            history=history,
            bootstrap_query="深圳天气",
            page_digest=_RESULT_DIGEST,
        )
        self.assertEqual(act["action"], "wait")
        self.assertIn("等待", plan)

        history.append({"action": "wait", "ok": True, "step": 4})
        act2, _ = plan_deterministic_action(
            goal=goal,
            page_url="https://html.duckduckgo.com/html/results",
            history=history,
            bootstrap_query="深圳天气",
            page_digest=_RESULT_DIGEST,
        )
        self.assertEqual(act2["action"], "scroll")

        history.append({"action": "scroll", "ok": True, "step": 5})
        act3, _ = plan_deterministic_action(
            goal=goal,
            page_url="https://html.duckduckgo.com/html/results",
            history=history,
            bootstrap_query="深圳天气",
            page_digest=_RESULT_DIGEST,
        )
        self.assertEqual(act3["action"], "scroll")

        history.append({"action": "scroll", "ok": True, "step": 6})
        act4, _ = plan_deterministic_action(
            goal=goal,
            page_url="https://html.duckduckgo.com/html/results",
            history=history,
            bootstrap_query="深圳天气",
            page_digest=_RESULT_DIGEST,
        )
        self.assertEqual(act4["action"], "extract_results")

        history.append(
            {
                "action": "extract_results",
                "ok": True,
                "count": 5,
                "results": [{"title": "深圳天气", "url": "https://example.com", "snippet": "..."}],
                "step": 7,
            }
        )
        act5, _ = plan_deterministic_action(
            goal=goal,
            page_url="https://html.duckduckgo.com/html/results",
            history=history,
            bootstrap_query="深圳天气",
            page_digest=_RESULT_DIGEST,
        )
        self.assertEqual(act5["action"], "screenshot")

        history.append({"action": "screenshot", "ok": True, "screenshot_base64": "abc", "step": 8})
        act6, plan6 = plan_deterministic_action(
            goal=goal,
            page_url="https://html.duckduckgo.com/html/results",
            history=history,
            bootstrap_query="深圳天气",
            page_digest=_RESULT_DIGEST,
        )
        self.assertEqual(act6["action"], "done")
        self.assertIn("分析", plan6)

    def test_no_results_retries_submit(self):
        empty_digest = {"url": "https://duckduckgo.com/", "text_excerpt": "DuckDuckGo search"}
        history = [
            {"action": "fill", "ok": True, "bootstrap": True},
            {"action": "press", "ok": True, "bootstrap": True},
        ]
        act, plan = plan_deterministic_action(
            goal="搜索深圳天气",
            page_url="https://duckduckgo.com/",
            history=history,
            bootstrap_query="深圳天气",
            page_digest=empty_digest,
        )
        self.assertEqual(act["action"], "click_submit_retry")
        self.assertIn("重新提交", plan)


if __name__ == "__main__":
    unittest.main()
