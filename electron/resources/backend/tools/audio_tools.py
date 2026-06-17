"""
音频工具 — 独立模块
支持功能: TTS (语音合成), ASR (语音识别), 音频处理
"""
import os
import sys
import uuid
import shutil
import subprocess
import base64
from typing import Any, Dict, List, Optional
from openai import OpenAI as OpenAIClient
from utils.logger import setup_logger

from tools.media_common import (
    _resolve_provider, _check_provider_capability, _get_provider_api_key,
    _get_provider_base_url, OUTPUT_DIR, PROJECT_ROOT,
    create_zhipu_client,
    dashscope_api_root,
    get_video_duration
)

logger = setup_logger("audio_tools")

# 尝试导入Whisper用于本地语音识别
try:
    import whisper
    WHISPER_AVAILABLE = True
except ImportError:
    WHISPER_AVAILABLE = False

_WHISPER_MODEL = None
_WHISPER_MODEL_NAME = "base"


# ===================== 常量定义 =====================

# 预设背景音乐目录
BGM_DIR = os.path.join(PROJECT_ROOT, "backend", "assets", "bgm")
os.makedirs(BGM_DIR, exist_ok=True)

# 预设背景音乐列表
PRESET_BGM = {
    "relaxing": {"name": "舒缓轻音乐", "file": "relaxing.mp3"},
    "upbeat": {"name": "欢快节奏", "file": "upbeat.mp3"},
    "cinematic": {"name": "电影感配乐", "file": "cinematic.mp3"},
    "emotional": {"name": "情感抒情", "file": "emotional.mp3"},
    "energetic": {"name": "动感活力", "file": "energetic.mp3"},
}

# 语音类型列表
VOICE_OPTIONS = [
    {"id": "zh-CN-XiaoxiaoNeural", "name": "晓晓（女声，温柔）", "gender": "female"},
    {"id": "zh-CN-YunxiNeural", "name": "云希（男声，阳光）", "gender": "male"},
    {"id": "zh-CN-YunjianNeural", "name": "云健（男声，沉稳）", "gender": "male"},
    {"id": "zh-CN-XiaoyiNeural", "name": "晓伊（女声，活泼）", "gender": "female"},
    {"id": "zh-CN-YunyangNeural", "name": "云扬（男声，新闻）", "gender": "male"},
    {"id": "zh-CN-XiaochenNeural", "name": "晓辰（女声，知性）", "gender": "female"},
]

# 旁白风格列表
NARRATION_STYLES = [
    {"id": "informative", "name": "专业解说", "description": "清晰、专业、有条理"},
    {"id": "emotional", "name": "情感叙述", "description": "温暖、感人、富有感染力"},
    {"id": "energetic", "name": "活力主持", "description": "热情、活泼、充满能量"},
    {"id": "poetic", "name": "诗意文艺", "description": "优美、意境、文艺范"},
]


# ===================== 语音合成 (TTS) =====================

