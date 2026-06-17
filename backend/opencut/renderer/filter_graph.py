"""
将渲染树转换为 FFmpeg filter_complex

MVP 支持：
- 多视频/图片按时间轴 overlay
- 文字叠加
- 多音频 amix
- 背景色
"""

import os
import shutil
import subprocess
from typing import Any, Dict, List

from opencut.renderer.scene_builder import (
    AudioNode,
    BackgroundNode,
    ImageNode,
    RenderNode,
    TextNode,
    VideoNode,
)
from utils.logger import setup_logger

logger = setup_logger("opencut_filter_graph")


def _safe_path(path: str) -> str:
    """转义 FFmpeg 路径中的特殊字符"""
    return path.replace("\\", "/").replace(":", "\\:")


def _has_audio_stream(file_path: str) -> bool:
    """检测文件是否包含音频流"""
    if not shutil.which("ffprobe"):
        return True
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_type", "-of", "default=noprint_wrappers=1", file_path],
            capture_output=True, text=True, check=True,
        )
        return "codec_type=audio" in result.stdout
    except Exception:
        return False


def _apply_video_filters(
    filter_parts: List[str],
    base_label: str,
    out_label: str,
    node: Any,
    width: int,
    height: int,
) -> str:
    """为视频/图片节点应用调色、特效、遮罩，返回最终 label"""
    params = getattr(node, "params", {}) or {}
    filters: List[str] = []

    # 基础调色
    brightness = float(params.get("brightness", 1.0))
    contrast = float(params.get("contrast", 1.0))
    saturation = float(params.get("saturation", 1.0))
    if brightness != 1.0 or contrast != 1.0 or saturation != 1.0:
        # eq 的 brightness 范围 [-1,1]，默认值 0
        b = max(-1.0, min(1.0, brightness - 1.0))
        c = max(0.0, min(2.0, contrast))
        s = max(0.0, min(3.0, saturation))
        filters.append(f"eq=brightness={b}:contrast={c}:saturation={s}")

    # 模糊
    blur = float(params.get("blur", 0.0))
    if blur > 0:
        radius = max(0.1, blur)
        filters.append(f"gblur=sigma={radius}")

    # 棕褐色
    if float(params.get("sepia", 0.0)) > 0:
        filters.append("colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131")

    # 灰度
    if float(params.get("grayscale", 0.0)) > 0:
        filters.append("colorchannelmixer=.299:.587:.114:0:.299:.587:.114:0:.299:.587:.114")

    # 淡入淡出
    fade_in = float(params.get("fadeIn", 0.0))
    fade_out = float(params.get("fadeOut", 0.0))
    if fade_in > 0:
        filters.append(f"fade=t=in:st={node.start_time}:d={min(fade_in, node.duration)}")
    if fade_out > 0:
        start = node.start_time + node.duration - min(fade_out, node.duration)
        filters.append(f"fade=t=out:st={max(node.start_time, start)}:d={min(fade_out, node.duration)}")

    # 遮罩
    mask_type = params.get("maskType")
    if mask_type == "cinematic-bars":
        bar_h = int(height * 0.1)
        filters.append(f"drawbox=y=0:w=iw:h={bar_h}:color=black:t=fill")
        filters.append(f"drawbox=y=ih-{bar_h}:w=iw:h={bar_h}:color=black:t=fill")
    elif mask_type == "rectangle":
        mw = float(params.get("maskWidth", 0.5))
        mh = float(params.get("maskHeight", 0.5))
        mx = float(params.get("maskCenterX", 0.5))
        my = float(params.get("maskCenterY", 0.5))
        crop_w = int(mw * width)
        crop_h = int(mh * height)
        crop_x = int((mx - mw / 2) * width)
        crop_y = int((my - mh / 2) * height)
        crop_x = max(0, min(crop_x, width - crop_w))
        crop_y = max(0, min(crop_y, height - crop_h))
        filters.append(f"crop=w={crop_w}:h={crop_h}:x={crop_x}:y={crop_y}")
        filters.append(f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:black")

    if filters:
        filter_parts.append(f"[{base_label}]{','.join(filters)}[{out_label}]")
        return out_label
    return base_label


def _build_video_filter_graph(
    video_nodes: List[RenderNode],
    background_nodes: List[RenderNode],
    width: int,
    height: int,
    fps: float,
    total_duration: float,
) -> tuple:
    """
    构建视频 filter_complex

    返回: (video_inputs, video_filter_complex, output_label)
    """
    inputs = []
    filter_parts = []
    current_label = None

    # 背景
    bg = background_nodes[0] if background_nodes else BackgroundNode()
    if bg.background_type == "color":
        filter_parts.append(f"color=c={bg.color}:s={width}x{height}:d={total_duration}:r={fps}[bg]")
    else:
        filter_parts.append(f"color=c=black:s={width}x{height}:d={total_duration}:r={fps}[bg]")
    current_label = "bg"

    if not video_nodes:
        return inputs, ";".join(filter_parts), "[bg]"

    for i, node in enumerate(video_nodes):
        if isinstance(node, (VideoNode, ImageNode)):
            file_path = node.file_path
            if not os.path.exists(file_path):
                logger.warning("Media file not found: %s", file_path)
                continue

            inputs.append(("-i", file_path))
            input_idx = len(inputs) - 1

            # 对于图片，需要 loop
            is_image = isinstance(node, ImageNode)

            if is_image:
                # 图片：loop + trim
                filter_parts.append(
                    f"[{input_idx}:v]loop=loop=-1:size=1:start=0,"
                    f"trim=start=0:end={node.duration},"
                    f"setpts=PTS-STARTPTS+{node.start_time}/TB,"
                    f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
                    f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2[clip{i}]"
                )
            else:
                # 视频：trim + setpts
                trim_end = node.duration + node.trim_start
                filter_parts.append(
                    f"[{input_idx}:v]trim=start={node.trim_start}:end={trim_end},"
                    f"setpts=PTS-STARTPTS+{node.start_time}/TB,"
                    f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
                    f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2[clip{i}]"
                )

            # 应用调色/特效/遮罩
            effect_label = _apply_video_filters(
                filter_parts=filter_parts,
                base_label=f"clip{i}",
                out_label=f"clip{i}_e",
                node=node,
                width=width,
                height=height,
            )

            # overlay transform
            tx = int((node.transform.x - 0.5) * width)
            ty = int((0.5 - node.transform.y) * height)
            opacity = node.transform.opacity
            rotate = node.transform.rotation
            scale = node.transform.scale_x

            transform_label = effect_label
            if rotate != 0 or scale != 1.0:
                transform_label = f"clip{i}_t"
                filter_parts.append(
                    f"[{effect_label}]rotate={rotate}*PI/180:ow=rotw({rotate}*PI/180):oh=roth({rotate}*PI/180):c=none,"
                    f"scale=iw*{scale}:ih*{scale}[{transform_label}]"
                )

            if opacity < 1.0:
                opacity_label = f"clip{i}_a"
                filter_parts.append(
                    f"[{transform_label}]format=rgba,colorchannelmixer=aa={opacity}[{opacity_label}]"
                )
                transform_label = opacity_label

            next_label = f"v{i}"
            # overlay 第一个输入是底图，第二个输入是叠加上去的图层
            filter_parts.append(
                f"[{current_label}][{transform_label}]overlay={tx}:{ty}:format=auto:"
                f"enable='between(t,{node.start_time},{node.start_time + node.duration})'[{next_label}]"
            )
            current_label = next_label

        elif isinstance(node, TextNode):
            # 文字叠加
            safe_text = node.text.replace("'", "\\\\'")
            pos_map = {
                "top": f"x=(w-text_w)/2:y=48",
                "bottom": f"x=(w-text_w)/2:y=h-text_h-48",
                "center": f"x=(w-text_w)/2:y=(h-text_h)/2",
                "left": f"x=48:y=(h-text_h)/2",
                "right": f"x=w-text_w-48:y=(h-text_h)/2",
            }
            pos = pos_map.get(node.position, pos_map["bottom"])
            next_label = f"v{i}"
            filter_parts.append(
                f"[{current_label}]drawtext=text='{safe_text}':{pos}:"
                f"fontsize={node.font_size}:fontcolor={node.font_color}:"
                f"enable='between(t,{node.start_time},{node.start_time + node.duration})'[{next_label}]"
            )
            current_label = next_label

    return inputs, ";".join(filter_parts), f"[{current_label}]"


def _build_audio_filter_graph(
    audio_nodes: List[RenderNode],
    total_duration: float,
) -> tuple:
    """
    构建音频 filter_complex

    返回: (audio_inputs, audio_filter_complex, output_label)
    """
    inputs = []
    clip_labels = []

    for i, node in enumerate(audio_nodes):
        if not isinstance(node, AudioNode):
            continue
        file_path = node.file_path
        if not os.path.exists(file_path):
            logger.warning("Audio file not found: %s", file_path)
            continue
        if not _has_audio_stream(file_path):
            logger.warning("No audio stream in file: %s", file_path)
            continue

        inputs.append(("-i", file_path))
        input_idx = len(inputs) - 1

        trim_end = node.duration + node.trim_start
        volume = node.volume
        retime = node.retime

        # atempo 只支持 0.5-2.0，需要拆分
        atempo = ""
        if retime != 1.0:
            if 0.5 <= retime <= 2.0:
                atempo = f",atempo={retime}"
            else:
                # 不支持范围外的变速，忽略
                pass

        label = f"a{i}"
        filter_parts = (
            f"[{input_idx}:a]atrim=start={node.trim_start}:end={trim_end},"
            f"asetpts=PTS-STARTPTS+{node.start_time}/TB"
            f"{atempo},"
            f"adelay=delays={int(node.start_time * 1000)}|{int(node.start_time * 1000)},"
            f"volume={volume}[{label}]"
        )
        clip_labels.append(label)

    if not clip_labels:
        # 无音频，生成静音
        return [], f"anullsrc=r=44100:cl=stereo[dummy];[dummy]atrim=0:{total_duration}[aout]", "[aout]"

    if len(clip_labels) == 1:
        return inputs, f"[{clip_labels[0]}]atrim=0:{total_duration},asetpts=PTS-STARTPTS[aout]", "[aout]"

    # amix
    inputs_str = "".join([f"[{l}]" for l in clip_labels])
    return inputs, f"{inputs_str}amix=inputs={len(clip_labels)}:duration=longest[aout]", "[aout]"


def build_ffmpeg_command(
    video_nodes: List[RenderNode],
    audio_nodes: List[RenderNode],
    background_nodes: List[RenderNode],
    output_path: str,
    width: int,
    height: int,
    fps: float,
    total_duration: float,
) -> List[str]:
    """构建完整 FFmpeg 命令"""
    v_inputs, v_filter, v_out = _build_video_filter_graph(
        video_nodes, background_nodes, width, height, fps, total_duration
    )
    a_inputs, a_filter, a_out = _build_audio_filter_graph(audio_nodes, total_duration)

    # 合并 filter_complex
    filters = []
    if v_filter:
        filters.append(v_filter)
    if a_filter:
        filters.append(a_filter)
    filter_complex = ";".join(filters)

    cmd = ["ffmpeg", "-y"]
    for flag, path in v_inputs:
        cmd.extend([flag, path])
    for flag, path in a_inputs:
        cmd.extend([flag, path])

    cmd.extend(["-filter_complex", filter_complex])
    cmd.extend(["-map", v_out])
    cmd.extend(["-map", a_out])
    cmd.extend([
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-r", str(fps),
        "-c:a", "aac",
        "-ar", "44100",
        "-ac", "2",
        "-t", str(total_duration),
        output_path,
    ])

    return cmd
