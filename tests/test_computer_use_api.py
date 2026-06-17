"""
FastAPI 层面对 POST /computer-use/run 的集成烟测：mock dispatch，不启动浏览器。
"""

from __future__ import annotations

import os
import sys
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

try:
    import main as app_main
    from fastapi.testclient import TestClient
except ImportError:  # pragma: no cover
    app_main = None
    TestClient = None


@unittest.skipUnless(
    app_main is not None and TestClient is not None,
    "需要 backend 在 path 上且已安装 fastapi/starlette",
)
class TestComputerUseRunEndpoint(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app_main.app)

    def test_empty_goal_returns_400(self):
        r = self.client.post(
            "/computer-use/run",
            json={
                "goal": "   ",
                "start_url": "https://example.com",
                "max_rounds": 1,
                "headless": True,
                "autoresearch": False,
                "require_approval": False,
            },
        )
        self.assertEqual(r.status_code, 400)

    def test_run_returns_pending_task_id_immediately(self):
        with patch.object(
            app_main,
            "_background_computer_use_run",
            new=AsyncMock(),
        ):
            r = self.client.post(
                "/computer-use/run",
                json={
                    "goal": "Open example.com",
                    "start_url": "https://example.com",
                    "max_rounds": 1,
                    "headless": True,
                    "autoresearch": False,
                    "require_approval": False,
                },
            )
        self.assertEqual(r.status_code, 200, msg=r.text)
        body = r.json()
        self.assertEqual(body.get("status"), "pending")
        self.assertTrue(body.get("task_id"))
        self.assertTrue(body.get("success"))

    def test_always_creates_task_even_without_approval(self):
        with (
            patch.object(app_main, "_background_computer_use_run", new=AsyncMock()),
            patch.object(
                app_main.task_manager,
                "create_task",
                return_value="cu-task-2",
            ) as ct,
        ):
            r = self.client.post(
                "/computer-use/run",
                json={
                    "goal": "do thing",
                    "start_url": "https://example.com",
                    "max_rounds": 2,
                    "headless": True,
                    "autoresearch": False,
                    "require_approval": False,
                },
            )
        self.assertEqual(r.status_code, 200, msg=r.text)
        ct.assert_called_once()
        self.assertEqual(r.json().get("task_id"), "cu-task-2")

    def test_resume_returns_pending_immediately(self):
        with (
            patch.object(
                app_main,
                "get_task_resume_payload",
                return_value={
                    "goal": "g",
                    "start_url": "https://example.com",
                    "max_rounds": 2,
                    "headless": True,
                    "autoresearch": False,
                    "require_approval": True,
                    "approved_approval_id": "ap-1",
                    "resume_navigation_url": "https://example.com",
                    "page_context_at_block": {},
                },
            ),
            patch.object(app_main, "_background_computer_use_resume", new=AsyncMock()),
        ):
            r = self.client.post("/tasks/task-abc/resume")
        self.assertEqual(r.status_code, 200, msg=r.text)
        self.assertEqual(r.json().get("status"), "pending")
        self.assertEqual(r.json().get("task_id"), "task-abc")


if __name__ == "__main__":
    unittest.main()
