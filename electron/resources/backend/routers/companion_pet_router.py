"""FastAPI routes for desktop companion pet (Tauri sidecar)."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from agents.pet_service import (
    append_perception_context,
    get_pet_bootstrap,
    get_pet_status,
    get_wake_payload,
    stream_pet_chat,
)
from utils.logger import setup_logger

logger = setup_logger("companion_pet_router")


class PetChatMessage(BaseModel):
    role: str = "user"
    content: str = ""


class PetPerceptionContext(BaseModel):
    foreground_app: Optional[str] = None
    foreground_title: Optional[str] = None
    idle_seconds: Optional[int] = None
    clipboard_preview: Optional[str] = None
    clipboard_hash: Optional[str] = None
    clipboard_len: Optional[int] = None
    local_hour: Optional[int] = None


class PetChatRequestBody(BaseModel):
    messages: List[PetChatMessage] = Field(default_factory=list)
    input: Optional[str] = None
    perception: Optional[PetPerceptionContext] = None
    force_agent: bool = False


class PetContextBody(BaseModel):
    foreground_app: Optional[str] = None
    foreground_title: Optional[str] = None
    idle_seconds: Optional[int] = None
    clipboard_preview: Optional[str] = None
    clipboard_hash: Optional[str] = None
    clipboard_len: Optional[int] = None
    local_hour: Optional[int] = None


class PetWakeRequestBody(BaseModel):
    source: str = "manual"


async def api_pet_chat_stream(body: PetChatRequestBody) -> StreamingResponse:
    messages = [m.model_dump() for m in body.messages]
    perception = body.perception.model_dump(exclude_none=True) if body.perception else None

    async def event_generator():
        try:
            async for line in stream_pet_chat(
                messages=messages,
                user_input=body.input or "",
                perception=perception,
                force_agent=body.force_agent,
            ):
                yield line
        except Exception as exc:
            logger.error("pet chat stream failed: %s", exc, exc_info=True)
            from agents.sse_adapter import format_sse_event

            yield format_sse_event({"type": "error", "detail": str(exc)})
            yield format_sse_event({"type": "done"})

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


async def api_pet_context_post(body: PetContextBody) -> Dict[str, Any]:
    payload = body.model_dump(exclude_none=True)
    if not payload:
        raise HTTPException(status_code=400, detail="Empty perception context")
    return append_perception_context(payload)


async def api_pet_status_get() -> Dict[str, Any]:
    return get_pet_status()


async def api_pet_wake_post(body: PetWakeRequestBody) -> Dict[str, Any]:
    return get_wake_payload(body.source)


async def api_pet_bootstrap_get(source: str = "startup", fast: bool = True) -> Dict[str, Any]:
    return get_pet_bootstrap(source, fast=fast)


class PetTranscribeBody(BaseModel):
    audio_base64: str
    mime_type: str = "audio/webm"
    language: str = "zh"


def _mime_to_ext(mime_type: str) -> str:
    mime = (mime_type or "").lower().split(";")[0].strip()
    mapping = {
        "audio/webm": ".webm",
        "audio/ogg": ".ogg",
        "audio/mp4": ".mp4",
        "audio/mpeg": ".mp3",
        "audio/mp3": ".mp3",
        "audio/wav": ".wav",
        "audio/x-wav": ".wav",
        "audio/aac": ".aac",
    }
    return mapping.get(mime, ".webm")


def _pet_transcribe_fallback_file(audio_path: str, language: str) -> Dict[str, Any]:
    """GLM-ASR / Whisper fallback — expects wav-compatible file."""
    from tools.audio_tools import transcribe_audio_glm_asr, transcribe_audio_whisper

    glm = transcribe_audio_glm_asr(audio_path)
    if glm.get("success") and (glm.get("text") or "").strip():
        return glm

    whisper = transcribe_audio_whisper(audio_path, language=language or "zh")
    if whisper.get("success") and (whisper.get("text") or "").strip():
        return whisper

    detail = glm.get("error") or whisper.get("error") or "语音识别失败"
    return {"success": False, "error": detail}


async def api_pet_transcribe_status_get() -> Dict[str, Any]:
    """STT 诊断：API Key、ffmpeg 可用性（供桌宠排查语音识别失败）。"""
    import os
    import shutil

    from tools.audio_tools import resolve_ffmpeg_bins
    from tools.media_common import _get_provider_api_key

    alibaba_key = _get_provider_api_key("alibaba")
    zhipu_key = (os.getenv("ZHIPUAI_API_KEY") or "").strip()
    ffmpeg_bins = resolve_ffmpeg_bins()
    imageio_ffmpeg = None
    try:
        import imageio_ffmpeg

        imageio_ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        imageio_ffmpeg = None

    return {
        "ok": True,
        "has_alibaba_key": bool(alibaba_key),
        "has_zhipu_key": bool(zhipu_key),
        "primary_engine": "qwen3-asr-flash",
        "supports_webm_direct": True,
        "ffmpeg_bins": ffmpeg_bins[:3],
        "system_ffmpeg": shutil.which("ffmpeg"),
        "imageio_ffmpeg": imageio_ffmpeg,
    }


def _reload_stt_env() -> None:
    """Reload API keys from APP_DATA/backend/.env (user may configure without restart)."""
    import os
    from pathlib import Path

    from dotenv import load_dotenv

    home = (os.environ.get("AI_MEDIA_AGENT_HOME") or "").strip()
    if home:
        env_file = Path(home) / "backend" / ".env"
        if env_file.is_file():
            load_dotenv(env_file, override=True)
            return
    load_dotenv(override=True)


async def api_pet_transcribe_post(body: PetTranscribeBody) -> Dict[str, Any]:
    import base64
    import uuid
    from pathlib import Path

    from tools.audio_tools import convert_audio_to_wav, transcribe_audio_qwen_asr_bytes

    _reload_stt_env()

    raw = (body.audio_base64 or "").strip()
    if not raw:
        raise HTTPException(status_code=400, detail="缺少 audio_base64")

    try:
        audio_bytes = base64.b64decode(raw, validate=True)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"音频数据无效: {exc}") from exc

    if len(audio_bytes) < 280:
        raise HTTPException(status_code=400, detail="录音太短，请再说一次")

    language = body.language or "zh"
    mime_type = body.mime_type or "audio/webm"

    logger.info("pet STT request: %d bytes, mime=%s", len(audio_bytes), mime_type)

    # Primary: Qwen accepts browser webm/ogg directly — no ffmpeg required on Windows.
    qwen = transcribe_audio_qwen_asr_bytes(audio_bytes, mime_type, language)
    if qwen.get("success") and (qwen.get("text") or "").strip():
        logger.info("pet STT qwen ok: %s", (qwen.get("text") or "")[:80])
        return {"ok": True, "text": qwen["text"].strip(), "engine": "qwen3-asr-flash"}

    qwen_err = qwen.get("error") or ""
    if "未设置" in qwen_err or "API_KEY" in qwen_err:
        raise HTTPException(status_code=503, detail=qwen_err)

    logger.warning("pet STT qwen failed (%s), trying glm/whisper fallback: %s", mime_type, qwen_err)

    project_root = Path(__file__).resolve().parents[2]
    temp_dir = project_root / "storage" / "temp"
    temp_dir.mkdir(parents=True, exist_ok=True)

    ext = _mime_to_ext(mime_type)
    src_path = temp_dir / f"pet_stt_{uuid.uuid4().hex}{ext}"
    wav_path = src_path.with_suffix(".wav")
    src_path.write_bytes(audio_bytes)

    asr_path = src_path
    if ext != ".wav":
        converted = convert_audio_to_wav(str(src_path), str(wav_path))
        if converted.get("success"):
            asr_path = Path(converted.get("path") or wav_path)
        else:
            detail = converted.get("error") or "音频转码失败"
            logger.error("pet STT convert failed (%s → wav): %s", ext, detail)
            raise HTTPException(
                status_code=503,
                detail=qwen_err or f"语音识别失败（千问: {qwen_err}; 转码: {detail}）",
            )

    try:
        result = _pet_transcribe_fallback_file(str(asr_path), language)
        if not result.get("success"):
            err = result.get("error") or qwen_err or "语音识别失败"
            raise HTTPException(status_code=503, detail=err)
        text = (result.get("text") or "").strip()
        if not text:
            raise HTTPException(status_code=422, detail="未识别到语音内容")
        engine = result.get("model") or "fallback"
        return {"ok": True, "text": text, "engine": engine}
    finally:
        for path in (src_path, wav_path):
            try:
                path.unlink(missing_ok=True)
            except OSError:
                pass
