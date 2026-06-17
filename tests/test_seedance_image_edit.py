"""Tests for SeaDance image-to-image / upscale adapter."""

import os
import sys
from unittest.mock import Mock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))


def test_seedance_model_registered():
    from core.media_models import get_all_media_models

    models = get_all_media_models()["image_edit"]
    ids = {m["id"] for m in models}
    assert "seedance/gpt-image-2-image-to-image" in ids


def test_image_edit_cross_provider_selection():
    """LLM provider=alibaba 时，image_edit 仍可选中 seedance 模型。"""
    from core.media_models import get_all_media_models, get_current_media_model

    with patch.dict(os.environ, {"LLM_PROVIDER": "alibaba"}):
        selected = get_current_media_model("image_edit")
    # 默认仍应是万相；但我们要确认 seedance 模型在候选中
    all_models = {m["id"] for m in get_all_media_models()["image_edit"]}
    assert "seedance/gpt-image-2-image-to-image" in all_models
    # 确认万相仍是默认选中
    assert selected["id"] == "alibaba/wanx2.1-imageedit"


def test_edit_via_seedance_missing_key():
    from tools.image_edit_tools import _edit_via_seedance

    with patch("tools.image_edit_tools._get_provider_api_key", return_value=None):
        result = _edit_via_seedance(
            model_id="gpt-image-2-image-to-image",
            mode="upscale",
            prompt="upscale",
            source_image_url="https://example.com/img.png",
        )
    assert result["success"] is False
    assert "SEEDANCE_API_KEY" in result["error"]


def test_edit_via_seedance_success_flow():
    from tools.image_edit_tools import _edit_via_seedance

    mock_submit = Mock()
    mock_submit.json.return_value = {"taskId": "task-123", "state": "success"}
    mock_submit.raise_for_status.return_value = None

    mock_poll = Mock()
    mock_poll.json.return_value = {
        "taskId": "task-123",
        "state": "success",
        "video_urls": ["https://example.com/out.png"],
    }
    mock_poll.raise_for_status.return_value = None

    with patch("tools.image_edit_tools._get_provider_api_key", return_value="sk-test"):
        with patch("tools.image_edit_tools.requests.post", return_value=mock_submit):
            with patch("tools.image_edit_tools.requests.get", return_value=mock_poll):
                with patch(
                    "tools.image_edit_tools.download_file",
                    return_value="/tmp/seedance_out.png",
                ):
                    result = _edit_via_seedance(
                        model_id="gpt-image-2-image-to-image",
                        mode="upscale",
                        prompt="upscale",
                        source_image_url="https://example.com/img.png",
                    )

    assert result["success"] is True
    assert result["url"] == "https://example.com/out.png"
    assert result["local_path"] == "/tmp/seedance_out.png"
    assert result["model"] == "gpt-image-2-image-to-image"


def test_edit_via_seedance_task_fail():
    from tools.image_edit_tools import _edit_via_seedance

    mock_submit = Mock()
    mock_submit.json.return_value = {"taskId": "task-123"}
    mock_submit.raise_for_status.return_value = None

    mock_poll = Mock()
    mock_poll.json.return_value = {
        "taskId": "task-123",
        "state": "fail",
        "failCode": "500",
        "failMsg": "Task execution timed out",
    }
    mock_poll.raise_for_status.return_value = None

    with patch("tools.image_edit_tools._get_provider_api_key", return_value="sk-test"):
        with patch("tools.image_edit_tools.requests.post", return_value=mock_submit):
            with patch("tools.image_edit_tools.requests.get", return_value=mock_poll):
                result = _edit_via_seedance(
                    model_id="gpt-image-2-image-to-image",
                    mode="upscale",
                    prompt="upscale",
                    source_image_url="https://example.com/img.png",
                )

    assert result["success"] is False
    assert "Task execution timed out" in result["error"]
