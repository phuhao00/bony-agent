"""Tests for A2UI media line extraction."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from utils.a2ui_media import build_a2ui_media_lines


def test_storage_forward_slash():
    text = "✅ ok\n**直接显示:** C:/Users/app/storage/outputs/star_abc.png"
    lines = build_a2ui_media_lines(text)
    assert lines == ["A2UI_MEDIA:image:/api/media/star_abc.png"]


def test_storage_backslash_windows():
    text = r"**直接显示:** D:\AppData\storage\outputs\star_xyz.webp"
    lines = build_a2ui_media_lines(text)
    assert lines == ["A2UI_MEDIA:image:/api/media/star_xyz.webp"]


def test_backend_media_path():
    text = "saved to /media/foo_bar.png for preview"
    lines = build_a2ui_media_lines(text)
    assert lines == ["A2UI_MEDIA:image:/api/media/foo_bar.png"]


def test_https_url():
    text = "URL: https://cdn.example.com/out/test.jpg?token=1"
    lines = build_a2ui_media_lines(text)
    assert any("https://cdn.example.com/out/test.jpg" in line for line in lines)
