"""
长视频生成工具。

实现策略：
1. 先用 LLM 将长视频目标拆成多个 5s 左右的镜头段。
2. 每段调用通义万影 Wan 文生视频生成。
3. 用 FFmpeg 统一编码并顺序拼接成 1 分钟或更长的视频。

当前版本刻意保持最小闭环：先把 Wan 长视频链路跑通，后续可在此基础上
扩展 I2V 连贯性增强、anchor frame、音频后处理等能力。
"""

from __future__ import annotations

import asyncio
import json
import math
import os
import shutil
import subprocess
import time
import uuid
from dataclasses import asdict, dataclass
from typing import Any, Dict, List, Optional

from langchain_core.tools import tool

from utils.logger import setup_logger
from utils.task_manager import task_manager

from core.llm_provider import get_chat_llm
from tools.media_common import OUTPUT_DIR, get_video_duration
from tools.video_tools import _dashscope_generate_video

logger = setup_logger("long_video_tools")

WAN_LONG_VIDEO_MODEL = os.getenv("WAN_LONG_VIDEO_MODEL", "wan2.7-t2v")
DEFAULT_SEGMENT_SECONDS = 5
MAX_SEGMENTS = 24
LONG_VIDEO_CONCURRENCY = max(1, int(os.getenv("LONG_VIDEO_CONCURRENCY", "4")))
LONG_VIDEO_EVALUATOR_ENABLED = os.getenv("LONG_VIDEO_EVALUATOR", "1").lower() not in {"0", "false", "off"}
LONG_VIDEO_EVALUATOR_THRESHOLD = max(1, min(100, int(os.getenv("LONG_VIDEO_EVALUATOR_THRESHOLD", "70"))))
LONG_VIDEO_MAX_RETRIES = max(0, int(os.getenv("LONG_VIDEO_MAX_RETRIES", "2")))
LONG_VIDEO_MAX_FAILED_RATIO = max(0.0, min(1.0, float(os.getenv("LONG_VIDEO_MAX_FAILED_RATIO", "0.3"))))
# 成片默认叠一层非常轻的铺底氛围音（正弦 + 低通），避免完全无声；设为 0/false/off 关闭
LONG_VIDEO_AMBIENT_TRACK = os.getenv("LONG_VIDEO_AMBIENT_TRACK", "1").lower() not in {"0", "false", "off"}


def _probe_has_audio(video_path: str) -> bool:
    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-select_streams",
                "a",
                "-show_entries",
                "stream=index",
                "-of",
                "csv=p=0",
                video_path,
            ],
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
        return bool((result.stdout or "").strip())
    except Exception:
        return False


@dataclass
class LongVideoScene:
    index: int
    duration_sec: int
    title: str
    prompt: str


def _safe_json_loads(text: str) -> Optional[Dict[str, Any]]:
    try:
        payload = json.loads(_strip_code_fences(text))
    except Exception:
        return None
    return payload if isinstance(payload, dict) else None


def _strip_code_fences(text: str) -> str:
    cleaned = (text or "").strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[-1]
    if cleaned.endswith("```"):
        cleaned = cleaned.rsplit("```", 1)[0]
    return cleaned.strip()


def _fallback_plan(prompt: str, duration_sec: int) -> List[LongVideoScene]:
    segment_count = max(1, min(MAX_SEGMENTS, math.ceil(duration_sec / DEFAULT_SEGMENT_SECONDS)))
    base_duration = max(4, round(duration_sec / segment_count))
    style_anchor = (
        f"统一视觉锚点：主体、服装、场景风格、镜头语言保持一致；"
        f"整体创意目标：{prompt.strip()}"
    )
    scenes: List[LongVideoScene] = []
    for index in range(segment_count):
        beat = index + 1
        if index == 0:
            stage_hint = "开场建立世界观与主体关系，镜头完整交代环境。"
        elif index == segment_count - 1:
            stage_hint = "收束情绪与动作，形成明确结尾画面。"
        else:
            stage_hint = f"推进剧情与动作，第 {beat} 段相较上一段要有明显事件变化。"
        scene_prompt = (
            f"{style_anchor}。"
            f"镜头 {beat}/{segment_count}，时长约 {base_duration} 秒。"
            f"{stage_hint}"
            f"保持主体连续，避免突然换景和换人。"
        )
        scenes.append(
            LongVideoScene(
                index=index,
                duration_sec=base_duration,
                title=f"镜头 {beat}",
                prompt=scene_prompt,
            )
        )
    return scenes


