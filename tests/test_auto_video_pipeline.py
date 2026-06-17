"""Tests for auto video pipeline and material tools."""
from __future__ import annotations

import os
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(PROJECT_ROOT, "backend"))

from services.auto_video_pipeline import (  # noqa: E402
    AutoVideoParams,
    _combine_clips,
    _get_audio_duration,
    _llm_generate_terms,
    create_auto_video_task,
    get_auto_video_task,
)
from tools.material_tools import (  # noqa: E402
    MaterialItem,
    generate_synthetic_clips,
    search_materials,
)


class TestMaterialTools(unittest.TestCase):
    @patch("tools.material_tools.search_videos_pexels")
    def test_search_materials_dedupes(self, mock_pexels):
        mock_pexels.return_value = [
            MaterialItem(provider="pexels", url="http://a/1.mp4", duration=10),
            MaterialItem(provider="pexels", url="http://a/1.mp4", duration=10),
            MaterialItem(provider="pexels", url="http://b/2.mp4", duration=8),
        ]
        items = search_materials(["ai", "tech"], source="pexels")
        self.assertEqual(len(items), 2)

    @patch("tools.material_tools.search_materials")
    @patch("tools.material_tools.download_material")
    def test_download_falls_back_to_synthetic(self, mock_dl, mock_search):
        mock_search.return_value = []
        with tempfile.TemporaryDirectory() as tmp:
            paths, mode = __import__(
                "tools.material_tools", fromlist=["download_materials_for_duration"]
            ).download_materials_for_duration(
                ["test"],
                target_duration=6.0,
                task_dir=tmp,
                source="pexels",
            )
            self.assertEqual(mode, "synthetic")
            self.assertGreaterEqual(len(paths), 2)
            mock_dl.assert_not_called()

    @unittest.skipUnless(
        os.system("which ffmpeg >/dev/null 2>&1") == 0,
        "ffmpeg required",
    )
    def test_generate_synthetic_clips(self):
        with tempfile.TemporaryDirectory() as tmp:
            paths = generate_synthetic_clips(9.0, tmp, aspect_ratio="16:9", clip_duration=3.0)
            self.assertGreaterEqual(len(paths), 2)
            for p in paths:
                self.assertTrue(os.path.isfile(p))


class TestAutoVideoPipeline(unittest.TestCase):
    def test_create_and_get_task(self):
        params = AutoVideoParams(subject="测试主题")
        task_id = create_auto_video_task(params)
        self.assertTrue(task_id)
        task = get_auto_video_task(task_id)
        self.assertIsNotNone(task)
        self.assertEqual(task["type"], "auto_short_video")
        self.assertEqual(task["metadata"]["params"]["subject"], "测试主题")

    @patch("services.auto_video_pipeline.get_chat_llm")
    def test_llm_generate_terms_parses_lines(self, mock_llm_factory):
        mock_llm = MagicMock()
        mock_llm.invoke.return_value = MagicMock(
            content="technology\nartificial intelligence\nworkspace\n"
        )
        mock_llm_factory.return_value = mock_llm
        terms = _llm_generate_terms("AI 办公", "这是一段旁白", amount=5)
        self.assertGreaterEqual(len(terms), 2)
        self.assertIn("AI 办公", terms)

    @unittest.skipUnless(
        os.system("which ffmpeg >/dev/null 2>&1") == 0
        and os.system("which ffprobe >/dev/null 2>&1") == 0,
        "ffmpeg/ffprobe required",
    )
    def test_combine_clips_produces_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            clip = os.path.join(tmp, "clip.mp4")
            os.system(
                f'ffmpeg -y -f lavfi -i color=c=blue:s=320x240:d=2 -c:v libx264 -pix_fmt yuv420p "{clip}" 2>/dev/null'
            )
            out = os.path.join(tmp, "out.mp4")
            _combine_clips([clip], target_duration=4.0, aspect_ratio="16:9", clip_duration=2.0, output_path=out)
            self.assertTrue(os.path.isfile(out))
            dur = _get_audio_duration(out) if False else __import__(
                "tools.media_common", fromlist=["get_video_duration"]
            ).get_video_duration(out)
            self.assertGreaterEqual(dur, 3.5)


if __name__ == "__main__":
    unittest.main()
