"""Customer service API smoke tests."""

import os
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-unit-tests-only")

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402


class CustomerServiceApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)

    def test_health_endpoint(self):
        resp = self.client.get("/api/v1/ai-customer-service/health")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data.get("status"), "ok")

    def test_list_workspaces(self):
        resp = self.client.get("/api/v1/ai-customer-service/workspaces")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("workspaces", resp.json())


if __name__ == "__main__":
    unittest.main()
