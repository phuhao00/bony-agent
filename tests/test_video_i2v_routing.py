"""
图生视频供应商路由：`alibaba` 必须走 DashScope，不可用 Zhipu 客户端误用 DashScope Key。
"""
import base64
import sys
import os
from unittest.mock import patch, MagicMock

sys.path.append(os.path.join(os.path.dirname(__file__), "..", "backend"))


def test_i2v_alibaba_calls_dashscope_not_zhipu():
    from tools import video_tools

    fake_sel = {
        "provider": "alibaba",
        "api_type": "dashscope_wan_video",
        "model_id": "wan2.6-i2v-flash",
    }
    dash_ret = {
        "success": True,
        "url": "https://example.com/generated.mp4",
        "local_path": os.path.join(
            os.path.dirname(__file__), "..", "storage", "outputs", "unit_test_vid.mp4"
        ),
        "model": "wan2.6-i2v-flash",
    }

    with patch.object(video_tools, "_resolve_provider", return_value=("alibaba", False)), \
            patch.object(video_tools, "_get_provider_api_key", return_value="sk-test-alibaba-only"), \
            patch(
                "core.media_models.get_current_media_model",
                return_value=fake_sel,
            ), \
            patch.object(
                video_tools,
                "_dashscope_generate_video_from_image",
                return_value=dash_ret,
            ) as mock_ds, \
            patch.object(video_tools, "add_generation_record"), \
            patch.object(video_tools, "ZhipuAI") as mock_zhipu_cls:
        out = video_tools.generate_video_from_image_internal(
            "https://public.example/ref.png",
            prompt="动起来",
        )

    mock_ds.assert_called_once_with(
        "https://public.example/ref.png",
        "动起来",
        "wan2.6-i2v-flash",
    )
    mock_zhipu_cls.assert_not_called()
    assert "✅ 图生视频成功" in out
    assert "通义 (DashScope)" in out


def test_i2v_openrouter_returns_unsupported_without_zhipu():
    from tools import video_tools

    with patch.object(video_tools, "_resolve_provider", return_value=("openrouter", False)), \
            patch.object(video_tools, "_get_provider_api_key", return_value="sk-or"), \
            patch.object(video_tools, "ZhipuAI") as mock_zhipu_cls:
        out = video_tools.generate_video_from_image_internal(
            "https://x/img.png",
            prompt="hi",
        )

    mock_zhipu_cls.assert_not_called()
    assert "暂不支持程序化图生视频" in out
    assert "[openrouter]" in out


def test_i2v_zhipu_uses_zhipu_client(monkeypatch):
    from tools import video_tools

    mock_client = MagicMock()
    mock_client.videos.generations.return_value = MagicMock(id="task-zzz")

    monkeypatch.setattr(video_tools, "_resolve_provider", lambda c: ("zhipu", False))
    monkeypatch.setattr(video_tools, "_get_provider_api_key", lambda p: "zhipu-key")

    constructed = []

    class FakeZhipu:
        def __init__(self, api_key):
            constructed.append(api_key)
            self.videos = mock_client.videos

    monkeypatch.setattr(video_tools, "ZhipuAI", FakeZhipu)

    monkeypatch.setattr(
        video_tools,
        "_wait_for_video_task",
        lambda client, tid, pr: "✅ mocked zhipu result",
    )

    out = video_tools.generate_video_from_image_internal(
        "https://cdn.example/p.png",
        prompt="zoom in",
    )
    assert constructed == ["zhipu-key"]
    mock_client.videos.generations.assert_called_once()
    kw = mock_client.videos.generations.call_args.kwargs
    assert kw["model"] == "cogvideox"
    assert kw["image_url"] == "https://cdn.example/p.png"
    assert kw["prompt"] == "zoom in"
    assert out == "✅ mocked zhipu result"


def test_prepare_i2v_inline_http_localhost_when_file_in_upload_dir(tmp_path):
    """localhost 上传 URL + 磁盘已有同名 uploads 文件 → DashScope 用 data URI，无需公网拉取"""
    from tools import video_tools

    blob = base64.b64decode(
        "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
    )
    name = "f47ac10b-58cc-4372-a567-0e02b2c3d479.gif"
    (tmp_path / name).write_bytes(blob)
    url = f"http://127.0.0.1:8000/uploads/{name}?v=1"
    out = video_tools._dashscope_prepare_i2v_image_url(url, upload_dir=str(tmp_path))
    assert out.startswith("data:image/gif;base64,")
    assert ";base64," in out


def test_prepare_i2v_inline_relative_uploads_path(tmp_path):
    from tools import video_tools

    blob = b"\xff\xd8\xff\xdb\x00\x43\x00\xff\xd9"
    name = "face-beef-feed-cafe-upload.jpg"
    (tmp_path / name).write_bytes(blob)
    url = f"/uploads/{name}"
    out = video_tools._dashscope_prepare_i2v_image_url(url, upload_dir=str(tmp_path))
    assert out.startswith("data:image/jpeg;base64,")


def test_prepare_i2v_passthrough_missing_local_file(tmp_path):
    """文件不在本机 uploads 目录则保持原 URL（由上游或 CDN 场景处理）"""
    from tools import video_tools

    u = "http://localhost:9999/uploads/not-on-disk.webp"
    assert video_tools._dashscope_prepare_i2v_image_url(u, upload_dir=str(tmp_path)) == u


def test_prepare_i2v_passthrough_non_uploads_https(tmp_path):
    from tools import video_tools

    u = "https://example.com/dir/pic.png"
    assert video_tools._dashscope_prepare_i2v_image_url(u, upload_dir=str(tmp_path)) == u