def plan_long_video_scenes(prompt: str, duration_sec: int) -> List[LongVideoScene]:
    """使用当前 LLM 生成可执行的分镜；失败时回退到确定性规则拆分。"""
    if not (prompt or "").strip():
        raise ValueError("prompt 不能为空")

    safe_duration = max(DEFAULT_SEGMENT_SECONDS, min(duration_sec, DEFAULT_SEGMENT_SECONDS * MAX_SEGMENTS))
    segment_count = max(1, math.ceil(safe_duration / DEFAULT_SEGMENT_SECONDS))
    logger.info(
        "[long_video] plan start safe_duration=%s target_segments=%s prompt_preview=%.100r",
        safe_duration,
        segment_count,
        (prompt or "").strip()[:100],
    )

    planner_prompt = f"""
你是长视频分镜导演。请把用户需求拆成 {segment_count} 个可直接用于文生视频的镜头段。

要求：
1. 输出 JSON 数组，不要 Markdown。
2. 每个元素必须包含 title, duration_sec, prompt。
3. duration_sec 取 4-6 之间的整数，总时长尽量接近 {safe_duration} 秒。
4. 每段 prompt 必须重复同一个视觉锚点，确保人物、服装、地点、色调连续。
5. 每段 prompt 必须明确本段动作推进，不要只重复原句。
6. 适配阿里通义 Wan 文生视频，描述具体镜头、主体动作、摄影机运动、氛围光线。

用户需求：{prompt}
目标时长：{safe_duration} 秒
""".strip()

    try:
        llm = get_chat_llm(temperature=0.4)
        response = llm.invoke(planner_prompt)
        content = getattr(response, "content", response)
        if isinstance(content, list):
            content = "\n".join(
                item.get("text", "") if isinstance(item, dict) else str(item)
                for item in content
            )
        payload = json.loads(_strip_code_fences(str(content)))
        if not isinstance(payload, list) or not payload:
            raise ValueError("planner did not return a scene list")

        scenes: List[LongVideoScene] = []
        for index, item in enumerate(payload[:MAX_SEGMENTS]):
            if not isinstance(item, dict):
                continue
            scene_prompt = str(item.get("prompt", "")).strip()
            if not scene_prompt:
                continue
            duration = int(item.get("duration_sec") or DEFAULT_SEGMENT_SECONDS)
            duration = max(4, min(6, duration))
            scenes.append(
                LongVideoScene(
                    index=index,
                    duration_sec=duration,
                    title=str(item.get("title") or f"镜头 {index + 1}"),
                    prompt=scene_prompt,
                )
            )

        if scenes:
            logger.info("[long_video] plan llm_ok segment_count=%d", len(scenes))
            return scenes
    except Exception as exc:
        logger.warning("[long_video] plan llm_failed will_fallback err=%s", exc)

    fb = _fallback_plan(prompt, safe_duration)
    logger.info("[long_video] plan fallback_ok segment_count=%d", len(fb))
    return fb


