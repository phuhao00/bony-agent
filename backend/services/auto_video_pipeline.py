"""
一键短视频流水线 — 参考 MoneyPrinterTurbo 端到端流程。

主题 → 旁白文案 → 检索词 → TTS → 素材下载 → FFmpeg 拼接 → BGM → 字幕烧录 → 成片
"""
from __future__ import annotations

import json
import os
import random
import re
import shutil
import subprocess
import uuid
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional

from core.llm_provider import get_chat_llm
from tools.audio_tools import (
    BGM_DIR,
    PRESET_BGM,
    VOICE_OPTIONS,
    add_audio_to_video,
    generate_speech_edge_tts,
    get_available_bgm,
)
from tools.material_tools import ASPECT_MAP, download_materials_for_duration
from tools.media_common import OUTPUT_DIR, TEMP_DIR, get_video_duration
from tools.subtitle_tools import create_srt_file
from utils.logger import setup_logger
from utils.task_manager import task_manager

logger = setup_logger("auto_video_pipeline")

AUTO_VIDEO_TASK_TYPE = "auto_short_video"


@dataclass
class AutoVideoParams:
    subject: str
    script: str = ""
    search_terms: List[str] = field(default_factory=list)
    voice: str = "zh-CN-XiaoxiaoNeural"
    aspect_ratio: str = "9:16"
    material_source: str = "pexels"
    clip_duration: float = 3.0
    subtitle_enabled: bool = True
    subtitle_style: str = "default"
    bgm: str = "random"
    bgm_volume: float = 0.25
    language: str = "zh-CN"
    paragraph_number: int = 1


def _task_workdir(task_id: str) -> str:
    path = os.path.join(TEMP_DIR, "auto_video", task_id)
    os.makedirs(path, exist_ok=True)
    return path


def _update(task_id: str, **kwargs: Any) -> None:
    task_manager.update_task(task_id, **kwargs)


def _get_audio_duration(audio_path: str) -> float:
    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                audio_path,
            ],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
        return max(float(result.stdout.strip() or 0), 1.0)
    except Exception:
        return 10.0


def _resolve_bgm_path(bgm: str) -> str:
    if not bgm or bgm == "none":
        return ""
    if bgm == "random":
        available = [b for b in get_available_bgm() if b.get("available") and b.get("path")]
        if available:
            return random.choice(available)["path"]
        return ""
    if os.path.isfile(bgm):
        return bgm
    preset = PRESET_BGM.get(bgm)
    if preset:
        path = os.path.join(BGM_DIR, preset["file"])
        if os.path.isfile(path):
            return path
    return ""


def _llm_generate_script(subject: str, language: str, paragraph_number: int) -> str:
    llm = get_chat_llm(temperature=0.7)
    prompt = f"""你是一位短视频文案策划。请根据主题创作一段适合配音朗读的旁白文案。

主题：{subject}
语言：{language}
段落数：{paragraph_number}

要求：
1. 适合 30-60 秒口播，150-300 字
2. 开头 3 秒有强钩子
3. 语言口语化、节奏感强
4. 只输出旁白正文，不要标题、标签或格式说明"""

    response = llm.invoke(prompt)
    text = getattr(response, "content", str(response)).strip()
    text = re.sub(r"^#+\s*", "", text, flags=re.MULTILINE)
    return text.strip()


def _llm_generate_terms(subject: str, script: str, amount: int = 5) -> List[str]:
    llm = get_chat_llm(temperature=0.5)
    prompt = f"""从以下短视频主题和旁白中，提取 {amount} 个英文或中文关键词，用于搜索免版权视频素材（B-roll）。
每行一个关键词，不要编号、不要解释。

主题：{subject}
旁白：
{script[:800]}"""

    response = llm.invoke(prompt)
    raw = getattr(response, "content", str(response))
    terms = []
    for line in raw.splitlines():
        line = re.sub(r"^[\d\.\-\*]+\s*", "", line.strip())
        line = line.strip('"\'""''')
        if line and len(line) <= 40:
            terms.append(line)
    if subject and subject not in terms:
        terms.insert(0, subject)
    return terms[:amount] or [subject]


def _combine_clips(
    clip_paths: List[str],
    target_duration: float,
    aspect_ratio: str,
    clip_duration: float,
    output_path: str,
) -> str:
    if not shutil.which("ffmpeg"):
        raise RuntimeError("系统未安装 FFmpeg")

    aspect = ASPECT_MAP.get(aspect_ratio, ASPECT_MAP["9:16"])
    w, h = aspect["width"], aspect["height"]
    work = os.path.dirname(output_path)
    processed: List[str] = []
    total = 0.0
    idx = 0

    while total < target_duration and idx < len(clip_paths) * 3:
        src = clip_paths[idx % len(clip_paths)]
        idx += 1
        if not os.path.isfile(src):
            continue
        seg_out = os.path.join(work, f"seg_{len(processed):03d}.mp4")
        seg_len = min(clip_duration, target_duration - total)
        cmd = [
            "ffmpeg",
            "-y",
            "-i",
            src,
            "-t",
            str(seg_len),
            "-an",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-vf",
            f"scale={w}:{h}:force_original_aspect_ratio=decrease,"
            f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2",
            seg_out,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, check=False)
        if result.returncode != 0 or not os.path.isfile(seg_out):
            logger.warning("[auto-video] clip process failed: %s", result.stderr[:200])
            continue
        processed.append(seg_out)
        total += seg_len

    if not processed:
        raise RuntimeError("素材片段处理失败")

    concat_list = os.path.join(work, "concat.txt")
    with open(concat_list, "w", encoding="utf-8") as f:
        for p in processed:
            f.write(f"file '{p}'\n")

    combined = os.path.join(work, "combined.mp4")
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            concat_list,
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            combined,
        ],
        capture_output=True,
        check=True,
    )

    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-i",
            combined,
            "-t",
            str(target_duration),
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-an",
            output_path,
        ],
        capture_output=True,
        check=True,
    )
    return output_path


