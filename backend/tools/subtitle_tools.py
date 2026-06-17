"""
字幕工具 — 独立模块
支持功能: 字幕生成 (SRT), 字幕烧录 (Pillow/FFmpeg), ASR字幕自动化
"""
import os
import time
import uuid
import json
import shutil
import subprocess
from typing import Dict, List, Optional

try:
    from PIL import Image, ImageDraw, ImageFont
    PILLOW_AVAILABLE = True
except ImportError:
    PILLOW_AVAILABLE = False

from utils.logger import setup_logger
from tools.media_common import (
    OUTPUT_DIR, get_video_duration
)
from tools.audio_tools import (
    generate_narration_script,
    extract_audio_from_video,
    transcribe_audio_whisper,
    transcribe_audio_glm_asr
)

logger = setup_logger("subtitle_tools")


# 字幕样式预设
SUBTITLE_STYLES = [
    {"id": "default", "name": "默认样式", "fontsize": 24, "fontcolor": "white", "borderw": 2},
    {"id": "modern", "name": "现代简约", "fontsize": 28, "fontcolor": "white", "borderw": 0, "shadowcolor": "black@0.5"},
    {"id": "cinematic", "name": "电影字幕", "fontsize": 32, "fontcolor": "white", "borderw": 3, "bordercolor": "black"},
    {"id": "vibrant", "name": "活力彩色", "fontsize": 26, "fontcolor": "yellow", "borderw": 2, "bordercolor": "black"},
    {"id": "minimal", "name": "极简风格", "fontsize": 22, "fontcolor": "white@0.9", "borderw": 1},
]


def generate_subtitle_for_video(client, video_prompt: str, title: str = "") -> str:
    """生成适合嵌入视频的简短字幕文案"""
    prompt = f"""请为以下视频内容生成一句简短的字幕文案，将显示在视频画面底部。

## 视频内容：
{video_prompt}

## 视频标题：
{title or '创意视频'}

## 要求：
1. 字幕文案要简洁有力，不超过20个字
2. 能够概括视频主题或传达核心信息
3. 适合作为视频画面中的文字标题/字幕

请直接输出字幕文案，不要包含任何格式标记或说明。"""

    try:
        response = client.chat.completions.create(
            model="glm-4-plus",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=100
        )
        subtitle = response.choices[0].message.content.strip()
        subtitle = subtitle.strip('"\'""''')
        return subtitle[:30]
    except Exception as e:
        logger.error(f"Subtitle generation failed: {e}")
        return title[:20] if title else ""


def add_subtitle_to_prompt(original_prompt: str, subtitle_text: str) -> str:
    """将字幕要求添加到视频生成prompt中"""
    if not subtitle_text:
        return original_prompt
    
    subtitle_instruction = f'。画面底部居中位置显示白色中文字幕："{subtitle_text}"，字幕清晰可读，带黑色描边。'
    return original_prompt + subtitle_instruction


def generate_subtitle_text(
    client,
    video_description: str,
    narration_text: str = "",
    style: str = "informative"
) -> str:
    """生成字幕文本（如果没有配音文案，则生成新的）"""
    if narration_text:
        return narration_text
    return generate_narration_script(client, video_description, style)