def _normalize_clip(input_path: str, output_path: str) -> None:
    """统一分辨率/FPS；若源无音轨则补一路静音 AAC；有音轨则重编码为立体声 AAC。"""
    vf = (
        "scale=1280:720:force_original_aspect_ratio=decrease,"
        "pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=24"
    )
    if _probe_has_audio(input_path):
        cmd = [
            "ffmpeg",
            "-y",
            "-i",
            input_path,
            "-filter_complex",
            f"[0:v]{vf}[v];[0:a]aformat=sample_rates=48000:channel_layouts=stereo[a]",
            "-map",
            "[v]",
            "-map",
            "[a]",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            output_path,
        ]
    else:
        duration = max(0.1, float(get_video_duration(input_path)))
        cmd = [
            "ffmpeg",
            "-y",
            "-i",
            input_path,
            "-f",
            "lavfi",
            "-i",
            "anullsrc=channel_layout=stereo:sample_rate=48000",
            "-filter_complex",
            f"[0:v]{vf}[v]",
            "-map",
            "[v]",
            "-map",
            "1:a",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-t",
            str(duration),
            output_path,
        ]
    proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if proc.returncode != 0:
        err_tail = (proc.stderr or "")[-2000:]
        raise RuntimeError(f"ffmpeg normalize 失败 rc={proc.returncode} stderr={err_tail!r}")


def _blend_ambient_bed(video_path: str, output_path: str) -> None:
    """在原音轨上叠一层极轻铺底 tone；WAN 段常无声时成片仍可听到铺底。"""
    duration = max(0.1, float(get_video_duration(video_path)))
    fade_out_start = max(0.0, duration - 3.0)
    sine = f"sine=frequency=208:sample_rate=48000:duration={duration:.4f}"
    filter_complex = (
        f"[1:a]volume=0.16,highpass=f=72,afade=t=in:st=0:d=2,afade=t=out:st={fade_out_start:.4f}:d=3[bg];"
        "[0:a][bg]amix=inputs=2:duration=first:dropout_transition=2:normalize=1[aout]"
    )
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        video_path,
        "-f",
        "lavfi",
        "-i",
        sine,
        "-filter_complex",
        filter_complex,
        "-map",
        "0:v",
        "-map",
        "[aout]",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
        output_path,
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if proc.returncode != 0:
        err_tail = (proc.stderr or "")[-2000:]
        logger.warning("[long_video] ambient_bed failed rc=%s stderr=%s", proc.returncode, err_tail)
        shutil.copyfile(video_path, output_path)


def _create_placeholder_clip(duration_sec: int, output_path: str) -> str:
    cmd = [
        "ffmpeg",
        "-y",
        "-f",
        "lavfi",
        "-i",
        f"color=c=black:s=1280x720:r=24:d={max(1, duration_sec)}",
        "-an",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        output_path,
    ]
    subprocess.run(cmd, check=True, capture_output=True)
    return output_path


def _build_style_anchor(prompt: str, style: str) -> str:
    style_map = {
        "cinematic": "电影感叙事",
        "documentary": "纪实观察",
        "advertising": "广告大片",
        "fantasy": "幻想美学",
    }
    normalized_style = style_map.get(style, style or "电影感")
    return (
        "统一视觉锚点：主体身份、服装造型、核心场景、色彩基调、镜头语言保持一致；"
        f"整体风格：{normalized_style}；"
        f"全片主题：{prompt.strip()}"
    )


def _rewrite_scene_prompt(
    scene_prompt: str,
    *,
    style_anchor: str,
    style: str,
    previous_prompt: Optional[str] = None,
) -> str:
    continuity_hint = (
        f"承接上一镜头的关键元素：{previous_prompt[:120]}。"
        if previous_prompt
        else "作为首镜头，先完整建立人物、空间和情绪。"
    )
    return (
        f"{style_anchor}。"
        f"本段镜头任务：{scene_prompt.strip()}。"
        f"视频风格：{style}。"
        f"{continuity_hint}"
        "适配通义 Wan 文生视频：主体动作明确，摄影机运动清晰，避免人物漂移、突然换景和光线断裂。"
    )


