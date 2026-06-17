"""
OpenCut 风格专业视频剪辑工具集

借鉴 OpenCut (https://github.com/OpenCut-app/OpenCut) 的设计思想：
- 时间轴轨道（Track）与片段（Element）概念
- 命令式剪辑操作（cut/trim/split/merge/transition/overlay）
- 项目文件 JSON，未来可导出到真正的 OpenCut

当前底层基于 FFmpeg 实现，不依赖 OpenCut 运行时。
"""

import json
import os
import shutil
import subprocess
import uuid
from typing import Any, Dict, List, Optional, Tuple

from tools.media_common import OUTPUT_DIR, TEMP_DIR, get_video_duration, load_media_registry, save_media_registry
from tools.audio_tools import extract_audio_from_video
from utils.logger import setup_logger

logger = setup_logger("opencut_tools")


# ------------------------------------------------------------------
# 工具函数
# ------------------------------------------------------------------
def _check_ffmpeg() -> Optional[str]:
    """检查 FFmpeg 是否可用"""
    if not shutil.which("ffmpeg"):
        return "系统未安装 FFmpeg。请先安装 FFmpeg。"
    return None


def _ensure_output_name(output_name: str, suffix: str = ".mp4") -> str:
    """确保输出文件名有效"""
    if not output_name:
        output_name = f"opencut_{uuid.uuid4()}{suffix}"
    if not output_name.endswith(suffix):
        output_name += suffix
    return output_name


def _run_ffmpeg(cmd: List[str]) -> Tuple[bool, str]:
    """运行 FFmpeg 命令，返回 (success, error_message)"""
    try:
        logger.info("[ffmpeg] %s", " ".join(cmd))
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        return True, ""
    except subprocess.CalledProcessError as e:
        err = e.stderr[-500:] if e.stderr else str(e)
        logger.error("[ffmpeg] failed: %s", err)
        return False, err


def _register_video_output(output_path: str, operation: str, metadata: Dict[str, Any] = None) -> None:
    """将输出视频注册到媒体注册表"""
    try:
        registry = load_media_registry()
        info = {
            "filename": os.path.basename(output_path),
            "type": operation,
            "local_path": output_path,
            "timestamp": __import__('time').strftime("%Y-%m-%d %H:%M:%S"),
        }
        if metadata:
            info["metadata"] = metadata
        registry["videos"].append(info)
        save_media_registry(registry)
    except Exception as e:
        logger.warning("Failed to register output: %s", e)


def _result(success: bool, local_path: str = "", message: str = "", metadata: Dict[str, Any] = None) -> Dict[str, Any]:
    """统一返回结构"""
    return {
        "success": success,
        "local_path": local_path,
        "message": message,
        "metadata": metadata or {},
    }


# ------------------------------------------------------------------
# 核心剪辑工具
# ------------------------------------------------------------------
def cut_video_segment(
    video_path: str,
    start_time: float,
    end_time: float,
    output_name: str = "",
    keep_audio: bool = True,
) -> Dict[str, Any]:
    """
    按起止时间裁剪视频片段（对应 OpenCut 的 trim/split 操作）
    """
    err = _check_ffmpeg()
    if err:
        return _result(False, message=err)
    if not os.path.exists(video_path):
        return _result(False, message=f"视频文件不存在: {video_path}")
    if start_time < 0 or end_time <= start_time:
        return _result(False, message="时间范围无效")

    output_name = _ensure_output_name(output_name, ".mp4")
    output_path = os.path.join(OUTPUT_DIR, output_name)

    duration = end_time - start_time
    cmd = [
        "ffmpeg", "-y", "-i", video_path,
        "-ss", str(start_time), "-t", str(duration),
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
    ]
    if keep_audio:
        cmd.extend(["-c:a", "aac"])
    else:
        cmd.extend(["-an"])
    cmd.append(output_path)

    ok, err = _run_ffmpeg(cmd)
    if not ok:
        return _result(False, message=f"裁剪失败: {err}")

    _register_video_output(output_path, "cut", {"start": start_time, "end": end_time})
    return _result(
        True,
        local_path=output_path,
        message=f"✅ 裁剪成功: {start_time:.2f}s - {end_time:.2f}s",
        metadata={"start": start_time, "end": end_time, "duration": duration},
    )