def generate_subtitle_image(
    text: str,
    video_width: int = 1280,
    video_height: int = 720,
    style: str = "default",
    position: str = "bottom",
    output_path: str = ""
) -> Dict:
    """使用Pillow生成字幕图片（透明背景PNG）"""
    if not PILLOW_AVAILABLE:
        return {"success": False, "error": "Pillow库未安装，无法生成字幕图片"}
    
    if not text:
        return {"success": False, "error": "字幕文本为空"}
    
    try:
        style_configs = {
            "default": {
                "font_color": (255, 255, 255, 255),
                "stroke_color": (0, 0, 0, 255),
                "stroke_width": 3,
                "shadow": True,
                "font_size_ratio": 0.04
            },
            "modern": {
                "font_color": (255, 255, 255, 255),
                "stroke_color": (50, 50, 50, 200),
                "stroke_width": 2,
                "shadow": True,
                "font_size_ratio": 0.045
            },
            "cinematic": {
                "font_color": (255, 255, 200, 255),
                "stroke_color": (0, 0, 0, 255),
                "stroke_width": 4,
                "shadow": True,
                "font_size_ratio": 0.05
            },
            "vibrant": {
                "font_color": (255, 255, 0, 255),
                "stroke_color": (0, 0, 0, 255),
                "stroke_width": 3,
                "shadow": True,
                "font_size_ratio": 0.045
            },
            "minimal": {
                "font_color": (255, 255, 255, 230),
                "stroke_color": (0, 0, 0, 180),
                "stroke_width": 1,
                "shadow": False,
                "font_size_ratio": 0.035
            }
        }
        
        config = style_configs.get(style, style_configs["default"])
        font_size = int(video_height * config["font_size_ratio"])
        
        # 查找字体
        font_paths = [
            "/System/Library/Fonts/PingFang.ttc",
            "/System/Library/Fonts/STHeiti Light.ttc",
            "/System/Library/Fonts/STHeiti Medium.ttc",
            "/Library/Fonts/Arial Unicode.ttf",
            "/System/Library/Fonts/Hiragino Sans GB.ttc",
            "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
            "C:/Windows/Fonts/msyh.ttc",
            "C:/Windows/Fonts/simhei.ttf",
        ]
        
        font = None
        for font_path in font_paths:
            if os.path.exists(font_path):
                try:
                    font = ImageFont.truetype(font_path, font_size)
                    break
                except Exception:
                    continue
        
        if font is None:
            font = ImageFont.load_default()
            logger.warning("使用默认字体（可能不支持中文）")
        
        img = Image.new('RGBA', (video_width, video_height), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)
        
        bbox = draw.textbbox((0, 0), text, font=font)
        text_width = bbox[2] - bbox[0]
        text_height = bbox[3] - bbox[1]
        
        # 自动换行
        max_width = int(video_width * 0.9)
        if text_width > max_width:
            chars_per_line = int(len(text) * max_width / text_width)
            lines = []
            for i in range(0, len(text), chars_per_line):
                lines.append(text[i:i+chars_per_line])
            text = '\n'.join(lines)
            bbox = draw.textbbox((0, 0), text, font=font)
            text_width = bbox[2] - bbox[0]
            text_height = bbox[3] - bbox[1]
        
        x = (video_width - text_width) // 2
        
        if position == "top":
            y = int(video_height * 0.1)
        elif position == "center":
            y = (video_height - text_height) // 2
        else:
            y = int(video_height * 0.85) - text_height
        
        if config["shadow"]:
            draw.text((x + 3, y + 3), text, font=font, fill=(0, 0, 0, 128))
        
        stroke_width = config["stroke_width"]
        stroke_color = config["stroke_color"]
        for dx in range(-stroke_width, stroke_width + 1):
            for dy in range(-stroke_width, stroke_width + 1):
                if dx != 0 or dy != 0:
                    draw.text((x + dx, y + dy), text, font=font, fill=stroke_color)
        
        draw.text((x, y), text, font=font, fill=config["font_color"])
        
        if not output_path:
            output_path = os.path.join(OUTPUT_DIR, f"subtitle_{int(time.time())}.png")
        
        img.save(output_path, 'PNG')
        return {
            "success": True,
            "path": output_path,
            "text": text,
            "style": style,
            "position": position
        }
        
    except Exception as e:
        logger.error(f"生成字幕图片失败: {e}")
        return {"success": False, "error": str(e)}


def overlay_subtitle_on_video(
    video_path: str,
    subtitle_image_path: str,
    output_path: str = ""
) -> Dict:
    """使用FFmpeg将字幕图片叠加到视频上"""
    if not os.path.exists(video_path):
        return {"success": False, "error": f"视频文件不存在: {video_path}"}
    
    if not os.path.exists(subtitle_image_path):
        return {"success": False, "error": f"字幕图片不存在: {subtitle_image_path}"}
    
    try:
        if not output_path:
            base_name = os.path.splitext(os.path.basename(video_path))[0]
            output_path = os.path.join(OUTPUT_DIR, f"{base_name}_subtitled.mp4")
        
        cmd = [
            "ffmpeg", "-y",
            "-i", video_path,
            "-i", subtitle_image_path,
            "-filter_complex", "[0:v][1:v]overlay=0:0:format=auto",
            "-c:v", "libx264",
            "-preset", "medium",
            "-crf", "23",
            "-c:a", "copy",
            output_path
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True)
        
        if result.returncode != 0:
            return {"success": False, "error": result.stderr}
        
        # 清理临时字幕图片
        try:
            os.remove(subtitle_image_path)
        except:
            pass
        
        return {"success": True, "local_path": output_path}
        
    except Exception as e:
        return {"success": False, "error": str(e)}