def _fallback_prompt_evaluation(candidate_prompt: str) -> Dict[str, Any]:
    issues: List[str] = []
    score = 86
    if len(candidate_prompt.strip()) < 90:
        score -= 18
        issues.append("镜头描述偏短，连续性约束不足")
    if "统一视觉锚点" not in candidate_prompt:
        score -= 12
        issues.append("缺少统一视觉锚点")
    if "摄影机" not in candidate_prompt and "镜头" not in candidate_prompt:
        score -= 8
        issues.append("缺少镜头运动描述")

    refined_prompt = candidate_prompt
    if issues:
        refined_prompt = (
            f"{candidate_prompt}。"
            "补充要求：主体外观保持一致，镜头运动和场景衔接更具体，延续上一段的构图与光线。"
        )

    return {
        "enabled": LONG_VIDEO_EVALUATOR_ENABLED,
        "mode": "heuristic",
        "score": max(1, min(100, score)),
        "issues": issues,
        "refined_prompt": refined_prompt,
    }


def _evaluate_scene_prompt(candidate_prompt: str, scene_title: str) -> Dict[str, Any]:
    if not LONG_VIDEO_EVALUATOR_ENABLED:
        return {
            "enabled": False,
            "mode": None,
            "score": None,
            "issues": [],
            "refined_prompt": candidate_prompt,
        }

    evaluator_prompt = f"""
你是长视频连续性评估器。请检查下面的镜头 prompt 是否足够支持长视频前后镜头的一致性。

要求：
1. 只输出 JSON 对象，不要 Markdown。
2. 字段必须包含：score(0-100整数), issues(字符串数组，最多3条), refined_prompt(字符串)。
3. 如果 prompt 已经足够好，refined_prompt 直接返回原文。
4. 重点检查：主体一致性、场景连续性、镜头动作是否具体、是否适配通义 Wan。

镜头标题：{scene_title}
prompt：{candidate_prompt}
""".strip()

    try:
        llm = get_chat_llm(temperature=0.2)
        response = llm.invoke(evaluator_prompt)
        content = getattr(response, "content", response)
        if isinstance(content, list):
            content = "\n".join(
                item.get("text", "") if isinstance(item, dict) else str(item)
                for item in content
            )
        payload = _safe_json_loads(str(content))
        if not payload:
            raise ValueError("evaluator did not return JSON object")

        score = int(payload.get("score", 0))
        issues = payload.get("issues") or []
        refined_prompt = str(payload.get("refined_prompt") or candidate_prompt).strip()
        return {
            "enabled": True,
            "mode": "llm",
            "score": max(0, min(100, score)),
            "issues": [str(item) for item in issues][:3],
            "refined_prompt": refined_prompt,
        }
    except Exception as exc:
        logger.warning(f"Long video evaluator fallback: {exc}")
        return _fallback_prompt_evaluation(candidate_prompt)


def _optimize_scene_prompt(
    scene_prompt: str,
    *,
    scene_title: str,
    style_anchor: str,
    style: str,
    previous_prompt: Optional[str] = None,
) -> Dict[str, Any]:
    candidate_prompt = _rewrite_scene_prompt(
        scene_prompt,
        style_anchor=style_anchor,
        style=style,
        previous_prompt=previous_prompt,
    )
    evaluation = {
        "enabled": False,
        "mode": None,
        "score": None,
        "issues": [],
        "refined_prompt": candidate_prompt,
    }

    for _ in range(max(1, LONG_VIDEO_MAX_RETRIES + 1)):
        evaluation = _evaluate_scene_prompt(candidate_prompt, scene_title)
        score = evaluation.get("score")
        refined_prompt = str(evaluation.get("refined_prompt") or candidate_prompt).strip()
        if score is None or score >= LONG_VIDEO_EVALUATOR_THRESHOLD or refined_prompt == candidate_prompt:
            candidate_prompt = refined_prompt or candidate_prompt
            break
        candidate_prompt = refined_prompt

    evaluation["refined_prompt"] = candidate_prompt
    return {
        "final_prompt": candidate_prompt,
        "evaluator": evaluation,
    }


