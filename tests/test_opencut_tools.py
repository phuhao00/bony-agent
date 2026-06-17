"""
OpenCut 工具单元测试
使用一个小样本视频（或生成一个测试视频）验证 FFmpeg 工具输出结构。
"""
import os
import shutil
import subprocess
import tempfile
import unittest

# 确保能 import backend
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from tools.opencut_tools import (
    cut_video_segment,
    merge_clips,
    change_video_speed,
    apply_video_filter,
    generate_opencut_project,
    _check_ffmpeg,
)
from tools.media_common import OUTPUT_DIR


class TestOpenCutTools(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ffmpeg_ok = _check_ffmpeg() is None
        cls.test_dir = tempfile.mkdtemp(prefix="opencut_test_")
        cls.test_video = os.path.join(cls.test_dir, "test.mp4")
        if cls.ffmpeg_ok:
            # 生成 5 秒 1280x720 测试视频
            cmd = [
                "ffmpeg", "-y", "-f", "lavfi", "-i", "testsrc=duration=5:size=1280x720:rate=30",
                "-pix_fmt", "yuv420p", cls.test_video,
            ]
            subprocess.run(cmd, capture_output=True, check=True)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.test_dir, ignore_errors=True)

    def _skip_if_no_ffmpeg(self):
        if not self.ffmpeg_ok:
            self.skipTest("FFmpeg 未安装")

    def test_check_ffmpeg(self):
        # 至少验证函数不抛异常
        result = _check_ffmpeg()
        self.assertIsNone(result)  # CI 环境应安装 FFmpeg

    def test_cut_video_segment(self):
        self._skip_if_no_ffmpeg()
        result = cut_video_segment(self.test_video, 1, 3, output_name="cut_test.mp4")
        self.assertTrue(result["success"], result.get("message"))
        self.assertTrue(os.path.exists(result["local_path"]))

    def test_change_video_speed(self):
        self._skip_if_no_ffmpeg()
        result = change_video_speed(self.test_video, 2.0, output_name="speed_test.mp4")
        self.assertTrue(result["success"], result.get("message"))
        self.assertTrue(os.path.exists(result["local_path"]))

    def test_apply_video_filter(self):
        self._skip_if_no_ffmpeg()
        result = apply_video_filter(self.test_video, "grayscale", output_name="filter_test.mp4")
        self.assertTrue(result["success"], result.get("message"))
        self.assertTrue(os.path.exists(result["local_path"]))

    def test_merge_clips(self):
        self._skip_if_no_ffmpeg()
        result = merge_clips([self.test_video, self.test_video], output_name="merge_test.mp4")
        self.assertTrue(result["success"], result.get("message"))
        self.assertTrue(os.path.exists(result["local_path"]))

    def test_generate_opencut_project(self):
        result = generate_opencut_project([
            {"type": "video", "source": self.test_video, "start": 0, "end": 5},
        ], output_name="project_test.json")
        self.assertTrue(result["success"], result.get("message"))
        self.assertTrue(os.path.exists(result["local_path"]))


if __name__ == "__main__":
    unittest.main()
