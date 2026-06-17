import os
import shutil
import sys
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

PROJECT_ROOT = Path(__file__).resolve().parents[1]
TEST_TEMP_ROOT = PROJECT_ROOT / "storage" / "temp" / "tests" / "wiki_compiler"


class TestWikiCompiler(unittest.TestCase):
    def make_wiki_dir(self) -> Path:
        wiki_dir = TEST_TEMP_ROOT / str(uuid.uuid4()) / "wiki"
        wiki_dir.mkdir(parents=True, exist_ok=True)
        self.addCleanup(lambda: shutil.rmtree(wiki_dir.parent, ignore_errors=True))
        return wiki_dir

    def test_compile_text_builds_index_graph_and_health(self):
        from services import wiki_compiler

        wiki_dir = self.make_wiki_dir()
        result = wiki_compiler.compile_text_to_wiki(
            "This project should compile durable knowledge into markdown pages.",
            title="LLM Wiki Notes",
            page_type="playbook",
            tags=["wiki"],
            wiki_dir=wiki_dir,
        )

        self.assertTrue(result["success"])
        self.assertTrue((wiki_dir / "index.md").exists())
        self.assertTrue((wiki_dir / "log.md").exists())

        pages = wiki_compiler.list_pages(wiki_dir=wiki_dir)
        self.assertEqual(len(pages), 1)
        self.assertEqual(pages[0]["page_type"], "playbook")
        self.assertEqual(pages[0]["title"], "LLM Wiki Notes")
        self.assertTrue(pages[0]["source_hash"])

        graph = wiki_compiler.build_graph(wiki_dir=wiki_dir)
        self.assertEqual(len(graph["nodes"]), 1)
        self.assertEqual(graph["links"], [])

        health = wiki_compiler.lint_wiki(wiki_dir=wiki_dir)
        self.assertTrue(health["success"])
        self.assertTrue(health["valid"])

    def test_compile_trace_creates_entity_pages_and_links(self):
        from services import wiki_compiler

        wiki_dir = self.make_wiki_dir()
        trace = {
            "id": "trace-123",
            "kind": "multi_agent",
            "status": "completed",
            "input": "生成小红书脚本",
            "final_response": "脚本已生成。",
            "metadata": {"completed_agents": ["copywriter_agent"], "platform": "xiaohongshu"},
            "events": [{"timestamp": "2026-05-06T00:00:00Z", "type": "tool_call", "name": "generate_script"}],
        }

        with patch.object(wiki_compiler, "get_trace", return_value=trace):
            result = wiki_compiler.compile_trace_to_wiki("trace-123", title="小红书脚本任务", wiki_dir=wiki_dir)

        self.assertTrue(result["success"])
        self.assertGreaterEqual(len(result["entities"]), 3)
        page_id = result["page"]["id"]
        page = wiki_compiler.read_page(page_id, wiki_dir=wiki_dir)
        self.assertTrue(page["success"])
        self.assertIn("Source hash", page["content"])
        self.assertIn("copywriter_agent", page["content"])

        graph = wiki_compiler.build_graph(wiki_dir=wiki_dir)
        self.assertGreaterEqual(len(graph["nodes"]), 4)
        self.assertTrue(any(link["source"] == page_id for link in graph["links"]))

    def test_lint_reports_broken_wikilink(self):
        from services import wiki_compiler

        wiki_dir = self.make_wiki_dir()
        wiki_compiler.compile_text_to_wiki(
            "This page points to [[missing/page|a missing page]].",
            title="Broken Link Note",
            wiki_dir=wiki_dir,
        )

        health = wiki_compiler.lint_wiki(wiki_dir=wiki_dir)
        self.assertFalse(health["valid"])
        self.assertTrue(any("broken wikilink" in issue["message"] for issue in health["issues"]))


if __name__ == "__main__":
    unittest.main()