def stitch_long_video(segment_paths: List[str], output_name: Optional[str] = None) -> str:
    if not shutil.which("ffmpeg"):
        raise RuntimeError("系统未安装 FFmpeg")
    if not segment_paths:
        raise RuntimeError("没有可拼接的片段")

    temp_dir = os.path.join(OUTPUT_DIR, f"long_video_build_{uuid.uuid4().hex[:8]}")
    os.makedirs(temp_dir, exist_ok=True)
    try:
        normalized_paths: List[str] = []
        for index, source_path in enumerate(segment_paths):
            normalized = os.path.join(temp_dir, f"seg_{index:03d}.mp4")
            _normalize_clip(source_path, normalized)
            normalized_paths.append(normalized)

        concat_file = os.path.join(temp_dir, "concat.txt")
        with open(concat_file, "w", encoding="utf-8") as handle:
            for path in normalized_paths:
                handle.write(f"file '{path}'\n")

        final_name = output_name or f"long_video_{uuid.uuid4()}.mp4"
        final_path = os.path.join(OUTPUT_DIR, final_name)
        staged_path = os.path.join(temp_dir, "_concat_staged.mp4")
        concat_cmd = [
            "ffmpeg",
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            concat_file,
            "-c:v",
            "libx264",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            staged_path,
        ]
        proc_concat = subprocess.run(concat_cmd, capture_output=True, text=True, check=False)
        if proc_concat.returncode != 0:
            err_tail = (proc_concat.stderr or "")[-2000:]
            raise RuntimeError(f"ffmpeg concat 失败 rc={proc_concat.returncode} stderr={err_tail!r}")
        if LONG_VIDEO_AMBIENT_TRACK:
            _blend_ambient_bed(staged_path, final_path)
            logger.info("[long_video] stitch_done path=%s ambient=1", os.path.basename(final_path))
        else:
            shutil.copyfile(staged_path, final_path)
            logger.info("[long_video] stitch_done path=%s ambient=0", os.path.basename(final_path))
        return final_path
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


def _media_url(local_path: str) -> str:
    return f"/media/{os.path.basename(local_path)}"


def create_long_video_task(prompt: str, duration_sec: int, style: str = "cinematic") -> str:
    metadata = {
        "prompt": prompt,
        "duration_sec": duration_sec,
        "style": style,
        "provider": "alibaba",
        "model": WAN_LONG_VIDEO_MODEL,
        "segments": [],
    }
    tid = task_manager.create_task("long_video", metadata=metadata)
    logger.info(
        "[long_video] task_created id=%s duration_sec=%s style=%s model=%s",
        tid,
        duration_sec,
        style,
        WAN_LONG_VIDEO_MODEL,
    )
    return tid


