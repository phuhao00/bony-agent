"""URL safety / SSRF guard tests."""

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from utils.url_safety import is_safe_fetch_url  # noqa: E402


class UrlSafetyTests(unittest.TestCase):
    def test_blocks_localhost(self):
        self.assertFalse(is_safe_fetch_url("http://127.0.0.1:8000/secret"))
        self.assertFalse(is_safe_fetch_url("http://localhost/admin"))

    def test_allows_public_https(self):
        # Use literal public IP to avoid sandbox DNS issues
        self.assertTrue(is_safe_fetch_url("https://93.184.216.34/image.png"))

    def test_blocks_file_scheme(self):
        self.assertFalse(is_safe_fetch_url("file:///etc/passwd"))

    def test_allows_dashscope_oss_https_without_dns(self):
        url = (
            "https://dashscope-a717.oss-accelerate.aliyuncs.com/path/video.mp4"
            "?Expires=1781329558&Signature=abc"
        )
        self.assertTrue(is_safe_fetch_url(url))

    def test_blocks_untrusted_http_even_if_public_looking(self):
        self.assertFalse(
            is_safe_fetch_url("http://dashscope-a717.oss-accelerate.aliyuncs.com/video.mp4")
        )


if __name__ == "__main__":
    unittest.main()
