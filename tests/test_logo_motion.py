"""Tests for logo motion tool wrapper."""

import json
import os
import tempfile
from pathlib import Path
from unittest import mock

import pytest

from tools.logo_motion_tools import (
    _find_chrome,
    _inject_ids_into_svg,
    _resolve_source_image,
    _sanitize_motion_css,
    run_logo_motion,
    run_trace_logo_to_svg,
)


def test_find_chrome_respects_env():
    with tempfile.NamedTemporaryFile(suffix="chrome", delete=False) as f:
        f.write(b"")
        fake_bin = f.name
    try:
        with mock.patch.dict(os.environ, {"CHROME_BIN": fake_bin}):
            assert _find_chrome() == fake_bin
    finally:
        os.unlink(fake_bin)


def test_inject_ids_into_svg():
    with tempfile.TemporaryDirectory() as td:
        svg = Path(td) / "test.svg"
        svg.write_text(
            '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/><path d="M1 1"/></svg>',
            encoding="utf-8",
        )
        _inject_ids_into_svg(svg)
        text = svg.read_text(encoding="utf-8")
        assert 'id="p2m-path-1"' in text
        assert 'id="p2m-path-2"' in text


def test_resolve_source_image_from_api_media(tmp_path):
    project_root = Path(__file__).resolve().parent.parent
    outputs_dir = project_root / "storage" / "outputs"
    outputs_dir.mkdir(parents=True, exist_ok=True)
    fake_file = outputs_dir / "test_logo.png"
    fake_file.write_bytes(b"fake")
    try:
        path = _resolve_source_image("/api/media/test_logo.png")
        assert path == str(fake_file)
    finally:
        fake_file.unlink(missing_ok=True)


def test_run_trace_logo_to_svg_returns_error_for_missing_file():
    result = run_trace_logo_to_svg("/api/media/nonexistent_logo.png")
    assert result["success"] is False
    assert "error" in result


@mock.patch("tools.logo_motion_tools._generate_logo_motion_local")
@mock.patch("tools.logo_motion_tools._resolve_source_image")
def test_run_logo_motion_success(mock_resolve, mock_generate, tmp_path):
    work_dir = tmp_path / "p2m"
    work_dir.mkdir()
    outputs_dir = work_dir / "outputs"
    outputs_dir.mkdir()
    html = work_dir / "logo_motion.html"
    html.write_text("<html></html>")
    svg = work_dir / "logo.svg"
    svg.write_text('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>')
    css = work_dir / "motion.css"
    css.write_text("body{}")

    render_path = outputs_dir / "final_render.png"
    render_path.write_bytes(b"render")

    mock_resolve.return_value = str(tmp_path / "source.png")
    mock_generate.return_value = {
        "success": True,
        "svg_path": str(svg),
        "html_path": str(html),
        "css_path": str(css),
        "render_path": str(render_path),
        "strip_path": None,
        "metrics": {"iou": 0.95},
    }

    result = run_logo_motion(
        source_image_url="/api/media/source.png",
        motion_brief="淡入",
        style="subtle",
        duration_ms=1500,
    )
    assert result["success"] is True
    assert result["html_url"].startswith("/api/media/")
    assert result["svg_url"].startswith("/api/media/")
    assert result["metrics"]["iou"] == 0.95


@mock.patch("tools.logo_motion_tools._run_script")
@mock.patch("tools.logo_motion_tools._resolve_source_image")
def test_run_logo_motion_trace_failure(mock_resolve, mock_run):
    mock_resolve.return_value = "/tmp/source.png"
    mock_run.return_value = ("", "trace failed", 1)
    result = run_logo_motion(
        source_image_url="/api/media/source.png",
        motion_brief="淡入",
    )
    assert result["success"] is False
    assert "trace failed" in result["error"]


def test_sanitize_motion_css_strips_prefers_reduced_motion_blocks():
    css = """
#logo-root svg path { opacity: 0; }
@media (prefers-reduced-motion: no-preference) {
  #p2m-path-1 { animation: fade 1s forwards; }
  @keyframes fade { to { opacity: 1; } }
}
#logo-root svg path { fill: red; }
@media (prefers-reduced-motion: reduce) {
  * { animation: none !important; }
}
"""
    cleaned = _sanitize_motion_css(css)
    assert "prefers-reduced-motion" not in cleaned.lower()
    assert "@media" not in cleaned.lower()
    assert "#logo-root svg path" in cleaned


def test_sanitize_motion_css_keeps_unrelated_media_queries():
    css = """
@media (max-width: 600px) {
  #logo-root { width: 100px; }
}
#p2m-path-1 { animation: fade 1s; }
"""
    cleaned = _sanitize_motion_css(css)
    assert "@media (max-width: 600px)" in cleaned
    assert "prefers-reduced-motion" not in cleaned.lower()
