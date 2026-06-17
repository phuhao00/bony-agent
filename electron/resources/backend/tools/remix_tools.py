"""
视频混剪工具 — 独立模块
支持功能: 视频拼接 (FFmpeg), AI智能混剪 (分析素材-生成脚本-生成视频-合成)
"""
import os
import time
import uuid
import json
import shutil
import base64
import subprocess
from typing import Any, Dict, List, Optional
from utils.logger import setup_logger

from tools.media_common import (
    OUTPUT_DIR, TEMP_DIR, load_media_registry, save_media_registry,
    create_zhipu_client,
    get_video_duration
)
from tools.video_tools import generate_video_internal
from tools.audio_tools import (
    generate_narration_script, generate_speech, add_audio_to_video,
    PRESET_BGM, BGM_DIR
)
from tools.subtitle_tools import (
    generate_subtitle_for_video, generate_subtitle_image,
    overlay_subtitle_on_video, add_subtitles_from_asr
)

logger = setup_logger("remix_tools")


def remix_videos(
    file_paths: List[str],
    output_name: str = "",
    transition: str = "fade",
    duration_per_clip: float = 3.0,
    output_fps: int = 30,
    output_width: int = 1280,
    output_height: int = 720
) -> str:
    """混剪多个视频/图片素材"""
    if not shutil.which("ffmpeg"):
        return "❌ 混剪失败: 系统未安装 FFmpeg。请先安装 FFmpeg。"
    
    if len(file_paths) < 2:
        return "❌ 混剪失败: 至少需要2个素材文件"
    
    valid_files = [fp for fp in file_paths if os.path.exists(fp)]
    if len(valid_files) < 2:
        return "❌ 混剪失败: 有效素材文件少于2个"
    
    if not output_name:
        output_name = f"remix_{uuid.uuid4()}.mp4"
    output_path = os.path.join(OUTPUT_DIR, output_name)
    
    try:
        temp_dir = os.path.join(TEMP_DIR, f"remix_{uuid.uuid4()}")
        os.makedirs(temp_dir, exist_ok=True)
        
        processed_clips = []
        for i, filepath in enumerate(valid_files):
            ext = os.path.splitext(filepath)[1].lower()
            temp_output = os.path.join(temp_dir, f"clip_{i:03d}.mp4")
            
            if ext in ['.jpg', '.jpeg', '.png', '.gif', '.webp']:
                cmd = [
                    'ffmpeg', '-y', '-loop', '1', '-i', filepath,
                    '-c:v', 'libx264', '-t', str(duration_per_clip),
                    '-pix_fmt', 'yuv420p',
                    '-vf', f'scale={output_width}:{output_height}:force_original_aspect_ratio=decrease,pad={output_width}:{output_height}:(ow-iw)/2:(oh-ih)/2',
                    '-r', str(output_fps), temp_output
                ]
            else:
                cmd = [
                    'ffmpeg', '-y', '-i', filepath,
                    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
                    '-vf', f'scale={output_width}:{output_height}:force_original_aspect_ratio=decrease,pad={output_width}:{output_height}:(ow-iw)/2:(oh-ih)/2',
                    '-r', str(output_fps), '-an', temp_output
                ]
            
            subprocess.run(cmd, capture_output=True, check=True)
            if os.path.exists(temp_output):
                processed_clips.append(temp_output)
        
        if len(processed_clips) < 2:
            shutil.rmtree(temp_dir, ignore_errors=True)
            return "❌ 混剪失败: 处理后的有效片段少于2个"
        
        concat_file = os.path.join(temp_dir, "concat.txt")
        with open(concat_file, 'w') as f:
            for clip in processed_clips:
                f.write(f"file '{clip}'\n")
        
        subprocess.run([
            'ffmpeg', '-y', '-f', 'concat', '-safe', '0',
            '-i', concat_file, '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
            output_path
        ], capture_output=True, check=True)
        
        shutil.rmtree(temp_dir, ignore_errors=True)
        
        if os.path.exists(output_path):
            registry = load_media_registry()
            registry["videos"].append({
                "filename": os.path.basename(output_path),
                "type": "remix",
                "local_path": output_path,
                "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
                "source_files": [os.path.basename(f) for f in valid_files]
            })
            save_media_registry(registry)
            return f"✅ 混剪成功！\n\n**素材数量:** {len(valid_files)} 个\n\n**本地路径:** ./storage/outputs/{os.path.basename(output_path)}\n\n**直接显示:** {output_path}"
        return "❌ 混剪失败: 输出文件未生成"
            
    except Exception as e:
        logger.error(f"Remix error: {e}", exc_info=True)
        return f"❌ 混剪失败: {str(e)}"


def analyze_image_content(client: Any, image_path: str) -> str:
    """使用GLM-4V视觉模型分析图片内容"""
    try:
        with open(image_path, "rb") as f:
            image_data = base64.b64encode(f.read()).decode('utf-8')
        
        ext = os.path.splitext(image_path)[1].lower()
        mime_type = {
            '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', 
            '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp'
        }.get(ext, 'image/jpeg')
        
        response = client.chat.completions.create(
            model="glm-4v-plus",
            messages=[{
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{image_data}"}},
                    {"type": "text", "text": "请详细描述这张图片的内容...（略）"}
                ]
            }],
            max_tokens=500
        )
        return response.choices[0].message.content
    except Exception as e:
        logger.error(f"Image analysis failed: {e}")
        return f"图片 {os.path.basename(image_path)}"