def _burn_srt_subtitles(
    video_path: str,
    srt_path: str,
    output_path: str,
) -> str:
    escaped = srt_path.replace("\\", "/").replace(":", "\\:").replace("'", "\\'")
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        video_path,
        "-vf",
        f"subtitles='{escaped}'",
        "-c:a",
        "copy",
        output_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if result.returncode == 0 and os.path.isfile(output_path):
        return output_path
    logger.warning("[auto-video] subtitle burn failed, copying video: %s", result.stderr[:200])
    shutil.copy2(video_path, output_path)
    return output_path


def create_auto_video_task(params: AutoVideoParams) -> str:
    return task_manager.create_task(
        AUTO_VIDEO_TASK_TYPE,
        metadata={"params": asdict(params)},
    )


def get_auto_video_task(task_id: str) -> Optional[Dict[str, Any]]:
    task = task_manager.get_task(task_id)
    if not task or task.get("type") != AUTO_VIDEO_TASK_TYPE:
        return None
    return task


def run_auto_video_task(task_id: str, params: AutoVideoParams) -> None:
    workdir = _task_workdir(task_id)
    artifacts: Dict[str, Any] = {}

    try:
        _update(task_id, status="running", progress=5, message="正在生成旁白文案…")

        script = (params.script or "").strip()
        if not script:
            script = _llm_generate_script(
                params.subject, params.language, params.paragraph_number
            )
        if not script:
            raise ValueError("旁白文案生成失败")
        artifacts["script"] = script
        _update(task_id, progress=15, message="正在生成素材检索词…")

        terms = params.search_terms or _llm_generate_terms(params.subject, script)
        artifacts["search_terms"] = terms
        _update(task_id, progress=25, message="正在合成配音…")

        audio_name = f"auto_{task_id[:8]}_narration.mp3"
        tts = generate_speech_edge_tts(script, voice=params.voice, output_name=audio_name)
        if not tts.get("success"):
            raise ValueError(tts.get("error") or "配音合成失败")
        audio_path = tts["local_path"]
        audio_duration = _get_audio_duration(audio_path)
        artifacts["audio_path"] = audio_path
        artifacts["audio_duration"] = audio_duration
        _update(task_id, progress=40, message="正在获取视频素材…")

        clips, material_mode = download_materials_for_duration(
            search_terms=terms,
            target_duration=audio_duration,
            task_dir=os.path.join(workdir, "materials"),
            source=params.material_source,
            aspect_ratio=params.aspect_ratio,
            clip_duration=params.clip_duration,
        )
        artifacts["clip_count"] = len(clips)
        artifacts["material_mode"] = material_mode
        if material_mode == "synthetic":
            _update(
                task_id,
                progress=45,
                message="未配置素材 API Key，已使用本地合成 B-roll 继续生成…",
            )
        _update(task_id, progress=55, message="正在拼接视频片段…")

        silent_video = os.path.join(workdir, "silent.mp4")
        _combine_clips(
            clips,
            target_duration=audio_duration,
            aspect_ratio=params.aspect_ratio,
            clip_duration=params.clip_duration,
            output_path=silent_video,
        )
        _update(task_id, progress=70, message="正在混音（旁白 + BGM）…")

        bgm_path = _resolve_bgm_path(params.bgm)
        mixed_name = f"auto_{task_id[:8]}_mixed.mp4"
        mix = add_audio_to_video(
            video_path=silent_video,
            audio_path=audio_path,
            bgm_path=bgm_path,
            bgm_volume=params.bgm_volume,
            output_name=mixed_name,
        )
        if not mix.get("success"):
            raise ValueError(mix.get("error") or "音视频合成失败")
        current_video = mix["local_path"]
        _update(task_id, progress=85, message="正在烧录字幕…")

        final_name = f"auto_video_{task_id[:8]}.mp4"
        final_path = os.path.join(OUTPUT_DIR, final_name)

        if params.subtitle_enabled:
            srt_path = os.path.join(workdir, "subtitle.srt")
            create_srt_file(script, audio_duration, srt_path)
            artifacts["srt_path"] = srt_path
            _burn_srt_subtitles(current_video, srt_path, final_path)
        else:
            shutil.copy2(current_video, final_path)

        rel = f"./storage/outputs/{os.path.basename(final_path)}"
        result = {
            "video_path": final_path,
            "video_url": f"/api/media/{os.path.basename(final_path)}",
            "local_path": rel,
            "script": script,
            "search_terms": terms,
            "duration_sec": round(audio_duration, 2),
            "material_mode": material_mode,
            "artifacts": artifacts,
        }

        done_msg = "短视频生成完成"
        if material_mode == "synthetic":
            done_msg += "（使用本地合成素材；配置 PEXELS_API_KEY 可获取真实 B-roll）"

        with open(os.path.join(workdir, "result.json"), "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)

        _update(
            task_id,
            status="completed",
            progress=100,
            message=done_msg,
            result=result,
        )
        logger.info("[auto-video] task=%s completed path=%s", task_id, final_path)

    except Exception as exc:
        logger.error("[auto-video] task=%s failed: %s", task_id, exc, exc_info=True)
        _update(
            task_id,
            status="failed",
            error=str(exc),
            message=f"生成失败: {exc}",
            result={"artifacts": artifacts},
        )


def list_voice_options() -> List[Dict[str, str]]:
    return VOICE_OPTIONS