def generate_speech(
    text: str,
    voice: str = "alloy",
    output_name: str = ""
) -> Dict:
    """
    使用AI生成语音配音（智能备选）
    
    优先使用当前 LLM 供应商的 TTS，不支持时自动备选:
    - zhipu / openai: 原生 TTS API
    - 其他:           自动备选到有 Key 的 TTS 供应商，或 Edge TTS (免费)
    """
    provider, is_fallback = _resolve_provider("tts")

    if not output_name:
        output_name = f"speech_{uuid.uuid4()}.mp3"
    output_path = os.path.join(OUTPUT_DIR, output_name)

    logger.info(f"Generating speech: provider={provider}, fallback={is_fallback}, voice={voice}")

    # 没有支持 TTS 的供应商 → Edge TTS
    if not _check_provider_capability(provider, "tts"):
        logger.info("No TTS-capable provider available, using Edge TTS.")
        return generate_speech_edge_tts(text, voice, output_name)

    api_key = _get_provider_api_key(provider)
    if not api_key:
        logger.warning(f"Provider [{provider}] API Key missing, using Edge TTS.")
        return generate_speech_edge_tts(text, voice, output_name)

    try:
        if provider == "openai":
            client = OpenAIClient(
                api_key=api_key,
                base_url=_get_provider_base_url("openai"),
            )
            response = client.audio.speech.create(
                model="tts-1",
                voice=voice if voice in ["alloy", "echo", "fable", "onyx", "nova", "shimmer"] else "alloy",
                input=text,
            )
            response.stream_to_file(output_path)

        elif provider == "zhipu":
            client = create_zhipu_client(api_key)
            response = client.audio.speech.create(
                model="tts-1",
                input=text,
                voice=voice,
            )
            if hasattr(response, "content"):
                with open(output_path, "wb") as f:
                    f.write(response.content)
            elif hasattr(response, "stream_to_file"):
                response.stream_to_file(output_path)
            else:
                return {"success": False, "error": "无法获取音频数据 (Zhipu)"}

        else:
            return generate_speech_edge_tts(text, voice, output_name)

        fb_note = f" (备选:{provider})" if is_fallback else ""
        logger.info(f"Speech generated ({provider}{fb_note}): {output_path}")
        return {
            "success": True,
            "local_path": output_path,
            "text": text,
            "provider": provider,
            "is_fallback": is_fallback,
        }

    except Exception as e:
        logger.error(f"Speech generation error ({provider}): {e}")
        logger.info("Falling back to Edge TTS...")
        return generate_speech_edge_tts(text, voice, output_name)


def generate_speech_edge_tts(
    text: str,
    voice: str = "zh-CN-XiaoxiaoNeural",
    output_name: str = ""
) -> Dict:
    """使用Edge TTS生成语音（备选方案）"""
    try:
        import edge_tts
        import asyncio
        
        if not output_name:
            output_name = f"speech_{uuid.uuid4()}.mp3"
        output_path = os.path.join(OUTPUT_DIR, output_name)
        
        # 简化版：直接定义协程并运行
        async def generate():
            communicate = edge_tts.Communicate(text, voice)
            await communicate.save(output_path)
        
        # 处理事件循环问题
        try:
            # 检查是否有正在运行的循环
            loop = asyncio.get_running_loop()
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as executor:
                future = executor.submit(asyncio.run, generate())
                future.result(timeout=60)
        except RuntimeError:
            asyncio.run(generate())
        
        logger.info(f"Speech generated (Edge TTS): {output_path}")
        return {
            "success": True,
            "local_path": output_path,
            "text": text,
            "engine": "edge_tts"
        }
    except ImportError:
        logger.warning("edge-tts not installed, trying pyttsx3")
        return generate_speech_pyttsx3(text, output_name)
    except Exception as e:
        logger.error(f"Edge TTS error: {e}")
        return {"success": False, "error": str(e)}


def generate_speech_pyttsx3(text: str, output_name: str = "") -> Dict:
    """使用pyttsx3生成语音（本地备选）"""
    try:
        import pyttsx3
        
        if not output_name:
            output_name = f"speech_{uuid.uuid4()}.mp3"
        output_path = os.path.join(OUTPUT_DIR, output_name)
        
        engine = pyttsx3.init()
        engine.save_to_file(text, output_path)
        engine.runAndWait()
        
        return {
            "success": True,
            "local_path": output_path,
            "text": text,
            "engine": "pyttsx3"
        }
    except Exception as e:
        logger.error(f"pyttsx3 error: {e}")
        return {"success": False, "error": f"语音合成失败: {e}"}