def split_video(
    video_path: str,
    split_times: List[float],
    output_prefix: str = "",
) -> Dict[str, Any]:
    """
    按多个时间点拆分视频为多个片段（OpenCut split 操作）
    """
    err = _check_ffmpeg()
    if err:
        return _result(False, message=err)
    if not os.path.exists(video_path):
        return _result(False, message=f"视频文件不存在: {video_path}")
    if not split_times:
        return _result(False, message="未提供拆分时间点")

    split_times = sorted([t for t in split_times if t > 0])
    total_duration = get_video_duration(video_path)
    boundaries = [0] + split_times + [total_duration]

    output_prefix = output_prefix or f"opencut_split_{uuid.uuid4()}"
    segments = []
    temp_dir = os.path.join(TEMP_DIR, f"split_{uuid.uuid4()}")
    os.makedirs(temp_dir, exist_ok=True)

    for i in range(len(boundaries) - 1):
        start = boundaries[i]
        end = boundaries[i + 1]
        duration = end - start
        seg_path = os.path.join(temp_dir, f"{output_prefix}_{i:03d}.mp4")
        cmd = [
            "ffmpeg", "-y", "-i", video_path,
            "-ss", str(start), "-t", str(duration),
            "-c:v", "libx264", "-c:a", "aac", "-pix_fmt", "yuv420p",
            seg_path,
        ]
        ok, err = _run_ffmpeg(cmd)
        if not ok:
            return _result(False, message=f"拆分第 {i+1} 段失败: {err}")
        segments.append({
            "index": i,
            "start": start,
            "end": end,
            "local_path": seg_path,
        })

    return _result(
        True,
        message=f"✅ 拆分成功，共 {len(segments)} 段",
        metadata={"segments": segments, "temp_dir": temp_dir},
    )


