"""Tests for companion pet router and pet helpers."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from agents.pet_router import (
    classify_pet_route,
    looks_like_pet_agent,
    looks_like_pet_tools,
    pet_stage_from_care,
)
from agents.pet_tools_agent import coalesce_pet_turns
from agents.pet_service import (
    _normalize_pet_response,
    _parse_pet_json,
    append_perception_context,
    get_pet_bootstrap,
    get_wake_payload,
)


def test_coalesce_pet_turns_prefers_success_over_apology():
    turns = [
        "深圳今天 26-32°C，有雷阵雨，记得带伞哦～",
        "好像遇到了点小问题，没能查到深圳今天的天气…",
    ]
    out = coalesce_pet_turns(turns)
    assert "26" in out or "32" in out or "雷阵雨" in out
    assert "没能查到" not in out


def test_coalesce_pet_turns_adds_tip_on_pure_failure():
    turns = ["没能查到天气，请稍后再试。"]
    out = coalesce_pet_turns(turns)
    assert "没能查到" in out
    assert "💡" in out


def test_pet_stage_from_care():
    assert pet_stage_from_care(0) == "young"
    assert pet_stage_from_care(50) == "teen"
    assert pet_stage_from_care(200) == "evolved"


def test_classify_pet_route_short_chat(monkeypatch):
    monkeypatch.setattr("agents.pet_router.is_ollama_available", lambda: True)
    assert classify_pet_route("你好呀") == "local"


def test_classify_pet_route_agent_tools(monkeypatch):
    monkeypatch.setattr("agents.pet_router.is_ollama_available", lambda: True)
    assert classify_pet_route("帮我搜索一下最新的 AI 新闻并发布到小红书") == "agent"


def test_classify_pet_route_weather_uses_tools(monkeypatch):
    monkeypatch.setattr("agents.pet_router.is_ollama_available", lambda: True)
    assert classify_pet_route("今天深圳天气怎么样") == "tools"
    assert classify_pet_route("查一下北京气温") == "tools"
    assert looks_like_pet_tools("明天会下雨吗")


def test_classify_pet_route_media_generation(monkeypatch):
    """Image / video generation must reach the full agent even with filler words."""
    monkeypatch.setattr("agents.pet_router.is_ollama_available", lambda: True)
    from agents.pet_router import looks_like_media_generation

    media_queries = [
        "可以生成一段猫咪说话视频吗",
        "帮我画一张星空的图",
        "做个产品宣传短片",
        "生成图片",
        "给我整张海报",
    ]
    for q in media_queries:
        assert looks_like_media_generation(q), q
        assert classify_pet_route(q) == "agent", q

    # Non-media creation / chat must NOT be misrouted as media generation.
    assert not looks_like_media_generation("帮我想一个去澳门游玩的小红书文案")
    assert not looks_like_media_generation("今天天气怎么样")


def test_extract_pet_media_and_strip():
    from agents.pet_service import _extract_pet_media, _strip_media_noise

    text = (
        "✅ 图片生成成功！\n"
        "本地路径: /Users/x/storage/outputs/cat_123.png\n"
        "![cat](storage/outputs/cat_123.png)\n\n"
        "**供应商:** Jimeng"
    )
    media = _extract_pet_media(text)
    assert media == [{"type": "image", "url": "/media/cat_123.png"}]
    cleaned = _strip_media_noise(text)
    assert "storage/outputs" not in cleaned
    assert "本地路径" not in cleaned
    assert "图片生成成功" in cleaned

    video = _extract_pet_media("结果在 /media/clip_9.mp4 这里")
    assert video == [{"type": "video", "url": "/media/clip_9.mp4"}]

    assert _extract_pet_media("没有任何媒体的纯文本") == []


def test_prefetch_is_usable():
    from agents.pet_service import _prefetch_is_usable

    assert _prefetch_is_usable("x" * 50)
    assert not _prefetch_is_usable("short")
    assert not _prefetch_is_usable("No search results.")


def test_web_search_query_for_pet():
    from agents.pet_service import _web_search_query_for_pet

    q = _web_search_query_for_pet("今天深圳天气")
    assert "深圳" in q
    assert "天气" in q


def test_extract_city_from_query():
    from tools.weather_tools import extract_city_from_query

    assert extract_city_from_query("今天深圳天气") == "深圳"
    assert extract_city_from_query("北京气温怎么样") == "北京"


def test_is_pet_failure_reply():
    from agents.pet_tools_agent import is_pet_failure_reply

    assert is_pet_failure_reply("我暂时遇到了一些技术问题，无法直接获取")
    assert is_pet_failure_reply("今天深圳的天气信息我没有查到，建议主人可以查看手机")
    assert not is_pet_failure_reply("深圳今天 26-32°C，有雷阵雨")


def test_classify_pet_route_generate_image_uses_agent(monkeypatch):
    monkeypatch.setattr("agents.pet_router.is_ollama_available", lambda: True)
    assert classify_pet_route("帮我生成一张赛博朋克海报") == "agent"
    assert looks_like_pet_agent("帮我生成一张赛博朋克海报")


def test_classify_pet_route_casual_chat_stays_local(monkeypatch):
    monkeypatch.setattr("agents.pet_router.is_ollama_available", lambda: True)
    assert classify_pet_route("你好呀") == "local"
    assert classify_pet_route("今天有点累") == "local"


def test_classify_pet_route_long_text(monkeypatch):
    monkeypatch.setattr("agents.pet_router.is_ollama_available", lambda: True)
    long_text = "x" * 300
    assert classify_pet_route(long_text) == "agent"


def test_parse_pet_json_plain():
    raw = '{"action": "cheer_up", "text": "主人辛苦啦", "mood": "happy", "tool_hint": null}'
    parsed = _parse_pet_json(raw)
    assert parsed["action"] == "cheer_up"
    assert parsed["text"] == "主人辛苦啦"
    assert parsed["mood"] == "happy"


def test_parse_pet_json_with_markdown():
    raw = '好的～\n{"action": "talking", "text": "我在", "mood": "neutral", "tool_hint": null}'
    parsed = _parse_pet_json(raw)
    assert parsed["text"] == "我在"


def test_normalize_pet_response_invalid_action():
    out = _normalize_pet_response({"action": "fly", "text": "hi", "mood": "x"})
    assert out["action"] == "talking"
    assert out["mood"] == "neutral"


def test_append_perception_context(tmp_path, monkeypatch):
    log_path = tmp_path / "perception.jsonl"
    monkeypatch.setattr("agents.pet_service.PERCEPTION_LOG", log_path)
    result = append_perception_context({"foreground_app": "com.test.app", "idle_seconds": 10})
    assert result["success"] is True
    lines = log_path.read_text(encoding="utf-8").strip().splitlines()
    assert len(lines) == 1
    row = json.loads(lines[0])
    assert row["foreground_app"] == "com.test.app"


def test_get_wake_payload_startup_skips_dream():
    payload = get_wake_payload("startup", include_dream=False)
    assert payload["text"]
    assert payload["source"] == "startup"


def test_get_pet_bootstrap_combined():
    data = get_pet_bootstrap("startup", fast=True)
    assert "companion" in data
    assert "wake" in data
    assert data["wake"]["text"]


def test_get_wake_payload_scheduler_nudge():
    from core.companion_state import companion_state_store

    companion_state_store.patch_state(
        {
            "append_feedback": {
                "kind": "scheduler_nudge",
                "text": "到你约定的陪伴提醒时间啦，休息一下",
            },
            "persona": {"name": "波尼"},
        }
    )
    payload = get_wake_payload("tray")
    assert "休息" in payload["text"] or "陪伴" in payload["text"]
    assert payload["wake_reason"] == "scheduler"
    assert payload["source"] == "tray"


def test_get_wake_payload_default_name():
    payload = get_wake_payload("startup")
    assert payload["text"]
    assert payload["action"] in {
        "cheer_up",
        "thinking",
        "idle",
        "celebrate",
        "remind_drink",
        "talking",
    }


@pytest.mark.anyio
async def test_pet_chat_stream_metadata(monkeypatch):
    from agents.pet_service import stream_pet_chat

    async def fake_local(*, system, user_text, route, streaming):
        yield '{"action":"talking","text":"嗨","mood":"happy","tool_hint":null}'

    monkeypatch.setattr("agents.pet_router.is_ollama_available", lambda: True)
    monkeypatch.setattr("agents.pet_service._invoke_local_or_cloud", fake_local)
    monkeypatch.setattr("agents.pet_service._prefetch_memory", lambda *a, **k: "")
    monkeypatch.setattr("agents.pet_service.get_companion_state", lambda: {"persona": {}, "pet": {}, "growth": {}, "mood": {}})
    monkeypatch.setattr("agents.pet_service.patch_companion_state", lambda *a, **k: {})

    events = []
    async for line in stream_pet_chat(messages=[], user_input="你好"):
        if line.startswith("data:"):
            events.append(json.loads(line[5:].strip()))

    types = [e.get("type") for e in events]
    assert "metadata" in types
    assert "pet_response" in types
    assert events[-1]["type"] == "done"


def test_pet_transcribe_rejects_empty():
    import asyncio

    from routers.companion_pet_router import PetTranscribeBody, api_pet_transcribe_post
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as exc:
        asyncio.run(api_pet_transcribe_post(PetTranscribeBody(audio_base64="")))
    assert exc.value.status_code == 400


def test_pet_transcribe_rejects_short_audio():
    import asyncio
    import base64

    from routers.companion_pet_router import PetTranscribeBody, api_pet_transcribe_post
    from fastapi import HTTPException

    tiny = base64.b64encode(b"x" * 10).decode()
    with pytest.raises(HTTPException) as exc:
        asyncio.run(api_pet_transcribe_post(PetTranscribeBody(audio_base64=tiny)))
    assert exc.value.status_code == 400


def test_pet_transcribe_prefers_qwen_asr(monkeypatch, tmp_path):
    """Pet STT should try Qwen (DashScope) bytes API before GLM fallback."""
    import asyncio
    import base64

    from routers.companion_pet_router import PetTranscribeBody, api_pet_transcribe_post

    wav = tmp_path / "hello.wav"
    # minimal wav header + payload (>800 bytes total for router)
    wav.write_bytes(b"RIFF" + b"\x00" * 40 + b"WAVEfmt " + b"\x00" * 900)

    order: list[str] = []

    def fake_qwen_bytes(audio_bytes: bytes, mime_type: str = "audio/webm", language: str = "zh"):
        order.append("qwen")
        return {"success": True, "text": "千问识别", "model": "qwen3-asr-flash"}

    def fake_glm(path: str):
        order.append("glm")
        return {"success": False, "error": "should not reach"}

    monkeypatch.setattr(
        "tools.audio_tools.transcribe_audio_qwen_asr_bytes",
        fake_qwen_bytes,
    )
    monkeypatch.setattr("tools.audio_tools.transcribe_audio_glm_asr", fake_glm)

    payload = base64.b64encode(wav.read_bytes()).decode()
    out = asyncio.run(
        api_pet_transcribe_post(
            PetTranscribeBody(audio_base64=payload, mime_type="audio/webm", language="zh")
        )
    )
    assert out["ok"] is True
    assert out["text"] == "千问识别"
    assert out["engine"] == "qwen3-asr-flash"
    assert order == ["qwen"]


def test_pet_transcribe_webm_uses_qwen_directly(monkeypatch, tmp_path):
    """webm goes to Qwen bytes API directly — no ffmpeg conversion required."""
    import asyncio
    import base64
    import shutil

    from routers.companion_pet_router import PetTranscribeBody, api_pet_transcribe_post

    wav_src = Path(__file__).resolve().parents[1] / "storage" / "temp" / "stt_probe.wav"
    if not wav_src.exists():
        pytest.skip("need storage/temp/stt_probe.wav (run STT probe once)")

    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        try:
            import imageio_ffmpeg

            ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
        except Exception:
            ffmpeg = None
    if not ffmpeg:
        pytest.skip("ffmpeg unavailable")

    webm = tmp_path / "probe.webm"
    import subprocess

    subprocess.run(
        [ffmpeg, "-y", "-i", str(wav_src), "-c:a", "libopus", str(webm)],
        check=True,
        capture_output=True,
    )
    payload = base64.b64encode(webm.read_bytes()).decode()

    seen: dict = {}

    def fake_qwen_bytes(audio_bytes: bytes, mime_type: str = "audio/webm", language: str = "zh"):
        seen["mime"] = mime_type
        seen["size"] = len(audio_bytes)
        return {"success": True, "text": "ok", "model": "qwen3-asr-flash"}

    monkeypatch.setattr(
        "tools.audio_tools.transcribe_audio_qwen_asr_bytes",
        fake_qwen_bytes,
    )

    out = asyncio.run(
        api_pet_transcribe_post(
            PetTranscribeBody(audio_base64=payload, mime_type="audio/webm;codecs=opus", language="zh")
        )
    )
    assert out["ok"] is True
    assert out["text"] == "ok"
    assert seen["mime"].startswith("audio/webm")
    assert seen["size"] > 800