def generate_narration_script(client: Any, video_description: str, style: str = "informative") -> str:
    """使用AI生成视频旁白脚本"""
    style_prompts = {
        "informative": "专业、清晰、有条理的解说风格",
        "emotional": "富有情感、温暖、感人的叙述风格",
        "energetic": "活力四射、热情洋溢的主持风格",
        "poetic": "诗意、优美、富有意境的文艺风格"
    }
    
    style_desc = style_prompts.get(style, style_prompts["informative"])
    
    prompt = f"""请为以下视频内容创作一段旁白/解说词。

## 视频内容：
{video_description}

## 要求：
1. 风格：{style_desc}
2. 时长：约15-30秒的朗读量（50-100字）
3. 语言自然流畅，适合配音朗读
4. 与视频内容紧密配合

请直接输出旁白文本，不要包含任何格式标记或说明。"""

    try:
        response = client.chat.completions.create(
            model="glm-4-plus",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=500
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        logger.error(f"Narration script generation failed: {e}")
        return ""


# ===================== 音频处理 =====================

def add_audio_to_video(
    video_path: str,
    audio_path: str = "",
    bgm_path: str = "",
    bgm_volume: float = 0.3,
    narration_volume: float = 1.0,
    output_name: str = ""
) -> Dict:
    """为视频添加音频（配音和/或背景音乐）"""
    if not shutil.which("ffmpeg"):
        return {"success": False, "error": "系统未安装 FFmpeg"}
    
    if not os.path.exists(video_path):
        return {"success": False, "error": f"视频文件不存在: {video_path}"}
    
    if not audio_path and not bgm_path:
        return {"success": False, "error": "请提供配音或背景音乐"}
    
    if not output_name:
        output_name = f"video_with_audio_{uuid.uuid4()}.mp4"
    output_path = os.path.join(OUTPUT_DIR, output_name)
    
    try:
        # 获取视频时长
        video_duration = get_video_duration(video_path)
        
        # 构建FFmpeg命令
        inputs = ['-i', video_path]
        filter_parts = []
        audio_streams = []
        
        stream_idx = 1
        
        # 添加配音
        if audio_path and os.path.exists(audio_path):
            inputs.extend(['-i', audio_path])
            filter_parts.append(f"[{stream_idx}:a]volume={narration_volume}[narration]")
            audio_streams.append("[narration]")
            stream_idx += 1
        
        # 添加背景音乐
        if bgm_path and os.path.exists(bgm_path):
            inputs.extend(['-i', bgm_path])
            # 循环背景音乐以匹配视频时长，并调整音量
            filter_parts.append(
                f"[{stream_idx}:a]aloop=loop=-1:size=2e+09,atrim=0:{video_duration},volume={bgm_volume}[bgm]"
            )
            audio_streams.append("[bgm]")
            stream_idx += 1
        
        # 混合音频
        if len(audio_streams) > 1:
            mix_inputs = "".join(audio_streams)
            filter_parts.append(f"{mix_inputs}amix=inputs={len(audio_streams)}:duration=first[aout]")
            audio_output = "[aout]"
        elif len(audio_streams) == 1:
            audio_output = audio_streams[0]
        else:
            return {"success": False, "error": "无有效音频源"}
        
        # 构建完整的filter_complex
        filter_complex = ";".join(filter_parts)
        
        cmd = [
            'ffmpeg', '-y',
            *inputs,
            '-filter_complex', filter_complex,
            '-map', '0:v',
            '-map', audio_output,
            '-c:v', 'copy',
            '-c:a', 'aac',
            '-shortest',
            output_path
        ]
        
        logger.info(f"Running FFmpeg: {' '.join(cmd)}")
        result = subprocess.run(cmd, capture_output=True, text=True)
        
        if result.returncode != 0:
            logger.error(f"FFmpeg error: {result.stderr}")
            return {"success": False, "error": f"音视频合成失败: {result.stderr[:200]}"}
        
        if os.path.exists(output_path):
            return {
                "success": True,
                "local_path": output_path,
                "has_narration": bool(audio_path),
                "has_bgm": bool(bgm_path)
            }
        else:
            return {"success": False, "error": "输出文件未生成"}
            
    except Exception as e:
        logger.error(f"Add audio error: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


def extract_audio_from_video(video_path: str, output_path: str = "") -> Dict:
    """从视频中提取音频"""
    if not os.path.exists(video_path):
        return {"success": False, "error": f"视频文件不存在: {video_path}"}
    
    try:
        if not output_path:
            base_name = os.path.splitext(os.path.basename(video_path))[0]
            output_path = os.path.join(OUTPUT_DIR, f"{base_name}_audio.wav")
        
        cmd = [
            "ffmpeg", "-y",
            "-i", video_path,
            "-vn",  # 不要视频
            "-acodec", "pcm_s16le",  # PCM格式，Whisper需要
            "-ar", "16000",  # 16kHz采样率
            "-ac", "1",  # 单声道
            output_path
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True)
        
        if result.returncode != 0:
            return {"success": False, "error": result.stderr}
        
        return {"success": True, "audio_path": output_path}
        
    except Exception as e:
        return {"success": False, "error": str(e)}


# ===================== 语音识别 (ASR) =====================

def _get_whisper_model(model_name: str = "base"):
    """Lazy-load Whisper once per process to avoid repeated ~150MB allocations."""
    global _WHISPER_MODEL, _WHISPER_MODEL_NAME
    if not WHISPER_AVAILABLE:
        raise RuntimeError("Whisper未安装")
    if _WHISPER_MODEL is None or model_name != _WHISPER_MODEL_NAME:
        logger.info("Loading Whisper model: %s", model_name)
        _WHISPER_MODEL = whisper.load_model(model_name)
        _WHISPER_MODEL_NAME = model_name
    return _WHISPER_MODEL


def transcribe_audio_whisper(audio_path: str, language: str = "zh") -> Dict:
    """使用Whisper进行本地语音识别"""
    if not WHISPER_AVAILABLE:
        return {"success": False, "error": "Whisper未安装，请运行: pip install openai-whisper"}
    
    if not os.path.exists(audio_path):
        return {"success": False, "error": f"音频文件不存在: {audio_path}"}
    
    try:
        logger.info(f"使用Whisper识别音频: {audio_path}")
        model = _get_whisper_model("base")
        result = model.transcribe(
            audio_path,
            language=language,
            word_timestamps=True,
            verbose=False
        )
        
        segments = []
        for seg in result.get("segments", []):
            segments.append({
                "start": seg["start"],
                "end": seg["end"],
                "text": seg["text"].strip()
            })
        
        return {
            "success": True,
            "text": result.get("text", ""),
            "segments": segments,
            "language": result.get("language", language)
        }
        
    except Exception as e:
        logger.error(f"Whisper识别失败: {e}")
        return {"success": False, "error": str(e)}


def _extract_glm_asr_text(response: Any) -> str:
    """Pull transcript text out of a Zhipu audio.transcriptions response."""
    # GLM-ASR usually puts the transcript in top-level `.text`; `choices` is often None.
    text = getattr(response, "text", None)
    if isinstance(text, str) and text.strip():
        return text.strip()

    if hasattr(response, "model_dump"):
        try:
            data = response.model_dump()
            dumped = data.get("text")
            if isinstance(dumped, str) and dumped.strip():
                return dumped.strip()
        except Exception:  # noqa: BLE001
            pass

    choices = getattr(response, "choices", None) or []
    if choices:
        message = getattr(choices[0], "message", None)
        content = getattr(message, "content", None) if message else None
        if isinstance(content, str) and content.strip():
            return content.strip()

    legacy = getattr(response, "text", None)
    if isinstance(legacy, str):
        return legacy.strip()
    return ""


def resolve_ffmpeg_bins() -> List[str]:
    """Return ffmpeg executables to try (imageio bundle first on Windows, then system PATH)."""
    bins: List[str] = []
    bundled = None
    try:
        import imageio_ffmpeg

        bundled = imageio_ffmpeg.get_ffmpeg_exe()
    except Exception as exc:  # noqa: BLE001
        logger.debug("imageio-ffmpeg unavailable: %s", exc)

    system = shutil.which("ffmpeg")
    if sys.platform == "win32":
        if bundled:
            bins.append(bundled)
        if system and system not in bins:
            bins.append(system)
    else:
        if system:
            bins.append(system)
        if bundled and bundled not in bins:
            bins.append(bundled)
    return bins


def convert_audio_to_wav(src_path: str, dst_path: str, sample_rate: int = 16000) -> Dict:
    """Convert browser/container audio (webm/ogg/mp4/…) to 16 kHz mono wav for ASR."""
    if not os.path.exists(src_path):
        return {"success": False, "error": f"音频文件不存在: {src_path}"}

    src_lower = src_path.lower()
    if src_lower.endswith(".wav"):
        try:
            if os.path.getsize(src_path) > 44:
                shutil.copy2(src_path, dst_path)
                return {"success": True, "path": dst_path}
        except OSError as exc:
            return {"success": False, "error": str(exc)}

    ffmpeg_bins = resolve_ffmpeg_bins()
    if not ffmpeg_bins:
        return {
            "success": False,
            "error": "缺少 ffmpeg（请 pip install imageio-ffmpeg 或安装系统 ffmpeg）",
        }

    last_err = ""
    for ffmpeg in ffmpeg_bins:
        try:
            proc = subprocess.run(
                [
                    ffmpeg,
                    "-y",
                    "-i",
                    src_path,
                    "-ar",
                    str(sample_rate),
                    "-ac",
                    "1",
                    "-f",
                    "wav",
                    dst_path,
                ],
                capture_output=True,
                timeout=45,
                text=True,
            )
            if os.path.exists(dst_path) and os.path.getsize(dst_path) > 44:
                return {"success": True, "path": dst_path, "ffmpeg": ffmpeg}
            tail = ((proc.stderr or "") + (proc.stdout or "")).strip()[-400:]
            last_err = tail or f"exit {proc.returncode}"
            logger.warning("ffmpeg %s produced empty wav: %s", ffmpeg, last_err)
        except Exception as exc:  # noqa: BLE001
            last_err = str(exc)
            logger.warning("ffmpeg %s failed: %s", ffmpeg, exc)

    return {"success": False, "error": last_err or "音频转码失败"}


_GLM_ASR_ALLOWED_SUFFIXES = {".wav", ".mp3", ".m4a", ".flac", ".aac"}
_QWEN_ASR_ALLOWED_SUFFIXES = _GLM_ASR_ALLOWED_SUFFIXES | {".webm", ".ogg", ".opus"}


def _mime_for_asr_suffix(suffix: str) -> str:
    mapping = {
        ".wav": "audio/wav",
        ".webm": "audio/webm",
        ".ogg": "audio/ogg",
        ".opus": "audio/ogg",
        ".mp3": "audio/mpeg",
        ".m4a": "audio/mp4",
        ".aac": "audio/aac",
        ".mp4": "audio/mp4",
        ".flac": "audio/flac",
    }
    return mapping.get(suffix.lower(), "audio/wav")


def _normalize_asr_mime(mime_type: str) -> str:
    mime = (mime_type or "audio/webm").lower().split(";")[0].strip()
    if mime == "audio/x-wav":
        return "audio/wav"
    if mime == "audio/mp3":
        return "audio/mpeg"
    allowed = {
        "audio/webm",
        "audio/ogg",
        "audio/wav",
        "audio/mpeg",
        "audio/mp4",
        "audio/aac",
        "audio/flac",
    }
    return mime if mime in allowed else "audio/webm"


def _extract_qwen_asr_from_dict(data: Dict[str, Any]) -> str:
    output = data.get("output") or {}
    choices = output.get("choices") or []
    if not choices:
        return ""
    message = choices[0].get("message") or {}
    content = message.get("content") or []
    if isinstance(content, list):
        for item in content:
            if isinstance(item, dict):
                text = item.get("text")
                if isinstance(text, str) and text.strip():
                    return text.strip()
    return ""


def _extract_qwen_asr_text(response: Any) -> str:
    """Parse Qwen3-ASR-Flash SDK or HTTP JSON response."""
    if isinstance(response, dict):
        return _extract_qwen_asr_from_dict(response)

    output = getattr(response, "output", None)
    if output is None:
        return ""

    choices = getattr(output, "choices", None) or []
    if not choices:
        return ""

    message = getattr(choices[0], "message", None)
    if message is None:
        return ""

    content = getattr(message, "content", None)
    if isinstance(content, list):
        for item in content:
            if isinstance(item, dict):
                text = item.get("text")
            else:
                text = getattr(item, "text", None)
            if isinstance(text, str) and text.strip():
                return text.strip()
    elif isinstance(content, str) and content.strip():
        return content.strip()
    return ""


def transcribe_audio_qwen_asr_bytes(
    audio_bytes: bytes,
    mime_type: str = "audio/webm",
    language: str = "zh",
) -> Dict:
    """通义千问 Qwen3-ASR-Flash：直接提交浏览器录音 bytes（webm/ogg/wav 等），无需 ffmpeg。"""
    import requests

    api_key = _get_provider_api_key("alibaba")
    if not api_key:
        return {"success": False, "error": "未设置 ALIBABA_API_KEY 或 DASHSCOPE_API_KEY"}

    if len(audio_bytes) < 44:
        return {"success": False, "error": "音频数据无效或为空"}

    lang = (language or "zh").split("-")[0].lower()
    asr_options: Dict[str, Any] = {"enable_itn": False}
    if lang in {"zh", "en", "ja", "ko", "yue", "de", "fr", "ru"}:
        asr_options["language"] = lang

    mime = _normalize_asr_mime(mime_type)
    b64 = base64.b64encode(audio_bytes).decode("ascii")
    audio_data = f"data:{mime};base64,{b64}"
    url = f"{dashscope_api_root()}/services/aigc/multimodal-generation/generation"
    payload = {
        "model": "qwen3-asr-flash",
        "input": {
            "messages": [
                {"role": "user", "content": [{"audio": audio_data}]},
            ],
        },
        "parameters": {
            "result_format": "message",
            "asr_options": asr_options,
        },
    }

    logger.info("使用 qwen3-asr-flash (HTTP) 识别音频: %s (%d bytes)", mime, len(audio_bytes))

    try:
        resp = requests.post(
            url,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=45,
        )
        data = resp.json() if resp.content else {}
    except Exception as exc:  # noqa: BLE001
        logger.error("Qwen-ASR HTTP 请求失败: %s", exc, exc_info=True)
        return {"success": False, "error": f"Qwen-ASR 网络错误: {exc}"}

    if resp.status_code >= 400:
        msg = data.get("message") or data.get("code") or resp.text[:200] or str(resp.status_code)
        logger.error("Qwen-ASR HTTP %s: %s", resp.status_code, msg)
        return {"success": False, "error": str(msg)}

    text = _extract_qwen_asr_from_dict(data)
    if text:
        return {"success": True, "text": text, "segments": [], "model": "qwen3-asr-flash"}

    return {"success": False, "error": "未识别到语音内容"}


def transcribe_audio_qwen_asr(audio_path: str, language: str = "zh") -> Dict:
    """使用通义千问 Qwen3-ASR-Flash（DashScope HTTP + base64）进行语音识别。

    通过 ``data:audio/*;base64,...`` 提交，支持 webm/ogg/wav 等，不依赖 dashscope SDK。
    需配置 ``ALIBABA_API_KEY`` 或 ``DASHSCOPE_API_KEY``。
    """
    if not os.path.exists(audio_path):
        return {"success": False, "error": f"音频文件不存在: {audio_path}"}

    suffix = os.path.splitext(audio_path)[1].lower()
    if suffix and suffix not in _QWEN_ASR_ALLOWED_SUFFIXES:
        return {
            "success": False,
            "error": f"Qwen-ASR 不支持 {suffix} 格式",
        }

    try:
        with open(audio_path, "rb") as fh:
            raw = fh.read()
    except OSError as exc:
        return {"success": False, "error": str(exc)}

    mime = _mime_for_asr_suffix(suffix)
    return transcribe_audio_qwen_asr_bytes(raw, mime, language)


def transcribe_audio_glm_asr(audio_path: str) -> Dict:
    """使用智谱 GLM-ASR-2512 进行语音识别。

    注意：
    - 模型名必须是 ``glm-asr-2512``（旧的 ``glm-asr`` 不可用）。
    - SDK 不接受 ``response_format`` 参数，返回的是 chat 风格 Completion。
    - 音频需为 wav / mp3 等常见格式，≤25MB、≤30s。
    """
    api_key = os.getenv("ZHIPUAI_API_KEY")
    if not api_key:
        return {"success": False, "error": "未设置ZHIPUAI_API_KEY"}

    if not os.path.exists(audio_path):
        return {"success": False, "error": f"音频文件不存在: {audio_path}"}

    suffix = os.path.splitext(audio_path)[1].lower()
    if suffix and suffix not in _GLM_ASR_ALLOWED_SUFFIXES:
        return {
            "success": False,
            "error": f"GLM-ASR 不支持 {suffix} 格式，请先转为 wav（webm/ogg 需 ffmpeg 转码）",
        }

    upload_name = os.path.basename(audio_path)
    if not upload_name.lower().endswith(".wav"):
        upload_name = f"{os.path.splitext(upload_name)[0] or 'audio'}.wav"

    client = create_zhipu_client(api_key)
    last_error = ""
    for model_name in ("glm-asr-2512", "glm-asr"):
        try:
            logger.info("使用 %s 识别音频: %s", model_name, audio_path)
            with open(audio_path, "rb") as fh:
                response = client.audio.transcriptions.create(
                    model=model_name,
                    file=(upload_name, fh, "audio/wav"),
                    stream=False,
                )
            text = _extract_glm_asr_text(response)
            if text:
                return {"success": True, "text": text, "segments": [], "model": model_name}
            last_error = "未识别到语音内容"
        except Exception as e:  # noqa: BLE001 — try next model / surface error
            last_error = str(e)
            logger.warning("%s 识别失败: %s", model_name, e)
            # If the model id is unknown, try the next candidate; otherwise stop.
            if "model" not in last_error.lower() and "不存在" not in last_error:
                break

    logger.error("GLM-ASR识别失败: %s", last_error)
    return {"success": False, "error": last_error or "语音识别失败"}


def get_available_bgm() -> List[Dict]:
    """获取可用的背景音乐列表"""
    available = []
    
    for key, info in PRESET_BGM.items():
        bgm_path = os.path.join(BGM_DIR, info["file"])
        available.append({
            "id": key,
            "name": info["name"],
            "file": info["file"],
            "available": os.path.exists(bgm_path),
            "path": bgm_path if os.path.exists(bgm_path) else None
        })
    
    if os.path.exists(BGM_DIR):
        for filename in os.listdir(BGM_DIR):
            if filename.endswith(('.mp3', '.wav', '.m4a', '.aac')):
                if filename not in [b["file"] for b in PRESET_BGM.values()]:
                    available.append({
                        "id": f"custom_{filename}",
                        "name": filename,
                        "file": filename,
                        "available": True,
                        "path": os.path.join(BGM_DIR, filename)
                    })
    
    return available