def run_long_video_task(task_id: str, prompt: str, duration_sec: int, style: str = "cinematic") -> None:
    wall0 = time.monotonic()
    logger.info(
        "[long_video] run_start task_id=%s duration_sec=%s style=%s concurrency=%s",
        task_id,
        duration_sec,
        style,
        LONG_VIDEO_CONCURRENCY,
    )
    try:
        scenes = plan_long_video_scenes(prompt, duration_sec)
        scene_payload = [
            {
                **asdict(scene),
                "status": "pending",
                "video_url": None,
                "local_path": None,
                "error": None,
                "attempts": 0,
                "retry_count": 0,
                "placeholder": False,
                "final_prompt": None,
                "evaluator": None,
            }
            for scene in scenes
        ]
        task_manager.update_task(
            task_id,
            status="running",
            progress=2,
            message=f"已完成分镜规划，共 {len(scene_payload)} 段",
            result={
                "task_id": task_id,
                "provider": "alibaba",
                "model": WAN_LONG_VIDEO_MODEL,
                "segments": scene_payload,
                "final_video": None,
                "style": style,
                "degraded": False,
                "failed_segments": 0,
                "placeholder_segments": 0,
            },
        )
        logger.info(
            "[long_video] plan_applied task_id=%s segments=%d elapsed=%.3fs",
            task_id,
            len(scene_payload),
            time.monotonic() - wall0,
        )

        async def _run_generation() -> List[str]:
            total = max(1, len(scene_payload))
            style_anchor = _build_style_anchor(prompt, style)
            semaphore = asyncio.Semaphore(LONG_VIDEO_CONCURRENCY)
            state_lock = asyncio.Lock()
            state = {"finished": 0, "failed": 0, "placeholder": 0}

            async def _sync_task_result(message: str) -> None:
                progress = min(95, int((state["finished"] / total) * 90) + 5)
                result_payload = task_manager.get_task(task_id).get("result")
                task_manager.update_task(
                    task_id,
                    progress=progress,
                    message=message,
                    result=result_payload,
                )

            async def _generate_scene(index: int, scene: Dict[str, Any]) -> str:
                previous_prompt = scene_payload[index - 1]["prompt"] if index > 0 else None

                async with semaphore:
                    optimized = await asyncio.to_thread(
                        _optimize_scene_prompt,
                        scene["prompt"],
                        scene_title=scene["title"],
                        style_anchor=style_anchor,
                        style=style,
                        previous_prompt=previous_prompt,
                    )
                    current_prompt = optimized["final_prompt"]
                    evaluator = optimized["evaluator"]

                    async with state_lock:
                        scene["status"] = "running"
                        scene["final_prompt"] = current_prompt
                        scene["evaluator"] = evaluator
                        await _sync_task_result(f"正在并行生成第 {index + 1}/{total} 段：{scene['title']}")

                    logger.info(
                        "[long_video] wan_call task_id=%s scene=%d/%d title=%r max_attempts=%d",
                        task_id,
                        index + 1,
                        total,
                        scene.get("title"),
                        LONG_VIDEO_MAX_RETRIES + 1,
                    )
                    last_error: Optional[str] = None
                    for attempt in range(1, LONG_VIDEO_MAX_RETRIES + 2):
                        t_call = time.monotonic()
                        generated = await asyncio.to_thread(
                            _dashscope_generate_video,
                            current_prompt,
                            WAN_LONG_VIDEO_MODEL,
                        )
                        logger.info(
                            "[long_video] wan_call_done task_id=%s scene=%d/%d attempt=%d ok=%s elapsed=%.3fs err=%s",
                            task_id,
                            index + 1,
                            total,
                            attempt,
                            bool(generated.get("success")),
                            time.monotonic() - t_call,
                            (generated.get("error") or "")[:160] if not generated.get("success") else "",
                        )
                        if generated.get("success"):
                            local_path = generated.get("local_path")
                            async with state_lock:
                                scene["status"] = "done"
                                scene["attempts"] = attempt
                                scene["retry_count"] = attempt - 1
                                scene["local_path"] = local_path
                                scene["video_url"] = _media_url(local_path) if local_path else generated.get("url")
                                scene["error"] = None
                                state["finished"] += 1
                                await _sync_task_result(f"已完成第 {index + 1}/{total} 段")
                            return local_path

                        last_error = generated.get("error", "unknown")
                        async with state_lock:
                            scene["attempts"] = attempt
                            scene["retry_count"] = max(0, attempt - 1)
                            scene["error"] = last_error

                        if attempt <= LONG_VIDEO_MAX_RETRIES:
                            current_prompt = (
                                f"{current_prompt}。"
                                f"修复要求：{last_error}。"
                                "继续保持主体、服装、场景和光线一致，避免镜头跳变。"
                            )
                            async with state_lock:
                                scene["final_prompt"] = current_prompt
                            continue

                    placeholder_path = await asyncio.to_thread(
                        _create_placeholder_clip,
                        scene.get("duration_sec") or DEFAULT_SEGMENT_SECONDS,
                        os.path.join(OUTPUT_DIR, f"long_video_placeholder_{uuid.uuid4().hex}.mp4"),
                    )
                    async with state_lock:
                        scene["status"] = "placeholder"
                        scene["placeholder"] = True
                        scene["local_path"] = placeholder_path
                        scene["video_url"] = _media_url(placeholder_path)
                        scene["error"] = last_error
                        state["finished"] += 1
                        state["failed"] += 1
                        state["placeholder"] += 1
                        await _sync_task_result(f"第 {index + 1}/{total} 段失败，已写入占位片段")
                    return placeholder_path

            return await asyncio.gather(
                *[_generate_scene(index, scene) for index, scene in enumerate(scene_payload)]
            )

        t_gen = time.monotonic()
        logger.info("[long_video] asyncio_gen_begin task_id=%s", task_id)
        generated_segments = asyncio.run(_run_generation())
        logger.info(
            "[long_video] asyncio_gen_done task_id=%s elapsed=%.3fs paths=%d",
            task_id,
            time.monotonic() - t_gen,
            len(generated_segments),
        )
        total = max(1, len(scene_payload))
        placeholder_count = sum(1 for scene in scene_payload if scene.get("placeholder"))
        failed_ratio = placeholder_count / total
        if failed_ratio > LONG_VIDEO_MAX_FAILED_RATIO:
            result_payload = task_manager.get_task(task_id).get("result") or {}
            result_payload["degraded"] = True
            result_payload["failed_segments"] = placeholder_count
            result_payload["placeholder_segments"] = placeholder_count
            task_manager.update_task(
                task_id,
                status="failed",
                error=f"失败片段过多（{placeholder_count}/{total}）",
                result=result_payload,
                message="长视频生成失败：失败片段超过阈值",
            )
            logger.error(
                "[long_video] run_failed_threshold task_id=%s placeholders=%d/%d elapsed=%.3fs",
                task_id,
                placeholder_count,
                total,
                time.monotonic() - wall0,
            )
            return

        logger.info("[long_video] stitch_begin task_id=%s segments=%d", task_id, len(generated_segments))
        ts = time.monotonic()
        final_path = stitch_long_video(generated_segments)
        logger.info(
            "[long_video] stitch_done task_id=%s path=%s elapsed=%.3fs",
            task_id,
            final_path,
            time.monotonic() - ts,
        )
        final_duration = get_video_duration(final_path)
        result_payload = task_manager.get_task(task_id).get("result") or {}
        result_payload["final_video"] = final_path
        result_payload["final_video_url"] = _media_url(final_path)
        result_payload["duration_sec"] = final_duration
        result_payload["degraded"] = placeholder_count > 0
        result_payload["failed_segments"] = placeholder_count
        result_payload["placeholder_segments"] = placeholder_count

        task_manager.update_task(
            task_id,
            status="completed",
            progress=100,
            result=result_payload,
            message="长视频生成完成" if not placeholder_count else f"长视频生成完成（{placeholder_count} 段已降级占位）",
        )
        logger.info(
            "[long_video] run_complete task_id=%s status=completed degraded=%s total_elapsed=%.3fs video=%s",
            task_id,
            placeholder_count > 0,
            time.monotonic() - wall0,
            result_payload.get("final_video_url") or final_path,
        )
    except Exception as exc:
        logger.error(
            "[long_video] run_exception task_id=%s elapsed=%.3fs err=%s",
            task_id,
            time.monotonic() - wall0,
            exc,
            exc_info=True,
        )
        task_manager.update_task(task_id, status="failed", error=str(exc), message="长视频生成失败")