def create_srt_file(
    text: str,
    duration: float,
    output_path: str,
    chars_per_line: int = 15,
    chars_per_second: float = 4.0
) -> str:
    """将文本转换为SRT字幕文件"""
    import re
    text = text.strip()
    sentences = re.split(r'([。！？，；、\n])', text)
    segments = []
    current = ""
    for part in sentences:
        if part in '。！？，；、\n':
            current += part
            if current.strip():
                segments.append(current.strip())
            current = ""
        else:
            current += part
    if current.strip():
        segments.append(current.strip())
    
    if len(segments) < 2:
        segments = [text[i:i+chars_per_line] for i in range(0, len(text), chars_per_line)]
    
    total_chars = sum(len(s) for s in segments)
    srt_content = []
    current_time = 0.0
    
    for i, segment in enumerate(segments):
        segment_duration = max((len(segment) / total_chars) * duration, 1.0)
        if current_time + segment_duration > duration:
            segment_duration = duration - current_time
        if segment_duration <= 0:
            break
        
        start_time = current_time
        end_time = current_time + segment_duration
        
        def format_time(seconds):
            hours = int(seconds // 3600)
            minutes = int((seconds % 3600) // 60)
            secs = int(seconds % 60)
            millis = int((seconds % 1) * 1000)
            return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"
        
        srt_content.append(f"{i + 1}")
        srt_content.append(f"{format_time(start_time)} --> {format_time(end_time)}")
        srt_content.append(segment)
        srt_content.append("")
        current_time = end_time
    
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(srt_content))
    return output_path


def add_subtitles_to_video(
    video_path: str,
    subtitle_text: str,
    subtitle_style: str = "default",
    font_size: int = 0,
    font_color: str = "",
    position: str = "bottom",
    output_name: str = ""
) -> Dict:
    """为视频添加字幕 (优先使用subtitles滤镜，失败回退到drawtext)"""
    if not shutil.which("ffmpeg"):
        return {"success": False, "error": "系统未安装 FFmpeg"}
    
    if not os.path.exists(video_path):
        return {"success": False, "error": f"视频文件不存在: {video_path}"}
    
    try:
        duration = get_video_duration(video_path)
        srt_filename = f"subtitle_{uuid.uuid4()}.srt"
        srt_path = os.path.join(OUTPUT_DIR, srt_filename)
        create_srt_file(subtitle_text, duration, srt_path)
        
        style_config = next((s for s in SUBTITLE_STYLES if s["id"] == subtitle_style), SUBTITLE_STYLES[0])
        actual_fontsize = font_size if font_size > 0 else style_config.get("fontsize", 24)
        actual_fontcolor = font_color if font_color else style_config.get("fontcolor", "white")
        
        if not output_name:
            output_name = f"video_with_subtitles_{uuid.uuid4()}.mp4"
        output_path = os.path.join(OUTPUT_DIR, output_name)
        
        # 尝试subtitles滤镜
        escaped_srt_path = srt_path.replace("\\", "/").replace(":", "\\:").replace("'", "\\'")
        cmd = [
            "ffmpeg", "-y",
            "-i", video_path,
            "-vf", f"subtitles='{escaped_srt_path}'",
            "-c:a", "copy",
            output_path
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode == 0 and os.path.exists(output_path):
            return {"success": True, "local_path": output_path, "srt_path": srt_path}
        
        logger.warning(f"FFmpeg subtitles filter failed, falling back to drawtext: {result.stderr}")
        return add_subtitles_drawtext(video_path, subtitle_text, actual_fontsize, actual_fontcolor, output_name)
        
    except Exception as e:
        return {"success": False, "error": str(e)}


def add_subtitles_drawtext(
    video_path: str,
    subtitle_text: str,
    font_size: int = 24,
    font_color: str = "white",
    output_name: str = ""
) -> Dict:
    """使用drawtext滤镜添加简单字幕（备选方案）"""
    try:
        if not output_name:
            output_name = f"video_with_subtitles_{uuid.uuid4()}.mp4"
        output_path = os.path.join(OUTPUT_DIR, output_name)
        
        duration = get_video_duration(video_path)
        
        # 查找字体
        font_paths = [
            "/System/Library/Fonts/PingFang.ttc",
            "/System/Library/Fonts/STHeiti Light.ttc",
            "C:/Windows/Fonts/msyh.ttc",
        ]
        font_file = None
        for fp in font_paths:
            if os.path.exists(fp):
                font_file = fp
                break
        
        # 简单分割
        segments = [subtitle_text[i:i+18] for i in range(0, len(subtitle_text), 18)]
        if not segments: segments = [""]
        seg_duration = duration / len(segments)
        
        filters = []
        for i, seg in enumerate(segments):
            if not seg.strip(): continue
            start = i * seg_duration
            end = (i + 1) * seg_duration
            escaped_text = seg.replace("\\", "\\\\").replace("'", "'\\''").replace(":", "\\:")
            
            f_str = f"drawtext=text='{escaped_text}'"
            if font_file:
                font_file_escaped = font_file.replace(':', '\\:')
                f_str += f":fontfile='{font_file_escaped}'"
            f_str += f":fontsize={font_size}:fontcolor={font_color}:x=(w-text_w)/2:y=h-th-40:enable='between(t,{start:.2f},{end:.2f})'"
            filters.append(f_str)
        
        if not filters:
            return {"success": False, "error": "无效字幕"}
            
        cmd = [
            "ffmpeg", "-y",
            "-i", video_path,
            "-vf", ",".join(filters),
            "-c:a", "copy",
            output_path
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
             return {"success": False, "error": result.stderr}
             
        return {"success": True, "local_path": output_path, "method": "drawtext"}
        
    except Exception as e:
        return {"success": False, "error": str(e)}


def burn_subtitles_with_pillow(
    video_path: str,
    segments: List[Dict],
    style: str = "default",
    position: str = "bottom",
    output_path: str = ""
) -> Dict:
    """使用Pillow+FFmpeg烧录字幕 (ASR流程专用)"""
    if not PILLOW_AVAILABLE:
        return {"success": False, "error": "Pillow未安装"}
    
    try:
        # 获取视频尺寸
        probe_cmd = [
            "ffprobe", "-v", "quiet", "-select_streams", "v:0",
            "-show_entries", "stream=width,height", "-of", "json",
            video_path
        ]
        info = json.loads(subprocess.check_output(probe_cmd))
        stream = info.get("streams", [{}])[0]
        width = int(stream.get("width", 1280))
        height = int(stream.get("height", 720))
        
        # 生成图片
        images = []
        for i, seg in enumerate(segments):
            path = os.path.join(OUTPUT_DIR, f"sub_{i}_{uuid.uuid4()}.png")
            res = generate_subtitle_image(seg["text"], width, height, style, position, path)
            if res["success"]:
                images.append({"path": path, "start": seg["start"], "end": seg["end"]})
        
        if not images:
            return {"success": False, "error": "无法生成字幕图片"}
        
        if not output_path:
            output_path = os.path.join(OUTPUT_DIR, f"{os.path.basename(video_path)}_subtitled.mp4")
            
        # FFmpeg filter
        inputs = ["-i", video_path]
        for img in images: inputs.extend(["-i", img["path"]])
        
        filter_parts = []
        curr = "0:v"
        for i, img in enumerate(images):
            next_s = f"v{i}"
            filter_parts.append(f"[{curr}][{i+1}:v]overlay=0:0:enable='between(t,{img['start']},{img['end']})'[{next_s}]")
            curr = next_s
            
        cmd = [
            "ffmpeg", "-y", *inputs,
            "-filter_complex", ";".join(filter_parts),
            "-map", f"[{curr}]", "-map", "0:a?",
            "-c:v", "libx264", "-c:a", "copy",
            output_path
        ]
        
        subprocess.run(cmd, check=True)
        
        # 清理
        for img in images:
            try: os.remove(img["path"])
            except: pass
            
        return {"success": True, "local_path": output_path}
        
    except Exception as e:
        return {"success": False, "error": str(e)}


def add_subtitles_from_asr(
    video_path: str,
    asr_method: str = "whisper",
    language: str = "zh",
    style: str = "default",
    position: str = "bottom",
    output_path: str = ""
) -> Dict:
    """通过ASR识别视频语音并添加字幕"""
    # 1. 提取音频
    audio_res = extract_audio_from_video(video_path)
    if not audio_res["success"]: return audio_res
    audio_path = audio_res["audio_path"]
    
    # 2. 识别
    if asr_method == "whisper":
        asr_res = transcribe_audio_whisper(audio_path, language)
    else:
        asr_res = transcribe_audio_glm_asr(audio_path)
    
    try: os.remove(audio_path)
    except: pass
    
    if not asr_res["success"]: return asr_res
    segments = asr_res.get("segments", [])
    if not segments: return {"success": False, "error": "未识别到语音"}
    
    # 3. 烧录
    res = burn_subtitles_with_pillow(video_path, segments, style, position, output_path)
    if res["success"]:
        res["text"] = asr_res.get("text", "")
        res["segments"] = segments
    return res