def generate_fusion_prompt(client: Any, material_analyses: List[Dict], user_prompt: str = "") -> Dict:
    """使用LLM生成融合所有素材的统一视频提示词"""
    materials_desc = "\n".join([f"素材{i+1}: {m['description']}" for i, m in enumerate(material_analyses)])
    prompt = f"""你是一位专业的AI视频创意导演。请根据以下素材分析，创作一个融合所有素材元素的视频描述。

## 素材内容分析：
{materials_desc}

## 用户创作需求：
{user_prompt if user_prompt else "创建一个有创意的融合视频"}

请生成JSON格式，包含 title, style, fusion_prompt, narrative。不要markdown标记。"""

    try:
        response = client.chat.completions.create(
            model="glm-4-plus",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=1500
        )
        content = response.choices[0].message.content.strip().replace("```json", "").replace("```", "")
        return json.loads(content)
    except Exception as e:
        logger.error(f"Fusion prompt generation failed: {e}")
        return {
            "title": "AI融合创意视频",
            "style": "创意融合",
            "fusion_prompt": f"一个融合了{materials_desc[:50]}...等元素的创意视频",
            "narrative": "将所有素材元素融合成一个统一的视觉体验"
        }


def generate_remix_script(client: Any, material_analyses: List[Dict], user_prompt: str = "") -> Dict:
    """使用LLM生成智能混剪脚本"""
    materials_desc = "\n".join([f"素材{i+1}: {m['description']}" for i, m in enumerate(material_analyses)])
    prompt = f"""请生成JSON格式的剪辑脚本，包含 title, style, segments, overall_narrative。不要markdown标记。"""
    try:
        response = client.chat.completions.create(
            model="glm-4-plus",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=2000
        )
        content = response.choices[0].message.content.strip().replace("```json", "").replace("```", "")
        return json.loads(content)
    except Exception:
        return {"title": "AI混剪视频", "segments": []}


def ai_remix_videos(
    file_paths: List[str],
    user_prompt: str = "",
    output_name: str = "",
    fusion_mode: bool = True,
    generate_ai_segments: bool = True,
    segment_duration: int = 4,
    add_narration: bool = False,
    narration_text: str = "",
    narration_style: str = "informative",
    narration_voice: str = "zh-CN-XiaoxiaoNeural",
    add_bgm: bool = False,
    bgm_id: str = "",
    bgm_path: str = "",
    bgm_volume: float = 0.3,
    add_subtitles: bool = False,
    subtitle_text: str = "",
    subtitle_style: str = "default",
    subtitle_position: str = "bottom",
    use_asr_subtitles: bool = False,
    asr_method: str = "whisper",
    asr_language: str = "zh"
) -> Dict:
    """AI智能混剪"""
    api_key = os.getenv("ZHIPUAI_API_KEY")
    if not api_key: return {"success": False, "error": "未设置 ZHIPUAI_API_KEY"}
    
    client = create_zhipu_client(api_key)
    valid_files = [{"path": fp, "type": "image" if os.path.splitext(fp)[1] in ['.jpg','.png'] else "video"} 
                   for fp in file_paths if os.path.exists(fp)]
    
    if not valid_files: return {"success": False, "error": "没有有效的素材文件"}
    
    result = {"success": True, "stages": [], "generated_segments": [], "final_video": None, "message": ""}
    
    # 1. 分析
    material_analyses = []
    for m in valid_files:
        desc = analyze_image_content(client, m["path"]) if m["type"] == "image" else f"视频: {os.path.basename(m['path'])}"
        material_analyses.append({**m, "description": desc})
    
    video_path = None
    
    # 2. 生成视频
    if fusion_mode:
        fusion = generate_fusion_prompt(client, material_analyses, user_prompt)
        res = generate_video_internal(prompt=fusion.get("fusion_prompt", ""))
        if res["success"]:
            video_path = res["local_path"]
            result["final_video"] = video_path
            result["message"] = f"🎬 AI融合视频生成完成！\nTitle: {fusion.get('title')}"
            
            # 准备字幕文本
            if add_subtitles and not subtitle_text:
                result["subtitle_text"] = generate_subtitle_for_video(client, fusion.get("fusion_prompt"), fusion.get("title"))
        else:
            return {"success": False, "error": res.get("error")}
    else:
        # 分段模式 (Simplified for brevity)
        pass

    if not video_path:
        return {"success": False, "error": "视频生成失败"}

    # 3. 音频
    if add_narration or add_bgm:
        audio_path = None
        if add_narration:
            if not narration_text:
                narration_text = generate_narration_script(client, "视频内容描述")
            s_res = generate_speech(narration_text, narration_voice)
            if s_res["success"]: audio_path = s_res["local_path"]
            
        real_bgm = bgm_path
        if not real_bgm and bgm_id and bgm_id in PRESET_BGM:
            real_bgm = os.path.join(BGM_DIR, PRESET_BGM[bgm_id]["file"])
            
        a_res = add_audio_to_video(video_path, audio_path, real_bgm, bgm_volume)
        if a_res["success"]:
            video_path = a_res["local_path"]
            result["final_video"] = video_path

    # 4. 字幕
    if add_subtitles and (subtitle_text or result.get("subtitle_text")):
        text = subtitle_text or result.get("subtitle_text")
        img_res = generate_subtitle_image(text, style=subtitle_style, position=subtitle_position)
        if img_res["success"]:
            ov_res = overlay_subtitle_on_video(video_path, img_res["path"])
            if ov_res["success"]:
                video_path = ov_res["local_path"]
                result["final_video"] = video_path

    # 5. ASR字幕
    if use_asr_subtitles:
        asr_res = add_subtitles_from_asr(video_path, asr_method, asr_language, subtitle_style, subtitle_position)
        if asr_res["success"]:
            video_path = asr_res["local_path"]
            result["final_video"] = video_path

    return result
