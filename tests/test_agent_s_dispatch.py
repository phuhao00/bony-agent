"""Tests for engine dispatch and progress helpers."""

from __future__ import annotations

import os
import sys
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from services.computer_use_service import _emit_progress, _is_cancelled, dispatch_computer_use_session
from utils.task_manager import task_manager


class TestComputerUseDispatch(unittest.IsolatedAsyncioTestCase):
    async def test_legacy_engine_routes_to_session(self):
        with (
            patch("services.agent_s.config.get_engine", return_value="legacy"),
            patch(
                "services.computer_use_service.run_computer_use_session",
                new=AsyncMock(return_value={"success": True, "engine": "legacy"}),
            ) as mock_legacy,
        ):
            out = await dispatch_computer_use_session(
                "goal",
                "https://example.com",
                max_rounds=1,
            )
        mock_legacy.assert_awaited_once()
        self.assertTrue(out.get("success"))

    async def test_agent_s_engine_routes_to_runner(self):
        with (
            patch("services.agent_s.config.get_engine", return_value="agent_s"),
            patch(
                "services.agent_s.browser_runner.run_agent_s_browser_session",
                new=AsyncMock(return_value={"success": True, "engine": "agent_s"}),
            ) as mock_agent,
        ):
            out = await dispatch_computer_use_session(
                "goal",
                "https://example.com",
                max_rounds=1,
            )
        mock_agent.assert_awaited_once()
        self.assertEqual(out.get("engine"), "agent_s")


class TestProgressHelpers(unittest.TestCase):
    def test_emit_and_cancel(self):
        tid = task_manager.create_task("computer_use", metadata={})
        self.assertFalse(_is_cancelled(tid))
        _emit_progress(tid, step=2, max_steps=10, plan="click · search", stage="click")
        task = task_manager.get_task(tid)
        self.assertIsNotNone(task)
        cu = (task or {}).get("metadata", {}).get("computer_use", {})
        self.assertEqual(cu.get("current_step"), 2)
        self.assertEqual(cu.get("last_plan"), "click · search")
        task_manager.request_cancel(tid)
        self.assertTrue(_is_cancelled(tid))


if __name__ == "__main__":
    unittest.main()
