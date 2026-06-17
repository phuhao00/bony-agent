"""Knowledge URL fetch unit tests."""

import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from utils.knowledge_url_fetch import (  # noqa: E402
    _html_to_markdown,
    fetch_url_content,
    normalize_knowledge_url,
)


class KnowledgeUrlFetchTests(unittest.TestCase):
    def test_normalize_adds_https(self):
        self.assertEqual(
            normalize_knowledge_url("example.com/docs"),
            "https://example.com/docs",
        )

    def test_normalize_keeps_existing_scheme(self):
        self.assertEqual(
            normalize_knowledge_url("http://example.com/a"),
            "http://example.com/a",
        )

    def test_html_to_markdown_extracts_article(self):
        html = """
        <html><head><title>Page Title</title></head>
        <body><nav>Menu</nav>
        <article><h1>Hello</h1><p>World <strong>bold</strong>.</p></article>
        </body></html>
        """
        title, body = _html_to_markdown(html, "https://example.com/post")
        self.assertEqual(title, "Page Title")
        self.assertIn("Hello", body)
        self.assertIn("World", body)
        self.assertNotIn("Menu", body)

    @patch("utils.knowledge_url_fetch.is_safe_fetch_url", return_value=False)
    def test_fetch_blocks_unsafe_url(self, _mock_safe):
        result = fetch_url_content("https://127.0.0.1/secret")
        self.assertFalse(result["success"])
        self.assertIn("不允许", result["error"])

    @patch("utils.knowledge_url_fetch.requests.get")
    @patch("utils.knowledge_url_fetch.is_safe_fetch_url", return_value=True)
    def test_fetch_html_success(self, _mock_safe, mock_get):
        response = MagicMock()
        response.url = "https://example.com/article"
        response.status_code = 200
        response.headers = {"Content-Type": "text/html; charset=utf-8"}
        response.encoding = "utf-8"
        response.apparent_encoding = "utf-8"
        response.history = []
        response.iter_content.return_value = [
            b"<html><head><title>T</title></head><body><main><p>"
            + (b"x" * 80)
            + b"</p></main></body></html>",
        ]
        mock_get.return_value.__enter__.return_value = response

        result = fetch_url_content("https://example.com/article")
        self.assertTrue(result["success"])
        self.assertEqual(result["title"], "T")
        self.assertGreaterEqual(result["char_count"], 40)


if __name__ == "__main__":
    unittest.main()
