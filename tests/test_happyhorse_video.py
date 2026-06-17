"""
HappyHorse（欢乐马）视频生成：请求体与 i2v 模型映射。
"""
import os
import sys

sys.path.append(os.path.join(os.path.dirname(__file__), "..", "backend"))


def test_happyhorse_t2v_request_body():
    from tools import video_tools

    body = video_tools._dashscope_video_request_body("一只猫在草地上奔跑", "happyhorse-1.0-t2v")
    assert body["model"] == "happyhorse-1.0-t2v"
    assert body["input"]["prompt"] == "一只猫在草地上奔跑"
    assert body["parameters"]["resolution"] == "720P"
    assert body["parameters"]["ratio"] == "16:9"
    assert body["parameters"]["duration"] == 5
    assert body["parameters"]["watermark"] is False
    assert "prompt_extend" not in body["parameters"]


def test_happyhorse_i2v_request_body_uses_media_first_frame():
    from tools import video_tools

    body = video_tools._dashscope_i2v_video_request_body(
        "data:image/png;base64,abc",
        "动起来",
        "happyhorse-1.0-i2v",
    )
    assert body["model"] == "happyhorse-1.0-i2v"
    assert body["input"]["media"] == [{"type": "first_frame", "url": "data:image/png;base64,abc"}]
    assert "img_url" not in body["input"]
    assert body["parameters"]["resolution"] == "720P"
    assert "ratio" not in body["parameters"]


def test_happyhorse_t2v_maps_to_i2v_model():
    from tools import video_tools

    assert video_tools._dashscope_resolve_i2v_model("happyhorse-1.0-t2v") == "happyhorse-1.0-i2v"
    assert video_tools._dashscope_resolve_i2v_model("happyhorse-1.0-i2v") == "happyhorse-1.0-i2v"


def test_media_models_include_happyhorse():
    from core.media_models import LOCAL_MODELS

    ids = [m["id"] for m in LOCAL_MODELS["video"]]
    assert "alibaba/happyhorse-1.0-t2v" in ids
    assert "alibaba/happyhorse-1.0-i2v" in ids


def test_happyhorse_dedicated_t2v_request_body():
    from tools import video_tools

    body = video_tools._happyhorse_t2v_request_body(
        "测试",
        duration=8,
        resolution="1080P",
        ratio="9:16",
        watermark=True,
        seed=42,
    )
    assert body["model"] == "happyhorse-1.0-t2v"
    assert body["parameters"]["duration"] == 8
    assert body["parameters"]["resolution"] == "1080P"
    assert body["parameters"]["ratio"] == "9:16"
    assert body["parameters"]["watermark"] is True
    assert body["parameters"]["seed"] == 42


def test_happyhorse_dedicated_i2v_request_body():
    from tools import video_tools

    body = video_tools._happyhorse_i2v_request_body(
        "data:image/png;base64,xx",
        "动起来",
        duration=10,
        resolution="720P",
    )
    assert body["model"] == "happyhorse-1.0-i2v"
    assert body["input"]["media"][0]["type"] == "first_frame"
    assert body["parameters"]["duration"] == 10