def merge_clips(
    file_paths: List[str],
    output_name: str = "",
    transition: str = "none",
    transition_duration: float = 0.5,
    output_width: int = 1280,
    output_height: int = 720,
    output_fps: int = 30,
) -> Dict[str, Any]:
    """
    多段视频/图片拼接（增强版 merge，支持转场）

    借鉴 OpenCut timeline 的 track/element 概念：
    每个输入文件视为一个 clip element，按顺序放在主 video track 上。
    """
    err = _check_ffmpeg()
    if err:
        return _result(False, message=err)
    if len(file_paths) < 2:
        return _result(False, message="至少需要 2 个素材")

    valid_files = [fp for fp in file_paths if os.path.exists(fp)]
    if len(valid_files) < 2:
        return _result(False, message="有效素材少于 2 个")

    output_name = _ensure_output_name(output_name, ".mp4")
    output_path = os.path.join(OUTPUT_DIR, output_name)
    temp_dir = os.path.join(TEMP_DIR, f"merge_{uuid.uuid4()}")
    os.makedirs(temp_dir, exist_ok=True)

    # 1. 统一尺寸格式
    processed = []
    for i, fp in enumerate(valid_files):
        ext = os.path.splitext(fp)[1].lower()
        out = os.path.join(temp_dir, f"clip_{i:03d}.mp4")
        if ext in [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"]:
            # 图片默认 3 秒
            cmd = [
                "ffmpeg", "-y", "-loop", "1", "-i", fp,
                "-c:v", "libx264", "-t", "3",
                "-pix_fmt", "yuv420p", "-r", str(output_fps),
                "-vf", f"scale={output_width}:{output_height}:force_original_aspect_ratio=decrease,pad={output_width}:{output_height}:(ow-iw)/2:(oh-ih)/2",
                "-an", out,
            ]
        else:
            cmd = [
                "ffmpeg", "-y", "-i", fp,
                "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", str(output_fps),
                "-vf", f"scale={output_width}:{output_height}:force_original_aspect_ratio=decrease,pad={output_width}:{output_height}:(ow-iw)/2:(oh-ih)/2",
                "-an", out,
            ]
        ok, ferr = _run_ffmpeg(cmd)
        if ok:
            processed.append(out)

    if len(processed) < 2:
        return _result(False, message="有效处理后的素材少于 2 个")

    # 2. 简单转场：使用 xfade 滤镜（需要 FFmpeg 4.4+）
    if transition != "none" and len(processed) > 1:
        transition_map = {
            "fade": "fade",
            "wipeleft": "wipeleft",
            "wiperight": "wiperight",
            "slideleft": "slideleft",
            "slideright": "slideright",
            "zoomin": "zoomin",
            "zoomout": "zoomout",
        }
        xf = transition_map.get(transition, "fade")
        try:
            # 构建 xfade 滤镜链
            inputs = []
            for i, p in enumerate(processed):
                inputs.extend(["-i", p])
            # 计算每段时长
            durations = [get_video_duration(p) for p in processed]
            # 生成 xfade 表达式
            filters = []
            offset = 0.0
            for i in range(len(processed) - 1):
                d = durations[i]
                if i == 0:
                    filters.append(f"[0:v][1:v]xfade=transition={xf}:duration={transition_duration}:offset={d - transition_duration}[v1]")
                else:
                    filters.append(f"[v{i}][{i+1}:v]xfade=transition={xf}:duration={transition_duration}:offset={offset + d - transition_duration}[v{i+1}]")
                offset += d - transition_duration
            vf = ";".join(filters)
            # 音频拼接
            af = "".join([f"[{i}:a]" for i in range(len(processed))]) + f"concat=n={len(processed)}:v=0:a=1[aout]"
            cmd = ["ffmpeg", "-y"] + inputs + [
                "-filter_complex", f"{vf};{af}",
                "-map", f"[v{len(processed)-1}]", "-map", "[aout]",
                "-c:v", "libx264", "-c:a", "aac", "-pix_fmt", "yuv420p",
                output_path,
            ]
            ok, ferr = _run_ffmpeg(cmd)
            if not ok:
                # xfade 可能失败，回退到简单 concat
                logger.warning("xfade failed, fallback to concat: %s", ferr)
                transition = "none"
        except Exception as e:
            logger.warning("transition build failed: %s", e)
            transition = "none"

    # 3. 无转场：concat 协议
    if transition == "none":
        concat_file = os.path.join(temp_dir, "concat.txt")
        with open(concat_file, "w") as f:
            for p in processed:
                f.write(f"file '{p}'\n")
        cmd = [
            "ffmpeg", "-y", "-f", "concat", "-safe", "0",
            "-i", concat_file, "-c:v", "libx264", "-c:a", "aac",
            "-pix_fmt", "yuv420p", output_path,
        ]
        ok, ferr = _run_ffmpeg(cmd)
        if not ok:
            return _result(False, message=f"拼接失败: {ferr}")

    _register_video_output(output_path, "merge", {
        "source_files": [os.path.basename(f) for f in valid_files],
        "transition": transition,
    })
    return _result(
        True,
        local_path=output_path,
        message=f"✅ 拼接成功，共 {len(processed)} 段" + (f"，转场: {transition}" if transition != "none" else ""),
        metadata={"sources": valid_files, "transition": transition},
    )


def change_video_speed(
    video_path: str,
    speed: float,
    output_name: str = "",
    keep_pitch: bool = True,
) -> Dict[str, Any]:
    """
    视频变速（恒定变速），可选保持音调
    """
    err = _check_ffmpeg()
    if err:
        return _result(False, message=err)
    if not os.path.exists(video_path):
        return _result(False, message=f"视频文件不存在: {video_path}")
    if speed <= 0:
        return _result(False, message="变速倍数必须大于 0")

    output_name = _ensure_output_name(output_name, ".mp4")
    output_path = os.path.join(OUTPUT_DIR, output_name)

    # setpts 控制视频速度，atempo 控制音频速度
    video_filter = f"setpts=PTS/{speed}"
    audio_filter = ""
    if keep_pitch:
        # atemp 只支持 0.5-2.0，需要拆分
        if 0.5 <= speed <= 2.0:
            audio_filter = f"atempo={speed}"
        else:
            audio_filter = ""

    vf = video_filter
    af = audio_filter
    cmd = ["ffmpeg", "-y", "-i", video_path]
    if vf and af:
        cmd.extend(["-vf", vf, "-af", af])
    elif vf:
        cmd.extend(["-vf", vf, "-an"])
    cmd.extend(["-c:v", "libx264", "-pix_fmt", "yuv420p", output_path])

    ok, ferr = _run_ffmpeg(cmd)
    if not ok:
        return _result(False, message=f"变速失败: {ferr}")

    _register_video_output(output_path, "speed", {"speed": speed, "keep_pitch": keep_pitch})
    return _result(
        True,
        local_path=output_path,
        message=f"✅ 变速完成: {speed}x",
        metadata={"speed": speed},
    )


def overlay_video(
    background_path: str,
    overlay_path: str,
    output_name: str = "",
    position: Tuple[float, float] = (0.05, 0.05),
    scale_ratio: float = 0.25,
    start_time: float = 0,
    end_time: Optional[float] = None,
) -> Dict[str, Any]:
    """
    画中画 / 视频叠加（OpenCut overlay track 概念）

    position: (x_ratio, y_ratio) 相对于背景宽高的比例，如 (0.05, 0.05) 为左上角
    scale_ratio: 叠加视频宽度占背景宽度的比例
    """
    err = _check_ffmpeg()
    if err:
        return _result(False, message=err)
    if not os.path.exists(background_path) or not os.path.exists(overlay_path):
        return _result(False, message="背景或叠加视频文件不存在")

    output_name = _ensure_output_name(output_name, ".mp4")
    output_path = os.path.join(OUTPUT_DIR, output_name)

    x_expr = f"main_w*{position[0]}"
    y_expr = f"main_h*{position[1]}"
    overlay_w = f"main_w*{scale_ratio}"
    overlay_h = f"-1"  # 保持比例

    # 处理时间范围
    enable_expr = f"between(t,{start_time},{end_time})" if end_time else f"gte(t,{start_time})"

    filter_complex = (
        f"[1:v]scale={overlay_w}:{overlay_h}[ov];"
        f"[0:v][ov]overlay={x_expr}:{y_expr}:enable='{enable_expr}'[v]"
    )

    cmd = [
        "ffmpeg", "-y", "-i", background_path, "-i", overlay_path,
        "-filter_complex", filter_complex,
        "-map", "[v]", "-map", "0:a?",
        "-c:v", "libx264", "-c:a", "aac", "-pix_fmt", "yuv420p",
        output_path,
    ]

    ok, ferr = _run_ffmpeg(cmd)
    if not ok:
        return _result(False, message=f"叠加失败: {ferr}")

    _register_video_output(output_path, "overlay", {
        "background": background_path,
        "overlay": overlay_path,
        "position": position,
    })
    return _result(
        True,
        local_path=output_path,
        message="✅ 画中画叠加成功",
        metadata={"position": position, "scale_ratio": scale_ratio},
    )


def add_text_overlay(
    video_path: str,
    text: str,
    output_name: str = "",
    position: str = "bottom",
    font_size: int = 48,
    font_color: str = "white",
    start_time: float = 0,
    end_time: Optional[float] = None,
    box: bool = False,
    box_color: str = "black@0.5",
) -> Dict[str, Any]:
    """
    在视频上叠加文字（标题/字幕）
    """
    err = _check_ffmpeg()
    if err:
        return _result(False, message=err)
    if not os.path.exists(video_path):
        return _result(False, message=f"视频文件不存在: {video_path}")

    output_name = _ensure_output_name(output_name, ".mp4")
    output_path = os.path.join(OUTPUT_DIR, output_name)

    # 位置映射
    pos_map = {
        "top": "x=(w-text_w)/2:y=48",
        "bottom": "x=(w-text_w)/2:y=h-text_h-48",
        "center": "x=(w-text_w)/2:y=(h-text_h)/2",
        "left": "x=48:y=(h-text_h)/2",
        "right": "x=w-text_w-48:y=(h-text_h)/2",
    }
    pos = pos_map.get(position, pos_map["bottom"])

    # 转义特殊字符
    safe_text = text.replace("'", "\\'").replace(":", "\\:")
    enable_expr = f"between(t,{start_time},{end_time})" if end_time else f"gte(t,{start_time})"

    drawtext = (
        f"drawtext=text='{safe_text}':{pos}:"
        f"fontsize={font_size}:fontcolor={font_color}:"
        f"enable='{enable_expr}'"
    )
    if box:
        drawtext += f":box=1:boxcolor={box_color}"

    cmd = [
        "ffmpeg", "-y", "-i", video_path,
        "-vf", drawtext,
        "-c:v", "libx264", "-c:a", "copy", "-pix_fmt", "yuv420p",
        output_path,
    ]

    ok, ferr = _run_ffmpeg(cmd)
    if not ok:
        return _result(False, message=f"文字叠加失败: {ferr}")

    _register_video_output(output_path, "text_overlay", {"text": text, "position": position})
    return _result(
        True,
        local_path=output_path,
        message=f"✅ 文字叠加成功: {text[:20]}",
        metadata={"text": text, "position": position},
    )


def apply_video_filter(
    video_path: str,
    filter_name: str,
    output_name: str = "",
) -> Dict[str, Any]:
    """
    应用视频滤镜/调色

    支持滤镜:
    - grayscale: 黑白
    - sepia: 复古
    - blur: 高斯模糊
    - sharpen: 锐化
    - brightness: 增亮
    - contrast: 增强对比度
    - vignette: 暗角
    """
    err = _check_ffmpeg()
    if err:
        return _result(False, message=err)
    if not os.path.exists(video_path):
        return _result(False, message=f"视频文件不存在: {video_path}")

    output_name = _ensure_output_name(output_name, ".mp4")
    output_path = os.path.join(OUTPUT_DIR, output_name)

    filter_map = {
        "grayscale": "colorchannelmixer=.3:.4:.3:0:.3:.4:.3:0:.3:.4:.3",
        "sepia": "colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131",
        "blur": "gblur=sigma=2",
        "sharpen": "unsharp=3:3:1.5",
        "brightness": "eq=brightness=0.1",
        "contrast": "eq=contrast=1.5",
        "vignette": "vignette=PI/4",
    }
    vf = filter_map.get(filter_name)
    if not vf:
        return _result(False, message=f"不支持的滤镜: {filter_name}")

    cmd = [
        "ffmpeg", "-y", "-i", video_path,
        "-vf", vf,
        "-c:v", "libx264", "-c:a", "copy", "-pix_fmt", "yuv420p",
        output_path,
    ]

    ok, ferr = _run_ffmpeg(cmd)
    if not ok:
        return _result(False, message=f"滤镜应用失败: {ferr}")

    _register_video_output(output_path, "filter", {"filter": filter_name})
    return _result(
        True,
        local_path=output_path,
        message=f"✅ 滤镜应用成功: {filter_name}",
        metadata={"filter": filter_name},
    )


def extract_audio_track(
    video_path: str,
    output_name: str = "",
) -> Dict[str, Any]:
    """从视频中提取音频轨道"""
    err = _check_ffmpeg()
    if err:
        return _result(False, message=err)
    if not os.path.exists(video_path):
        return _result(False, message=f"视频文件不存在: {video_path}")

    if not output_name:
        output_name = f"opencut_audio_{uuid.uuid4()}.wav"
    if not output_name.endswith(".wav"):
        output_name += ".wav"
    output_path = os.path.join(OUTPUT_DIR, output_name)

    cmd = [
        "ffmpeg", "-y", "-i", video_path,
        "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1",
        output_path,
    ]
    ok, ferr = _run_ffmpeg(cmd)
    if not ok:
        return _result(False, message=f"音频提取失败: {ferr}")

    return _result(
        True,
        local_path=output_path,
        message="✅ 音频提取成功",
    )


def replace_audio_track(
    video_path: str,
    audio_path: str,
    output_name: str = "",
    mix_volume: float = 1.0,
) -> Dict[str, Any]:
    """替换或混合音轨"""
    err = _check_ffmpeg()
    if err:
        return _result(False, message=err)
    if not os.path.exists(video_path) or not os.path.exists(audio_path):
        return _result(False, message="视频或音频文件不存在")

    output_name = _ensure_output_name(output_name, ".mp4")
    output_path = os.path.join(OUTPUT_DIR, output_name)

    cmd = [
        "ffmpeg", "-y", "-i", video_path, "-i", audio_path,
        "-map", "0:v", "-map", "1:a",
        "-c:v", "copy", "-c:a", "aac",
        "-shortest",
        output_path,
    ]
    ok, ferr = _run_ffmpeg(cmd)
    if not ok:
        return _result(False, message=f"音轨替换失败: {ferr}")

    _register_video_output(output_path, "replace_audio", {
        "audio_source": os.path.basename(audio_path),
    })
    return _result(
        True,
        local_path=output_path,
        message="✅ 音轨替换成功",
    )


# ------------------------------------------------------------------
# OpenCut 项目文件生成（未来兼容）
# ------------------------------------------------------------------
def generate_opencut_project(
    clips: List[Dict[str, Any]],
    output_name: str = "",
) -> Dict[str, Any]:
    """
    生成 OpenCut 风格的项目 JSON 文件

    借鉴 OpenCut classic 的 timeline/element 数据模型：
    - tracks: 轨道列表（video/audio/text/overlay）
    - elements: 轨道上的片段，含 start/end/trim/source
    """
    if not output_name:
        output_name = f"opencut_project_{uuid.uuid4()}.json"
    if not output_name.endswith(".json"):
        output_name += ".json"
    output_path = os.path.join(OUTPUT_DIR, output_name)

    tracks = []
    for clip in clips:
        track_type = clip.get("type", "video")
        tracks.append({
            "id": f"track_{uuid.uuid4().hex[:8]}",
            "type": track_type,
            "name": clip.get("name", f"{track_type}_track"),
            "elements": [{
                "id": f"el_{uuid.uuid4().hex[:8]}",
                "type": track_type,
                "source": clip.get("source"),
                "start": clip.get("start", 0),
                "end": clip.get("end"),
                "trim_start": clip.get("trim_start", 0),
                "trim_end": clip.get("trim_end", 0),
                "position": clip.get("position"),
                "scale": clip.get("scale"),
                "filter": clip.get("filter"),
            }],
        })

    project = {
        "version": "1.0.0",
        "editor": "ai-media-agent-opencut",
        "description": "OpenCut-compatible project generated by AI Media Agent",
        "timeline": {
            "tracks": tracks,
            "resolution": {"width": 1280, "height": 720},
            "fps": 30,
        },
    }

    try:
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(project, f, ensure_ascii=False, indent=2)
        return _result(
            True,
            local_path=output_path,
            message="✅ OpenCut 项目文件生成成功",
            metadata={"tracks_count": len(tracks)},
        )
    except Exception as e:
        return _result(False, message=f"项目文件生成失败: {e}")


# ------------------------------------------------------------------
# 复合操作：一键执行剪辑脚本
# ------------------------------------------------------------------
def execute_edit_script(
    script: Dict[str, Any],
    output_name: str = "",
) -> Dict[str, Any]:
    """
    执行由 LLM 生成的剪辑脚本（JSON 格式）

    script 结构:
    {
        "operation": "edit",
        "source": "/path/to/video.mp4",
        "steps": [
            {"tool": "cut_video_segment", "start": 0, "end": 10},
            {"tool": "change_video_speed", "speed": 1.5},
            {"tool": "add_text_overlay", "text": "Hello OpenCut", "position": "center"},
            {"tool": "apply_video_filter", "filter_name": "sepia"}
        ]
    }
    """
    err = _check_ffmpeg()
    if err:
        return _result(False, message=err)

    source = script.get("source")
    if not source or not os.path.exists(source):
        return _result(False, message="脚本中 source 视频不存在")

    steps = script.get("steps", [])
    if not steps:
        return _result(False, message="脚本中没有步骤")

    current_video = source
    executed = []

    for i, step in enumerate(steps):
        tool_name = step.get("tool")
        params = {k: v for k, v in step.items() if k != "tool"}
        params["video_path"] = current_video
        params["output_name"] = f"opencut_script_{i:03d}_{uuid.uuid4()}.mp4"

        tool_fn = globals().get(tool_name)
        if not tool_fn:
            return _result(False, message=f"未知工具: {tool_name}")

        result = tool_fn(**params)
        if not result.get("success"):
            return _result(False, message=f"步骤 {i+1} ({tool_name}) 失败: {result.get('message')}")

        current_video = result["local_path"]
        executed.append({"step": i + 1, "tool": tool_name, "output": current_video})

    # 最终重命名为用户指定名
    if output_name:
        final_path = os.path.join(OUTPUT_DIR, _ensure_output_name(output_name, ".mp4"))
        shutil.copy2(current_video, final_path)
        current_video = final_path

    _register_video_output(current_video, "edit_script", {"steps": len(executed)})
    return _result(
        True,
        local_path=current_video,
        message=f"✅ 剪辑脚本执行成功，共 {len(executed)} 步",
        metadata={"executed": executed},
    )