def get_long_video_task(task_id: str) -> Optional[Dict[str, Any]]:
    task = task_manager.get_task(task_id)
    if not task or task.get("type") != "long_video":
        return None
    return task


@tool
def produce_long_video(prompt: str, duration_sec: int = 30, style: str = "cinematic") -> str:
    """
    长视频工坊专用：基于阿里通义 Wan 的多段分段生成 pipeline，将你描述的主题/脚本拆成多分镜并联渲染并拼接成片。
    适用于「成片较长、多分镜连续叙事」的请求；普通几秒短视频不要用本工具。
    参数：
    - prompt：影片主题与画面叙事要求（可分镜简述）
    - duration_sec：目标总时长秒数，默认 30；用户在对话里明确要更长/更短时再改（约 30–120，系统按比例拆段）
    - style：成片风格基调，默认 cinematic。

    注意：完整渲染可能耗时较长，请等待工具返回后再总结。
    """
    from utils.generation_history import add_generation_record

    cleaned = (prompt or "").strip()
    if not cleaned:
        return "❌ 请提供清晰的创意描述后再生成长视频。"

    bounded = max(
        DEFAULT_SEGMENT_SECONDS,
        min(int(duration_sec), DEFAULT_SEGMENT_SECONDS * MAX_SEGMENTS),
    )
    tid = create_long_video_task(prompt=cleaned, duration_sec=bounded, style=style or "cinematic")
    t_tool = time.monotonic()
    logger.info(
        "[produce_long_video] begin task_id=%s bounded_sec=%s style=%s prompt=%.120r",
        tid,
        bounded,
        style,
        cleaned[:120],
    )
    try:
        run_long_video_task(tid, cleaned, bounded, style or "cinematic")
    except Exception as exc:
        logger.error(
            "[produce_long_video] run_raised task_id=%s elapsed=%.3fs err=%s",
            tid,
            time.monotonic() - t_tool,
            exc,
            exc_info=True,
        )
        return f"❌ 长视频生成链路异常中止：{exc}"

    snapshot = get_long_video_task(tid)
    if not snapshot:
        logger.warning(
            "[produce_long_video] snapshot_missing task_id=%s elapsed=%.3fs",
            tid,
            time.monotonic() - t_tool,
        )
        return f"❌ 任务 {tid} 状态丢失，请到「媒体 → 长视频工坊」查看。"

    if snapshot.get("status") != "completed":
        err = snapshot.get("error") or snapshot.get("message") or "unknown"
        logger.warning(
            "[produce_long_video] not_completed task_id=%s status=%s elapsed=%.3fs detail=%s",
            tid,
            snapshot.get("status"),
            time.monotonic() - t_tool,
            err,
        )
        return f"❌ 长视频未成功完成：{err}\n(task_id=`{tid}`)"

    payload = snapshot.get("result") or {}
    final_url = payload.get("final_video_url") or ""
    duration = payload.get("duration_sec")

    display_path = payload.get("final_video")
    if isinstance(display_path, str) and display_path:
        try:
            add_generation_record(
                "video",
                cleaned,
                final_url or display_path,
                {"pipeline": "long_video_wan", "task_id": tid, "style": style},
            )
        except Exception as hist_err:
            logger.warning("[produce_long_video] generation history skipped: %s", hist_err)

    parts = [
        "✅ 长视频已生成完成（通义 Wan 分段管线）。",
        f"**任务 ID:** `{tid}`",
    ]
    if final_url:
        parts.append(f"**预览 / 外链:** {final_url}")
    if duration is not None:
        parts.append(f"**实际时长:** 约 {duration} 秒")
    if payload.get("degraded"):
        parts.append("（部分片段为降级占位，建议复查成片）")
    parts.append("")
    if final_url:
        parts.append(f"![长视频成片]({final_url})")
    else:
        parts.append("请到媒体库或长视频工坊页下载成片。")

    logger.info(
        "[produce_long_video] success task_id=%s elapsed=%.3fs degraded=%s",
        tid,
        time.monotonic() - t_tool,
        bool(payload.get("degraded")),
    )
    return "\n".join(parts)