"""Agent registry smoke test."""

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from agents.registry import AgentRegistry  # noqa: E402


class AgentRegistryTests(unittest.TestCase):
    def test_register_and_list(self):
        registry = AgentRegistry()
        registry.reset()
        registry.register("test_agent", lambda key: object(), "test", ["demo"])
        ids = {item["agent_id"] for item in registry.list_all()}
        self.assertIn("test_agent", ids)
        registry.reset()


if __name__ == "__main__":
    unittest.main()
