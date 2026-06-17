import os
import time
import requests
import uuid
import json
import base64
import subprocess
import shutil
from typing import Optional, Dict, List, Tuple
from zhipuai import ZhipuAI
from langchain.tools import tool
from utils.logger import setup_logger
from tools.memory_tools import save_generation_to_memory

# 尝试导入Pillow用于生成字幕图片
try:
    from PIL import Image, ImageDraw, ImageFont
    PILLOW_AVAILABLE = True
except ImportError:
    PILLOW_AVAILABLE = False

# 尝试导入Whisper用于本地语音识别
try:
    import whisper
    WHISPER_AVAILABLE = True
except ImportError:
    WHISPER_AVAILABLE = False

# 初始化日志记录器
logger = setup_logger("media_tools")

# 全局客户端实例，由外部配置或环境变量初始化
_client: Optional[ZhipuAI] = None

# 项目根目录获取
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 本地保存目录 - 使用绝对路径确保在 tmp 目录运行时也能正确找回
OUTPUT_DIR = os.path.join(PROJECT_ROOT, "generated_outputs")
os.makedirs(OUTPUT_DIR, exist_ok=True)

# 媒体记录文件
MEDIA_REGISTRY = os.path.join(OUTPUT_DIR, "media_registry.json")

def load_media_registry() -> Dict:
    """加载媒体注册表"""
    if os.path.exists(MEDIA_REGISTRY):
        try:
            with open(MEDIA_REGISTRY, 'r', encoding='utf-8') as f:
                return json.load(f)
        except:
            return {"images": [], "videos": []}
    return {"images": [], "videos": []}

def save_media_registry(registry: Dict):
    """保存媒体注册表"""
    try:
        with open(MEDIA_REGISTRY, 'w', encoding='utf-8') as f:
            json.dump(registry, f, ensure_ascii=False, indent=2)
    except Exception as e:
        logger.warning(f"Failed to save media registry: {e}")

def download_file(url: str, suffix: str, media_type: str = "file") -> str:
    """下载文件并保存到本地，同时记录到注册表"""
    try:
        response = requests.get(url, stream=True, timeout=60)
        response.raise_for_status()
        
        # 生成唯一文件名
        filename = f"{uuid.uuid4()}{suffix}"
        filepath = os.path.join(OUTPUT_DIR, filename)
        
        with open(filepath, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)
                
        logger.info(f"File downloaded successfully to: {filepath}")
        
        # 记录到媒体注册表
        registry = load_media_registry()
        media_info = {
            "filename": filename,
            "type": media_type,
            "url": url,
            "local_path": filepath,
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S")
        }
        
        if media_type == "video":
            registry["videos"].append(media_info)
        else:
            registry["images"].append(media_info)
            
        save_media_registry(registry)
        
        return filepath
    except Exception as e:
        logger.error(f"Failed to download file from {url}: {e}")
        return ""

def init_client(api_key: str):
    global _client
    _client = ZhipuAI(api_key=api_key)
    logger.info("ZhipuAI client initialized manually.")

def get_client() -> Optional[ZhipuAI]:
    global _client
    if _client is None:
        api_key = os.getenv("ZHIPUAI_API_KEY")
        if api_key:
            _client = ZhipuAI(api_key=api_key)
            logger.info("ZhipuAI client initialized from environment variable.")
    return _client

@tool
def generate_image(prompt: str) -> str:
    """
    根据文本描述生成图片。
    输入应该是一段描述性的文本，例如 '一只在太空弹吉他的猫'。
    返回生成的图片 URL 和本地保存路径。
    """
    logger.info(f"Generating image with prompt: {prompt}")
    client = get_client()
    if not client:
        logger.error("API Key not set when attempting to generate image.")
        return "Error: ZhipuAI API Key is not set. Please configure it in the sidebar."

    try:
        # 使用 CogView-3 模型
        response = client.images.generations(
            model="cogview-3-plus", 
            prompt=prompt
        )
        url = response.data[0].url
        logger.info(f"Image generated successfully: {url}")
        
        # 自动保存到记忆（失败不影响主流程）
        try:
            save_generation_to_memory(prompt, url, "image")
        except Exception as mem_err:
            logger.warning(f"Failed to save to memory (non-critical): {mem_err}")
        
        # 自动下载到本地
        local_path = download_file(url, ".jpg", "image")
        if local_path:
            display_path = f"./generated_outputs/{os.path.basename(local_path)}"
            return f"✅ 图片生成成功！\n\n**URL:** {url}\n\n**本地路径:** {display_path}\n\n**直接显示:** {local_path}"
        
        return f"✅ 图片生成成功！\n\n**URL:** {url}"
    except Exception as e:
        error_msg = f"Failed to generate image: {str(e)}"
        logger.error(error_msg, exc_info=True)
        return f"❌ 图片生成失败: {str(e)}"

def _wait_for_video_task(client: ZhipuAI, task_id: str, prompt: str) -> str:
    """等待视频任务完成的通用函数"""
    max_retries = 120  # 10分钟超时
    for i in range(max_retries):
        time.sleep(5)
        result = client.videos.retrieve_videos_result(id=task_id)
        
        if result.task_status == "SUCCESS":
            url = result.video_result[0].url
            logger.info(f"Video generated successfully: {url}")
            
            # 自动保存到记忆（失败不影响主流程）
            try:
                save_generation_to_memory(prompt, url, "video")
            except Exception as mem_err:
                logger.warning(f"Failed to save to memory (non-critical): {mem_err}")
            
            # 自动下载到本地
            local_path = download_file(url, ".mp4", "video")
            if local_path:
                display_path = f"./generated_outputs/{os.path.basename(local_path)}"
                return f"✅ 视频生成成功！\n\n**URL:** {url}\n\n**本地路径:** {display_path}\n\n**直接显示:** {local_path}"
            
            return f"✅ 视频生成成功！\n\n**URL:** {url}"
            
        elif result.task_status == "FAIL":
            error_msg = f"Video task failed. Task ID: {task_id}"
            logger.error(error_msg)
            return f"❌ 视频生成失败: {str(result)}"
        
        # 每 30s 记录一次心跳日志
        if i % 6 == 0: 
            logger.info(f"⏳ 等待视频任务 {task_id}... 状态: {result.task_status}")
        
    logger.error(f"Video task timed out. Task ID: {task_id}")
    return "❌ 视频生成超时，请重试或稍后尝试。"


@tool
def generate_video(prompt: str) -> str:
    """
    根据文本描述生成视频。
    输入应该是一段描述性的文本，例如 '海浪拍打沙滩，夕阳西下'。
    视频生成需要较长时间，请耐心等待。
    返回生成的视频 URL 和本地保存路径。
    """
    logger.info(f"Generating video with prompt: {prompt}")
    client = get_client()
    if not client:
        logger.error("API Key not set when attempting to generate video.")
        return "Error: ZhipuAI API Key is not set. Please configure it in the sidebar."

    try:
        # 使用 CogVideoX 模型
        response = client.videos.generations(
            model="cogvideox",
            prompt=prompt
        )
        task_id = response.id
        logger.info(f"Video task submitted. Task ID: {task_id}")
        
        return _wait_for_video_task(client, task_id, prompt)
    except Exception as e:
        error_msg = f"Failed to generate video: {str(e)}"
        logger.error(error_msg, exc_info=True)
        return f"❌ 视频生成失败: {str(e)}"


def generate_video_from_image_internal(image_url: str, prompt: str = "") -> str:
    """
    图生视频内部函数（非Tool，供API直接调用）
    
    Args:
        image_url: 图片URL（需要是公网可访问的URL）
        prompt: 可选的文本提示，描述视频动作
    
    Returns:
        生成结果字符串
    """
    logger.info(f"Generating video from image: {image_url}, prompt: {prompt}")
    client = get_client()
    if not client:
        logger.error("API Key not set when attempting to generate video from image.")
        return "Error: ZhipuAI API Key is not set."

    try:
        # 使用 CogVideoX 图生视频
        params = {
            "model": "cogvideox",
            "image_url": image_url
        }
        if prompt:
            params["prompt"] = prompt
            
        response = client.videos.generations(**params)
        task_id = response.id
        logger.info(f"Image-to-video task submitted. Task ID: {task_id}")
        
        return _wait_for_video_task(client, task_id, prompt or f"从图片生成: {image_url}")
    except Exception as e:
        error_msg = f"Failed to generate video from image: {str(e)}"
        logger.error(error_msg, exc_info=True)
        return f"❌ 图生视频失败: {str(e)}"


@tool
def generate_video_from_image(image_url: str, prompt: str = "") -> str:
    """
    从图片生成视频（图生视频）。
    
    Args:
        image_url: 图片的URL地址（必须是公网可访问的URL）
        prompt: 可选的文本描述，描述期望的视频动作，如"镜头缓慢推进，云朵流动"
    
    Returns:
        生成的视频URL和本地保存路径
    """
    return generate_video_from_image_internal(image_url, prompt)


# 上传目录 - 使用绝对路径
UPLOAD_DIR = os.path.join(PROJECT_ROOT, "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)


def save_upload_file(file_content: bytes, filename: str) -> str:
    """保存上传的文件到本地"""
    # 生成唯一文件名
    ext = os.path.splitext(filename)[1] or ".bin"
    unique_filename = f"{uuid.uuid4()}{ext}"
    filepath = os.path.join(UPLOAD_DIR, unique_filename)
    
    with open(filepath, 'wb') as f:
        f.write(file_content)
    
    logger.info(f"File uploaded successfully: {filepath}")
    return filepath


def get_file_public_url(filepath: str) -> str:
    """
    获取文件的公网URL（用于API调用）
    在本地开发环境，需要使用ngrok或其他隧道服务
    生产环境应该返回实际的公网URL
    """
    # 这里返回相对路径，实际使用时需要配置公网访问
    filename = os.path.basename(filepath)
    return f"/uploads/{filename}"


def remix_videos(
    file_paths: List[str],
    output_name: str = "",
    transition: str = "fade",
    duration_per_clip: float = 3.0,
    output_fps: int = 30,
    output_width: int = 1280,
    output_height: int = 720
) -> str:
    """
    混剪多个视频/图片素材
    
    Args:
        file_paths: 素材文件路径列表（支持图片和视频）
        output_name: 输出文件名（可选）
        transition: 转场效果 (fade, none)
        duration_per_clip: 每个片段的持续时间（秒），仅对图片有效
        output_fps: 输出帧率
        output_width: 输出宽度
        output_height: 输出高度
    
    Returns:
        混剪后的视频路径
    """
    import subprocess
    import shutil
    
    logger.info(f"Starting video remix with {len(file_paths)} files")
    
    # 检查ffmpeg是否可用
    if not shutil.which("ffmpeg"):
        return "❌ 混剪失败: 系统未安装 FFmpeg。请先安装 FFmpeg。"
    
    if len(file_paths) < 2:
        return "❌ 混剪失败: 至少需要2个素材文件"
    
    # 验证文件存在
    valid_files = []
    for fp in file_paths:
        if os.path.exists(fp):
            valid_files.append(fp)
        else:
            logger.warning(f"File not found: {fp}")
    
    if len(valid_files) < 2:
        return "❌ 混剪失败: 有效素材文件少于2个"
    
    # 生成输出文件名
    if not output_name:
        output_name = f"remix_{uuid.uuid4()}.mp4"
    output_path = os.path.join(OUTPUT_DIR, output_name)
    
    try:
        # 创建临时目录存放处理后的片段
        temp_dir = os.path.join(OUTPUT_DIR, f"temp_{uuid.uuid4()}")
        os.makedirs(temp_dir, exist_ok=True)
        
        processed_clips = []
        
        for i, filepath in enumerate(valid_files):
            ext = os.path.splitext(filepath)[1].lower()
            temp_output = os.path.join(temp_dir, f"clip_{i:03d}.mp4")
            
            if ext in ['.jpg', '.jpeg', '.png', '.gif', '.webp']:
                # 图片转视频
                cmd = [
                    'ffmpeg', '-y',
                    '-loop', '1',
                    '-i', filepath,
                    '-c:v', 'libx264',
                    '-t', str(duration_per_clip),
                    '-pix_fmt', 'yuv420p',
                    '-vf', f'scale={output_width}:{output_height}:force_original_aspect_ratio=decrease,pad={output_width}:{output_height}:(ow-iw)/2:(oh-ih)/2',
                    '-r', str(output_fps),
                    temp_output
                ]
            else:
                # 视频标准化
                cmd = [
                    'ffmpeg', '-y',
                    '-i', filepath,
                    '-c:v', 'libx264',
                    '-pix_fmt', 'yuv420p',
                    '-vf', f'scale={output_width}:{output_height}:force_original_aspect_ratio=decrease,pad={output_width}:{output_height}:(ow-iw)/2:(oh-ih)/2',
                    '-r', str(output_fps),
                    '-an',  # 去除音频简化处理
                    temp_output
                ]
            
            logger.info(f"Processing clip {i+1}/{len(valid_files)}: {filepath}")
            result = subprocess.run(cmd, capture_output=True, text=True)
            
            if result.returncode != 0:
                logger.error(f"FFmpeg error for {filepath}: {result.stderr}")
                continue
            
            if os.path.exists(temp_output):
                processed_clips.append(temp_output)
        
        if len(processed_clips) < 2:
            # 清理临时目录
            shutil.rmtree(temp_dir, ignore_errors=True)
            return "❌ 混剪失败: 处理后的有效片段少于2个"
        
        # 创建合并列表文件
        concat_file = os.path.join(temp_dir, "concat.txt")
        with open(concat_file, 'w') as f:
            for clip in processed_clips:
                f.write(f"file '{clip}'\n")
        
        # 合并视频
        concat_cmd = [
            'ffmpeg', '-y',
            '-f', 'concat',
            '-safe', '0',
            '-i', concat_file,
            '-c:v', 'libx264',
            '-pix_fmt', 'yuv420p',
            output_path
        ]
        
        logger.info(f"Merging {len(processed_clips)} clips...")
        result = subprocess.run(concat_cmd, capture_output=True, text=True)
        
        # 清理临时目录
        shutil.rmtree(temp_dir, ignore_errors=True)
        
        if result.returncode != 0:
            logger.error(f"FFmpeg concat error: {result.stderr}")
            return f"❌ 混剪失败: {result.stderr[:200]}"
        
        if os.path.exists(output_path):
            display_path = f"./generated_outputs/{os.path.basename(output_path)}"
            logger.info(f"Video remix completed: {output_path}")
            
            # 记录到媒体注册表
            registry = load_media_registry()
            registry["videos"].append({
                "filename": os.path.basename(output_path),
                "type": "remix",
                "local_path": output_path,
                "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
                "source_files": [os.path.basename(f) for f in valid_files]
            })
            save_media_registry(registry)
            
            return f"✅ 混剪成功！\n\n**素材数量:** {len(valid_files)} 个\n\n**本地路径:** {display_path}\n\n**直接显示:** {output_path}"
        else:
            return "❌ 混剪失败: 输出文件未生成"
            
    except Exception as e:
        logger.error(f"Remix error: {e}", exc_info=True)
        return f"❌ 混剪失败: {str(e)}"


# ===================== AI智能混剪功能 =====================

def analyze_image_content(client: ZhipuAI, image_path: str) -> str:
    """
    使用GLM-4V视觉模型分析图片内容
    
    Args:
        client: ZhipuAI客户端
        image_path: 图片文件路径
    
    Returns:
        图片内容描述
    """
    try:
        # 读取图片并转为base64
        with open(image_path, "rb") as f:
            image_data = base64.b64encode(f.read()).decode('utf-8')
        
        ext = os.path.splitext(image_path)[1].lower()
        mime_type = {
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg', 
            '.png': 'image/png',
            '.gif': 'image/gif',
            '.webp': 'image/webp'
        }.get(ext, 'image/jpeg')
        
        response = client.chat.completions.create(
            model="glm-4v-plus",
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:{mime_type};base64,{image_data}"
                            }
                        },
                        {
                            "type": "text",
                            "text": """请详细描述这张图片的内容，包括：
1. 主体内容（人物、物体、场景）
2. 画面氛围和情绪
3. 色调和风格
4. 适合的视频运动效果（如：缓慢推进、左右平移、缩放等）

请用简洁的一段话描述，用于后续AI视频生成。"""
                        }
                    ]
                }
            ],
            max_tokens=500
        )
        
        return response.choices[0].message.content
    except Exception as e:
        logger.error(f"Image analysis failed: {e}")
        return f"图片 {os.path.basename(image_path)}"


def generate_fusion_prompt(client: ZhipuAI, material_analyses: List[Dict], user_prompt: str = "") -> Dict:
    """
    使用LLM生成融合所有素材的统一视频提示词
    
    Args:
        client: ZhipuAI客户端
        material_analyses: 素材分析结果列表 [{"path": str, "description": str, "type": str}]
        user_prompt: 用户的创作需求/主题
    
    Returns:
        融合提示词 {"title": str, "style": str, "fusion_prompt": str, "narrative": str}
    """
    materials_desc = "\n".join([
        f"素材{i+1}: {m['description']}" 
        for i, m in enumerate(material_analyses)
    ])
    
    prompt = f"""你是一位专业的AI视频创意导演。请根据以下素材分析，创作一个融合所有素材元素的视频描述。

## 素材内容分析：
{materials_desc}

## 用户创作需求：
{user_prompt if user_prompt else "创建一个有创意的融合视频"}

## 任务要求：
请将所有素材的核心元素、氛围、色调融合在一起，创作一个**统一连贯的视频描述**。
不是简单的拼接，而是要把素材中的视觉元素、情感、主题巧妙地融合成一个完整的画面。

请生成JSON格式，包含：
1. title: 视频标题
2. style: 整体视觉风格
3. fusion_prompt: 融合后的视频生成提示词（100-200字，描述一个完整连贯的视频场景，包含动态效果、镜头运动、氛围渲染等，适合AI视频生成模型）
4. narrative: 创意说明（解释如何融合各素材元素）

请直接返回JSON，不要包含```json标记。"""

    try:
        response = client.chat.completions.create(
            model="glm-4-plus",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=1500
        )
        
        content = response.choices[0].message.content
        # 尝试清理可能的markdown标记
        content = content.strip()
        if content.startswith("```"):
            content = content.split("\n", 1)[1]
        if content.endswith("```"):
            content = content.rsplit("```", 1)[0]
        content = content.strip()
        
        return json.loads(content)
    except Exception as e:
        logger.error(f"Fusion prompt generation failed: {e}")
        # 返回默认融合提示词
        all_descriptions = "、".join([m['description'][:30] for m in material_analyses])
        return {
            "title": "AI融合创意视频",
            "style": "创意融合",
            "fusion_prompt": f"一个融合了{all_descriptions}等元素的创意视频，画面流畅自然，镜头缓慢推进，光影变化丰富，整体氛围和谐统一",
            "narrative": "将所有素材元素融合成一个统一的视觉体验"
        }


def generate_remix_script(client: ZhipuAI, material_analyses: List[Dict], user_prompt: str = "") -> Dict:
    """
    使用LLM生成智能混剪脚本
    
    Args:
        client: ZhipuAI客户端
        material_analyses: 素材分析结果列表 [{"path": str, "description": str, "type": str}]
        user_prompt: 用户的创作需求/主题
    
    Returns:
        剪辑脚本 {"title": str, "style": str, "segments": [...], "transitions": [...]}
    """
    materials_desc = "\n".join([
        f"素材{i+1} ({m['type']}): {m['description']}" 
        for i, m in enumerate(material_analyses)
    ])
    
    prompt = f"""你是一位专业的AI视频混剪导演。请根据以下素材分析，生成一个创意混剪脚本。

## 素材列表：
{materials_desc}

## 用户创作需求：
{user_prompt if user_prompt else "创建一个有创意的混剪视频"}

请生成JSON格式的剪辑脚本，包含：
1. title: 视频标题
2. style: 整体风格描述
3. segments: 每个片段的详细信息，包括：
   - material_index: 对应素材序号（从0开始）
   - duration: 建议时长（秒）
   - motion_prompt: 为该素材生成视频的动态提示词（描述运动效果）
   - transition_to_next: 到下一个片段的转场描述
4. overall_narrative: 整体叙事逻辑

请直接返回JSON，不要包含```json标记。"""

    try:
        response = client.chat.completions.create(
            model="glm-4-plus",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=2000
        )
        
        content = response.choices[0].message.content
        # 尝试清理可能的markdown标记
        content = content.strip()
        if content.startswith("```"):
            content = content.split("\n", 1)[1]
        if content.endswith("```"):
            content = content.rsplit("```", 1)[0]
        content = content.strip()
        
        return json.loads(content)
    except Exception as e:
        logger.error(f"Script generation failed: {e}")
        # 返回默认脚本
        return {
            "title": "AI混剪视频",
            "style": "创意混剪",
            "segments": [
                {
                    "material_index": i,
                    "duration": 4,
                    "motion_prompt": m['description'][:100] + "，镜头缓慢推进",
                    "transition_to_next": "淡入淡出"
                }
                for i, m in enumerate(material_analyses)
            ],
            "overall_narrative": "素材顺序展示"
        }


def ai_remix_videos(
    file_paths: List[str],
    user_prompt: str = "",
    output_name: str = "",
    fusion_mode: bool = True,
    generate_ai_segments: bool = True,
    segment_duration: int = 4,
    # 音频选项
    add_narration: bool = False,
    narration_text: str = "",
    narration_style: str = "informative",
    narration_voice: str = "zh-CN-XiaoxiaoNeural",
    add_bgm: bool = False,
    bgm_id: str = "",
    bgm_path: str = "",
    bgm_volume: float = 0.3,
    # 字幕选项
    add_subtitles: bool = False,
    subtitle_text: str = "",
    subtitle_style: str = "default",
    subtitle_position: str = "bottom",
    # ASR字幕选项
    use_asr_subtitles: bool = False,
    asr_method: str = "whisper",  # "whisper" 或 "glm-asr"
    asr_language: str = "zh"
) -> Dict:
    """
    AI智能混剪 - 使用大模型分析素材并生成创意视频
    
    Args:
        file_paths: 素材文件路径列表
        user_prompt: 用户的创作需求/主题描述
        output_name: 输出文件名（可选）
        fusion_mode: 融合模式（True=将所有素材融合成一个视频，False=分段生成再拼接）
        generate_ai_segments: 是否为每个素材生成AI视频片段
        segment_duration: 每个AI生成片段的时长（秒）
        add_narration: 是否添加AI配音
        narration_text: 配音文本（为空则自动生成）
        narration_style: 旁白风格
        narration_voice: 配音声音
        add_bgm: 是否添加背景音乐
        bgm_id: 预设背景音乐ID
        bgm_path: 自定义背景音乐路径
        bgm_volume: 背景音乐音量（0-1）
    
    Returns:
        包含处理状态和结果的字典
    """
    api_key = os.getenv("ZHIPUAI_API_KEY")
    if not api_key:
        return {
            "success": False,
            "error": "未设置 ZHIPUAI_API_KEY 环境变量"
        }
    
    client = ZhipuAI(api_key=api_key)
    
    # 验证素材
    valid_files = []
    for fp in file_paths:
        if os.path.exists(fp):
            ext = os.path.splitext(fp)[1].lower()
            file_type = "image" if ext in ['.jpg', '.jpeg', '.png', '.gif', '.webp'] else "video"
            valid_files.append({"path": fp, "type": file_type})
        else:
            logger.warning(f"File not found: {fp}")
    
    if len(valid_files) < 1:
        return {
            "success": False,
            "error": "没有有效的素材文件"
        }
    
    result = {
        "success": True,
        "stages": [],
        "script": None,
        "generated_segments": [],
        "final_video": None
    }
    
    # Stage 1: 分析素材
    logger.info(f"[AI混剪] Stage 1: 分析 {len(valid_files)} 个素材...")
    result["stages"].append({"stage": "分析素材", "status": "进行中"})
    
    material_analyses = []
    for i, file_info in enumerate(valid_files):
        if file_info["type"] == "image":
            desc = analyze_image_content(client, file_info["path"])
        else:
            desc = f"视频素材: {os.path.basename(file_info['path'])}"
        
        material_analyses.append({
            "path": file_info["path"],
            "type": file_info["type"],
            "description": desc
        })
        logger.info(f"  素材{i+1}分析完成: {desc[:50]}...")
    
    result["stages"][-1]["status"] = "完成"
    result["stages"][-1]["analyses"] = [
        {"file": os.path.basename(m["path"]), "description": m["description"][:100]}
        for m in material_analyses
    ]
    
    # 根据模式选择不同的处理流程
    if fusion_mode:
        # ===== 融合模式：将所有素材融合成一个视频 =====
        
        # Stage 2: 生成融合提示词
        logger.info("[AI混剪-融合模式] Stage 2: AI生成融合创意...")
        result["stages"].append({"stage": "生成融合创意", "status": "进行中"})
        
        fusion_result = generate_fusion_prompt(client, material_analyses, user_prompt)
        result["script"] = fusion_result
        result["stages"][-1]["status"] = "完成"
        logger.info(f"  融合创意完成: {fusion_result.get('title', 'AI融合视频')}")
        
        # Stage 3: 生成融合视频
        logger.info("[AI混剪-融合模式] Stage 3: AI生成融合视频...")
        result["stages"].append({"stage": "生成融合视频", "status": "进行中"})
        
        fusion_prompt = fusion_result.get("fusion_prompt", "")
        if not fusion_prompt:
            result["stages"][-1]["status"] = "失败"
            result["success"] = False
            result["error"] = "融合提示词生成失败"
            return result
        
        # 准备字幕文本（后期叠加，不嵌入AI prompt，因为AI生成中文字会乱）
        actual_subtitle_text = ""
        subtitle_info = ""  # 初始化字幕信息
        if add_subtitles:
            if subtitle_text:
                actual_subtitle_text = subtitle_text
            else:
                # 生成简短的字幕文案
                actual_subtitle_text = generate_subtitle_for_video(client, fusion_prompt, fusion_result.get('title', ''))
            
            if actual_subtitle_text:
                result["subtitle_text"] = actual_subtitle_text
                logger.info(f"  字幕已准备（后期叠加）: {actual_subtitle_text[:50]}...")
        
        logger.info(f"  融合提示词: {fusion_prompt[:100]}...")
        
        video_result = generate_video_internal(prompt=fusion_prompt)
        
        if video_result.get("success") and video_result.get("local_path"):
            result["stages"][-1]["status"] = "完成"
            result["final_video"] = video_result["local_path"]
            result["generated_segments"].append(video_result)
            
            result["message"] = f"""🎬 AI融合视频生成完成！

**视频标题:** {fusion_result.get('title', 'AI融合视频')}
**视觉风格:** {fusion_result.get('style', '创意融合')}
**创意说明:** {fusion_result.get('narrative', '')}

✨ 已将 {len(material_analyses)} 个素材的元素融合成一个完整的AI视频"""
        else:
            result["stages"][-1]["status"] = "失败"
            result["success"] = False
            result["error"] = f"视频生成失败: {video_result.get('error', 'Unknown')}"
    
    else:
        # ===== 分段模式：为每个素材生成视频再拼接 =====
        
        # Stage 2: 生成剪辑脚本
        logger.info("[AI混剪-分段模式] Stage 2: AI生成剪辑脚本...")
        result["stages"].append({"stage": "生成脚本", "status": "进行中"})
        
        script = generate_remix_script(client, material_analyses, user_prompt)
        result["script"] = script
        result["stages"][-1]["status"] = "完成"
        logger.info(f"  脚本生成完成: {script.get('title', 'AI混剪')}")
        
        # Stage 3: 为每个素材生成AI视频片段
        if generate_ai_segments:
            logger.info("[AI混剪-分段模式] Stage 3: AI生成视频片段...")
            result["stages"].append({"stage": "生成视频片段", "status": "进行中", "progress": []})
            
            generated_videos = []
            segments = script.get("segments", [])
            
            for i, segment in enumerate(segments):
                mat_idx = segment.get("material_index", i)
                if mat_idx >= len(material_analyses):
                    mat_idx = i % len(material_analyses)
                
                material = material_analyses[mat_idx]
                motion_prompt = segment.get("motion_prompt", material["description"][:100])
                
                logger.info(f"  生成片段 {i+1}/{len(segments)}: {motion_prompt[:30]}...")
                result["stages"][-1]["progress"].append({
                    "segment": i+1, 
                    "status": "生成中",
                    "prompt": motion_prompt[:50]
                })
                
                video_result = generate_video_internal(prompt=motion_prompt)
                
                if video_result.get("success") and video_result.get("local_path"):
                    generated_videos.append({
                        "path": video_result["local_path"],
                        "segment_index": i,
                        "prompt": motion_prompt
                    })
                    result["stages"][-1]["progress"][-1]["status"] = "完成"
                    result["generated_segments"].append(video_result)
                else:
                    result["stages"][-1]["progress"][-1]["status"] = "失败"
                    logger.warning(f"  片段{i+1}生成失败: {video_result.get('error', 'Unknown')}")
            
            result["stages"][-1]["status"] = "完成"
            
            # Stage 4: 合成最终视频
            if len(generated_videos) >= 1:
                logger.info("[AI混剪-分段模式] Stage 4: 合成最终视频...")
                result["stages"].append({"stage": "合成视频", "status": "进行中"})
                
                video_paths = [v["path"] for v in generated_videos]
                
                if not output_name:
                    output_name = f"ai_remix_{uuid.uuid4()}.mp4"
                
                final_result = remix_videos(
                    file_paths=video_paths,
                    output_name=output_name,
                    duration_per_clip=segment_duration
                )
                
                if "✅" in final_result:
                    result["stages"][-1]["status"] = "完成"
                    result["final_video"] = os.path.join(OUTPUT_DIR, output_name)
                    result["message"] = f"🎬 AI智能混剪完成！\n\n**视频标题:** {script.get('title', 'AI混剪')}\n**风格:** {script.get('style', '创意混剪')}\n**生成片段数:** {len(generated_videos)}"
                else:
                    result["stages"][-1]["status"] = "失败"
                    result["success"] = False
                    result["error"] = "视频合成失败"
        else:
            result["message"] = f"🎬 AI剪辑脚本生成完成！\n\n**视频标题:** {script.get('title', 'AI混剪')}\n**风格:** {script.get('style', '创意混剪')}"
    
    # ===== 音频处理阶段 =====
    # 初始化video_path供后续字幕处理使用
    video_path = result.get("final_video")
    
    if result.get("success") and video_path and (add_narration or add_bgm):
        audio_path = None
        actual_bgm_path = None
        
        # 生成配音
        if add_narration:
            logger.info("[AI混剪] 添加AI配音...")
            result["stages"].append({"stage": "生成配音", "status": "进行中"})
            
            # 如果没有提供配音文本，自动生成
            if not narration_text:
                video_desc = result.get("script", {}).get("fusion_prompt", "") or \
                             result.get("script", {}).get("narrative", "") or \
                             user_prompt or "创意视频"
                narration_text = generate_narration_script(client, video_desc, narration_style)
            
            if narration_text:
                speech_result = generate_speech_edge_tts(
                    text=narration_text,
                    voice=narration_voice
                )
                if speech_result.get("success"):
                    audio_path = speech_result["local_path"]
                    result["stages"][-1]["status"] = "完成"
                    result["narration_text"] = narration_text
                    logger.info(f"  配音生成完成: {audio_path}")
                else:
                    result["stages"][-1]["status"] = "失败"
                    logger.warning(f"  配音生成失败: {speech_result.get('error')}")
            else:
                result["stages"][-1]["status"] = "跳过"
                logger.warning("  无法生成配音文本")
        
        # 处理背景音乐
        if add_bgm:
            if bgm_path and os.path.exists(bgm_path):
                actual_bgm_path = bgm_path
            elif bgm_id:
                bgm_info = PRESET_BGM.get(bgm_id)
                if bgm_info:
                    preset_path = os.path.join(BGM_DIR, bgm_info["file"])
                    if os.path.exists(preset_path):
                        actual_bgm_path = preset_path
        
        # 合成音视频
        if audio_path or actual_bgm_path:
            logger.info("[AI混剪] 合成音视频...")
            result["stages"].append({"stage": "合成音视频", "status": "进行中"})
            
            audio_result = add_audio_to_video(
                video_path=video_path,
                audio_path=audio_path or "",
                bgm_path=actual_bgm_path or "",
                bgm_volume=bgm_volume
            )
            
            if audio_result.get("success"):
                result["final_video"] = audio_result["local_path"]
                video_path = audio_result["local_path"]  # 更新video_path用于后续字幕处理
                result["stages"][-1]["status"] = "完成"
                
                # 更新消息
                audio_info = []
                if audio_path:
                    audio_info.append("🎙️ AI配音")
                if actual_bgm_path:
                    audio_info.append("🎵 背景音乐")
                result["message"] += f"\n\n**音频:** {' + '.join(audio_info)}"
                logger.info(f"  音视频合成完成: {audio_result['local_path']}")
            else:
                result["stages"][-1]["status"] = "失败"
                logger.warning(f"  音视频合成失败: {audio_result.get('error')}")
    
    # ===== 阶段: 字幕叠加 =====
    # 使用Pillow生成字幕图片，再用FFmpeg overlay叠加
    # 确保 video_path 有值
    if not video_path:
        video_path = result.get("final_video")
    
    if add_subtitles and result.get("subtitle_text") and PILLOW_AVAILABLE and video_path:
        logger.info("阶段: 字幕叠加")
        result["stages"].append({
            "name": "字幕叠加",
            "status": "进行中"
        })
        
        subtitle_text = result["subtitle_text"]
        
        # 生成字幕图片
        subtitle_img_result = generate_subtitle_image(
            text=subtitle_text,
            video_width=1280,  # CogVideoX默认分辨率
            video_height=720,
            style=subtitle_style,
            position=subtitle_position
        )
        
        if subtitle_img_result.get("success"):
            # 叠加字幕到视频
            overlay_result = overlay_subtitle_on_video(
                video_path=video_path,
                subtitle_image_path=subtitle_img_result["path"]
            )
            
            if overlay_result.get("success"):
                result["final_video"] = overlay_result["local_path"]
                video_path = overlay_result["local_path"]
                result["stages"][-1]["status"] = "完成"
                result["message"] += f"\n\n**字幕:** 📝 {subtitle_text}"
                logger.info(f"  字幕叠加完成: {overlay_result['local_path']}")
            else:
                result["stages"][-1]["status"] = "失败"
                logger.warning(f"  字幕叠加失败: {overlay_result.get('error')}")
        else:
            result["stages"][-1]["status"] = "失败"
            logger.warning(f"  字幕图片生成失败: {subtitle_img_result.get('error')}")
    elif add_subtitles and result.get("subtitle_text") and not PILLOW_AVAILABLE:
        logger.warning("Pillow未安装，跳过字幕叠加")
        result["message"] += "\n\n**字幕:** ⚠️ 需要安装Pillow库"
    
    # ===== 阶段: ASR字幕（语音识别自动生成字幕）=====
    if use_asr_subtitles and video_path and PILLOW_AVAILABLE:
        logger.info("阶段: ASR语音识别字幕")
        result["stages"].append({
            "name": "ASR字幕",
            "status": "进行中"
        })
        
        asr_subtitle_result = add_subtitles_from_asr(
            video_path=video_path,
            asr_method=asr_method,
            language=asr_language,
            style=subtitle_style,
            position=subtitle_position
        )
        
        if asr_subtitle_result.get("success"):
            result["final_video"] = asr_subtitle_result["local_path"]
            result["stages"][-1]["status"] = "完成"
            
            # 显示识别到的文本
            asr_text = asr_subtitle_result.get("text", "")[:100]
            segment_count = len(asr_subtitle_result.get("segments", []))
            result["message"] += f"\n\n**ASR字幕:** 🎙️ 识别到 {segment_count} 个片段"
            if asr_text:
                result["message"] += f"\n> {asr_text}..."
            
            logger.info(f"  ASR字幕添加完成: {asr_subtitle_result['local_path']}")
        else:
            result["stages"][-1]["status"] = "失败"
            error_msg = asr_subtitle_result.get('error', 'Unknown')
            logger.warning(f"  ASR字幕失败: {error_msg}")
            result["message"] += f"\n\n**ASR字幕:** ⚠️ {error_msg}"
    elif use_asr_subtitles and not PILLOW_AVAILABLE:
        logger.warning("Pillow未安装，跳过ASR字幕")
        result["message"] += "\n\n**ASR字幕:** ⚠️ 需要安装Pillow库"
    elif use_asr_subtitles and not video_path:
        logger.warning("没有视频，跳过ASR字幕")
    
    return result


def generate_video_internal(prompt: str) -> Dict:
    """内部视频生成函数，返回结构化结果"""
    api_key = os.getenv("ZHIPUAI_API_KEY")
    if not api_key:
        return {"success": False, "error": "未设置API Key"}
    
    try:
        client = ZhipuAI(api_key=api_key)
        
        response = client.videos.generations(
            model="cogvideox",
            prompt=prompt
        )
        
        task_id = response.id
        logger.info(f"Video generation task created: {task_id}")
        
        # 轮询检查状态
        max_attempts = 60
        for attempt in range(max_attempts):
            time.sleep(10)
            result = client.videos.retrieve_videos_result(id=task_id)
            
            if result.task_status == "SUCCESS":
                video_url = result.video_result[0].url
                local_path = download_file(video_url, ".mp4", "video")
                return {
                    "success": True,
                    "url": video_url,
                    "local_path": local_path
                }
            elif result.task_status == "FAIL":
                return {"success": False, "error": "视频生成失败"}
        
        return {"success": False, "error": "生成超时"}
    except Exception as e:
        logger.error(f"Video generation error: {e}")
        return {"success": False, "error": str(e)}


# ===================== 音频功能 =====================

# 预设背景音乐目录
BGM_DIR = os.path.join(os.getcwd(), "assets", "bgm")
os.makedirs(BGM_DIR, exist_ok=True)

# 预设背景音乐列表（需要用户自行添加音乐文件到 assets/bgm 目录）
PRESET_BGM = {
    "relaxing": {"name": "舒缓轻音乐", "file": "relaxing.mp3"},
    "upbeat": {"name": "欢快节奏", "file": "upbeat.mp3"},
    "cinematic": {"name": "电影感配乐", "file": "cinematic.mp3"},
    "emotional": {"name": "情感抒情", "file": "emotional.mp3"},
    "energetic": {"name": "动感活力", "file": "energetic.mp3"},
}


def generate_speech(
    text: str,
    voice: str = "alloy",
    output_name: str = ""
) -> Dict:
    """
    使用AI生成语音配音
    
    Args:
        text: 要转换为语音的文本
        voice: 声音类型
        output_name: 输出文件名
    
    Returns:
        包含音频路径的字典
    """
    api_key = os.getenv("ZHIPUAI_API_KEY")
    if not api_key:
        return {"success": False, "error": "未设置 ZHIPUAI_API_KEY"}
    
    try:
        client = ZhipuAI(api_key=api_key)
        
        # 使用智谱AI的语音合成API
        # 注意：这里使用的是标准接口，实际可能需要根据API文档调整
        response = client.audio.speech.create(
            model="tts-1",  # 语音合成模型
            input=text,
            voice=voice
        )
        
        # 保存音频文件
        if not output_name:
            output_name = f"speech_{uuid.uuid4()}.mp3"
        output_path = os.path.join(OUTPUT_DIR, output_name)
        
        # 根据响应类型保存
        if hasattr(response, 'content'):
            with open(output_path, 'wb') as f:
                f.write(response.content)
        elif hasattr(response, 'stream_to_file'):
            response.stream_to_file(output_path)
        else:
            return {"success": False, "error": "无法获取音频数据"}
        
        logger.info(f"Speech generated: {output_path}")
        return {
            "success": True,
            "local_path": output_path,
            "text": text
        }
    except Exception as e:
        logger.error(f"Speech generation error: {e}")
        # 如果智谱API不支持，尝试使用Edge TTS作为备选
        return generate_speech_edge_tts(text, voice, output_name)


def generate_speech_edge_tts(
    text: str,
    voice: str = "zh-CN-XiaoxiaoNeural",
    output_name: str = ""
) -> Dict:
    """
    使用Edge TTS生成语音（备选方案）
    
    Args:
        text: 要转换为语音的文本
        voice: 声音类型（Edge TTS支持的声音）
        output_name: 输出文件名
    """
    try:
        import edge_tts
        import asyncio
        
        if not output_name:
            output_name = f"speech_{uuid.uuid4()}.mp3"
        output_path = os.path.join(OUTPUT_DIR, output_name)
        
        async def generate():
            communicate = edge_tts.Communicate(text, voice)
            await communicate.save(output_path)
        
        # 处理事件循环问题：检查是否已经有运行的循环
        try:
            loop = asyncio.get_running_loop()
            # 如果在已有的事件循环中，使用线程来运行
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as executor:
                future = executor.submit(asyncio.run, generate())
                future.result(timeout=60)  # 60秒超时
        except RuntimeError:
            # 没有运行的事件循环，可以直接用asyncio.run
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


def generate_narration_script(client: ZhipuAI, video_description: str, style: str = "informative") -> str:
    """
    使用AI生成视频旁白脚本
    
    Args:
        client: ZhipuAI客户端
        video_description: 视频描述/内容
        style: 旁白风格（informative, emotional, energetic, poetic）
    
    Returns:
        旁白文本
    """
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


def add_audio_to_video(
    video_path: str,
    audio_path: str = "",
    bgm_path: str = "",
    bgm_volume: float = 0.3,
    narration_volume: float = 1.0,
    output_name: str = ""
) -> Dict:
    """
    为视频添加音频（配音和/或背景音乐）
    
    Args:
        video_path: 视频文件路径
        audio_path: 配音音频路径（可选）
        bgm_path: 背景音乐路径（可选）
        bgm_volume: 背景音乐音量（0-1）
        narration_volume: 配音音量（0-1）
        output_name: 输出文件名
    
    Returns:
        包含输出视频路径的字典
    """
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
        probe_cmd = [
            'ffprobe', '-v', 'error',
            '-show_entries', 'format=duration',
            '-of', 'default=noprint_wrappers=1:nokey=1',
            video_path
        ]
        duration_result = subprocess.run(probe_cmd, capture_output=True, text=True)
        video_duration = float(duration_result.stdout.strip()) if duration_result.stdout.strip() else 10
        
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
            logger.info(f"Video with audio created: {output_path}")
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
    
    # 扫描目录中的自定义音乐
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

# 字幕样式预设
SUBTITLE_STYLES = [
    {"id": "default", "name": "默认样式", "fontsize": 24, "fontcolor": "white", "borderw": 2},
    {"id": "modern", "name": "现代简约", "fontsize": 28, "fontcolor": "white", "borderw": 0, "shadowcolor": "black@0.5"},
    {"id": "cinematic", "name": "电影字幕", "fontsize": 32, "fontcolor": "white", "borderw": 3, "bordercolor": "black"},
    {"id": "vibrant", "name": "活力彩色", "fontsize": 26, "fontcolor": "yellow", "borderw": 2, "bordercolor": "black"},
    {"id": "minimal", "name": "极简风格", "fontsize": 22, "fontcolor": "white@0.9", "borderw": 1},
]


# ===================== 字幕功能 =====================

def generate_subtitle_for_video(client, video_prompt: str, title: str = "") -> str:
    """
    生成适合嵌入视频的简短字幕文案
    
    Args:
        client: ZhipuAI客户端
        video_prompt: 视频生成提示词
        title: 视频标题
    
    Returns:
        简短的字幕文案（适合在视频画面中显示）
    """
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
        # 清理可能的引号
        subtitle = subtitle.strip('"\'""''')
        return subtitle[:30]  # 限制长度
    except Exception as e:
        logger.error(f"Subtitle generation failed: {e}")
        return title[:20] if title else ""


def add_subtitle_to_prompt(original_prompt: str, subtitle_text: str) -> str:
    """
    将字幕要求添加到视频生成prompt中
    
    Args:
        original_prompt: 原始视频生成提示词
        subtitle_text: 要显示的字幕文本
    
    Returns:
        包含字幕要求的新prompt
    """
    if not subtitle_text:
        return original_prompt
    
    # 在prompt末尾添加字幕显示要求
    subtitle_instruction = f'。画面底部居中位置显示白色中文字幕："{subtitle_text}"，字幕清晰可读，带黑色描边。'
    
    return original_prompt + subtitle_instruction


def generate_subtitle_text(
    client,
    video_description: str,
    narration_text: str = "",
    style: str = "informative"
) -> str:
    """
    生成字幕文本（如果没有配音文案，则生成新的）
    
    Args:
        client: ZhipuAI客户端
        video_description: 视频描述
        narration_text: 已有的配音文本（可选）
        style: 字幕风格
    
    Returns:
        字幕文本
    """
    # 如果已有配音文本，直接使用
    if narration_text:
        return narration_text
    
    # 否则生成新的字幕文本
    return generate_narration_script(client, video_description, style)


def generate_subtitle_image(
    text: str,
    video_width: int = 1280,
    video_height: int = 720,
    style: str = "default",
    position: str = "bottom",
    output_path: str = ""
) -> Dict:
    """
    使用Pillow生成字幕图片（透明背景PNG）
    
    Args:
        text: 字幕文本
        video_width: 视频宽度
        video_height: 视频高度
        style: 字幕风格 (default, modern, cinematic, vibrant, minimal)
        position: 字幕位置 (top, center, bottom)
        output_path: 输出路径，如果为空则自动生成
    
    Returns:
        包含success, path等信息的字典
    """
    if not PILLOW_AVAILABLE:
        return {"success": False, "error": "Pillow库未安装，无法生成字幕图片"}
    
    if not text:
        return {"success": False, "error": "字幕文本为空"}
    
    try:
        # 字幕样式配置
        style_configs = {
            "default": {
                "font_color": (255, 255, 255, 255),  # 白色
                "stroke_color": (0, 0, 0, 255),  # 黑色描边
                "stroke_width": 3,
                "shadow": True,
                "font_size_ratio": 0.04  # 字体大小为视频高度的4%
            },
            "modern": {
                "font_color": (255, 255, 255, 255),
                "stroke_color": (50, 50, 50, 200),
                "stroke_width": 2,
                "shadow": True,
                "font_size_ratio": 0.045
            },
            "cinematic": {
                "font_color": (255, 255, 200, 255),  # 暖白色
                "stroke_color": (0, 0, 0, 255),
                "stroke_width": 4,
                "shadow": True,
                "font_size_ratio": 0.05
            },
            "vibrant": {
                "font_color": (255, 255, 0, 255),  # 黄色
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
        
        # 计算字体大小
        font_size = int(video_height * config["font_size_ratio"])
        
        # 查找中文字体（macOS系统字体）
        font_paths = [
            "/System/Library/Fonts/PingFang.ttc",
            "/System/Library/Fonts/STHeiti Light.ttc",
            "/System/Library/Fonts/STHeiti Medium.ttc",
            "/Library/Fonts/Arial Unicode.ttf",
            "/System/Library/Fonts/Hiragino Sans GB.ttc",
            "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",  # Linux
            "C:/Windows/Fonts/msyh.ttc",  # Windows 微软雅黑
            "C:/Windows/Fonts/simhei.ttf",  # Windows 黑体
        ]
        
        font = None
        for font_path in font_paths:
            if os.path.exists(font_path):
                try:
                    font = ImageFont.truetype(font_path, font_size)
                    logger.info(f"使用字体: {font_path}")
                    break
                except Exception as e:
                    logger.warning(f"无法加载字体 {font_path}: {e}")
                    continue
        
        if font is None:
            # 使用默认字体
            font = ImageFont.load_default()
            logger.warning("使用默认字体（可能不支持中文）")
        
        # 创建透明背景图片
        img = Image.new('RGBA', (video_width, video_height), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)
        
        # 计算文本尺寸
        bbox = draw.textbbox((0, 0), text, font=font)
        text_width = bbox[2] - bbox[0]
        text_height = bbox[3] - bbox[1]
        
        # 如果文本太长，换行处理
        max_width = int(video_width * 0.9)
        if text_width > max_width:
            # 分行
            chars_per_line = int(len(text) * max_width / text_width)
            lines = []
            for i in range(0, len(text), chars_per_line):
                lines.append(text[i:i+chars_per_line])
            text = '\n'.join(lines)
            
            # 重新计算尺寸
            bbox = draw.textbbox((0, 0), text, font=font)
            text_width = bbox[2] - bbox[0]
            text_height = bbox[3] - bbox[1]
        
        # 计算位置
        x = (video_width - text_width) // 2
        
        if position == "top":
            y = int(video_height * 0.1)
        elif position == "center":
            y = (video_height - text_height) // 2
        else:  # bottom
            y = int(video_height * 0.85) - text_height
        
        # 绘制阴影
        if config["shadow"]:
            shadow_offset = 3
            draw.text(
                (x + shadow_offset, y + shadow_offset),
                text,
                font=font,
                fill=(0, 0, 0, 128)
            )
        
        # 绘制描边
        stroke_width = config["stroke_width"]
        stroke_color = config["stroke_color"]
        for dx in range(-stroke_width, stroke_width + 1):
            for dy in range(-stroke_width, stroke_width + 1):
                if dx != 0 or dy != 0:
                    draw.text((x + dx, y + dy), text, font=font, fill=stroke_color)
        
        # 绘制主文本
        draw.text((x, y), text, font=font, fill=config["font_color"])
        
        # 保存图片
        if not output_path:
            output_path = os.path.join(OUTPUT_DIR, f"subtitle_{int(time.time())}.png")
        
        img.save(output_path, 'PNG')
        logger.info(f"字幕图片生成成功: {output_path}")
        
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
    """
    使用FFmpeg将字幕图片叠加到视频上
    
    Args:
        video_path: 输入视频路径
        subtitle_image_path: 字幕图片路径（透明PNG）
        output_path: 输出视频路径
    
    Returns:
        包含success, local_path等信息的字典
    """
    if not os.path.exists(video_path):
        return {"success": False, "error": f"视频文件不存在: {video_path}"}
    
    if not os.path.exists(subtitle_image_path):
        return {"success": False, "error": f"字幕图片不存在: {subtitle_image_path}"}
    
    try:
        # 生成输出路径
        if not output_path:
            base_name = os.path.splitext(os.path.basename(video_path))[0]
            output_path = os.path.join(OUTPUT_DIR, f"{base_name}_subtitled.mp4")
        
        # 使用FFmpeg overlay滤镜叠加字幕图片
        # overlay滤镜不需要libass或freetype
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
        
        logger.info(f"执行字幕叠加命令: {' '.join(cmd)}")
        result = subprocess.run(cmd, capture_output=True, text=True)
        
        if result.returncode != 0:
            logger.error(f"字幕叠加失败: {result.stderr}")
            return {"success": False, "error": result.stderr}
        
        logger.info(f"字幕叠加成功: {output_path}")
        
        # 清理临时字幕图片
        try:
            os.remove(subtitle_image_path)
        except:
            pass
        
        return {
            "success": True,
            "local_path": output_path
        }
        
    except Exception as e:
        logger.error(f"字幕叠加失败: {e}")
        return {"success": False, "error": str(e)}


def extract_audio_from_video(video_path: str, output_path: str = "") -> Dict:
    """
    从视频中提取音频
    
    Args:
        video_path: 视频文件路径
        output_path: 输出音频路径
    
    Returns:
        包含success, audio_path的字典
    """
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


def transcribe_audio_whisper(audio_path: str, language: str = "zh") -> Dict:
    """
    使用Whisper进行本地语音识别
    
    Args:
        audio_path: 音频文件路径
        language: 语言代码 (zh, en, etc.)
    
    Returns:
        包含success, segments的字典，segments包含时间戳和文本
    """
    if not WHISPER_AVAILABLE:
        return {"success": False, "error": "Whisper未安装，请运行: pip install openai-whisper"}
    
    if not os.path.exists(audio_path):
        return {"success": False, "error": f"音频文件不存在: {audio_path}"}
    
    try:
        logger.info(f"使用Whisper识别音频: {audio_path}")
        
        # 加载模型（首次会下载）
        # base模型较小且中文效果不错，large模型更准确但更慢
        model = whisper.load_model("base")
        
        # 转录
        result = model.transcribe(
            audio_path,
            language=language,
            word_timestamps=True,
            verbose=False
        )
        
        # 提取segments（带时间戳）
        segments = []
        for seg in result.get("segments", []):
            segments.append({
                "start": seg["start"],
                "end": seg["end"],
                "text": seg["text"].strip()
            })
        
        logger.info(f"Whisper识别完成，共 {len(segments)} 个片段")
        
        return {
            "success": True,
            "text": result.get("text", ""),
            "segments": segments,
            "language": result.get("language", language)
        }
        
    except Exception as e:
        logger.error(f"Whisper识别失败: {e}")
        return {"success": False, "error": str(e)}


def transcribe_audio_glm_asr(audio_path: str) -> Dict:
    """
    使用智谱 GLM-ASR 进行语音识别
    
    Args:
        audio_path: 音频文件路径
    
    Returns:
        包含success, segments的字典
    """
    api_key = os.getenv("ZHIPUAI_API_KEY")
    if not api_key:
        return {"success": False, "error": "未设置ZHIPUAI_API_KEY"}
    
    if not os.path.exists(audio_path):
        return {"success": False, "error": f"音频文件不存在: {audio_path}"}
    
    try:
        logger.info(f"使用GLM-ASR识别音频: {audio_path}")
        
        client = ZhipuAI(api_key=api_key)
        
        # 读取音频文件并转为base64
        with open(audio_path, "rb") as f:
            audio_data = base64.b64encode(f.read()).decode()
        
        # 调用智谱ASR API
        # 注意：这是假设的API格式，需要根据实际API文档调整
        response = client.audio.transcriptions.create(
            model="glm-asr",
            file=open(audio_path, "rb"),
            response_format="verbose_json"  # 获取时间戳
        )
        
        # 解析结果
        segments = []
        if hasattr(response, 'segments'):
            for seg in response.segments:
                segments.append({
                    "start": seg.get("start", 0),
                    "end": seg.get("end", 0),
                    "text": seg.get("text", "").strip()
                })
        
        return {
            "success": True,
            "text": response.text if hasattr(response, 'text') else "",
            "segments": segments
        }
        
    except Exception as e:
        logger.error(f"GLM-ASR识别失败: {e}")
        return {"success": False, "error": str(e)}


def generate_srt_from_segments(segments: List[Dict], output_path: str) -> str:
    """
    从ASR识别结果生成SRT字幕文件
    
    Args:
        segments: ASR识别的片段列表，每个包含start, end, text
        output_path: 输出SRT文件路径
    
    Returns:
        SRT文件路径
    """
    def format_time(seconds: float) -> str:
        """将秒数转换为SRT时间格式 HH:MM:SS,mmm"""
        hours = int(seconds // 3600)
        minutes = int((seconds % 3600) // 60)
        secs = int(seconds % 60)
        millis = int((seconds % 1) * 1000)
        return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"
    
    srt_content = []
    for i, seg in enumerate(segments, 1):
        start_time = format_time(seg["start"])
        end_time = format_time(seg["end"])
        text = seg["text"]
        
        srt_content.append(f"{i}")
        srt_content.append(f"{start_time} --> {end_time}")
        srt_content.append(text)
        srt_content.append("")  # 空行分隔
    
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(srt_content))
    
    logger.info(f"SRT字幕文件生成: {output_path}")
    return output_path


def burn_subtitles_with_pillow(
    video_path: str,
    segments: List[Dict],
    style: str = "default",
    position: str = "bottom",
    output_path: str = ""
) -> Dict:
    """
    使用Pillow+FFmpeg烧录字幕到视频
    通过为每个字幕片段生成图片，然后用FFmpeg按时间叠加
    
    Args:
        video_path: 输入视频路径
        segments: 字幕片段列表
        style: 字幕样式
        position: 字幕位置
        output_path: 输出视频路径
    
    Returns:
        包含success, local_path的字典
    """
    if not PILLOW_AVAILABLE:
        return {"success": False, "error": "Pillow未安装"}
    
    if not os.path.exists(video_path):
        return {"success": False, "error": f"视频文件不存在: {video_path}"}
    
    if not segments:
        return {"success": False, "error": "没有字幕片段"}
    
    try:
        # 获取视频信息
        probe_cmd = [
            "ffprobe", "-v", "quiet",
            "-select_streams", "v:0",
            "-show_entries", "stream=width,height,duration",
            "-of", "json",
            video_path
        ]
        probe_result = subprocess.run(probe_cmd, capture_output=True, text=True)
        video_info = json.loads(probe_result.stdout)
        
        stream = video_info.get("streams", [{}])[0]
        video_width = int(stream.get("width", 1280))
        video_height = int(stream.get("height", 720))
        
        logger.info(f"视频尺寸: {video_width}x{video_height}")
        
        # 为每个字幕片段生成图片
        subtitle_images = []
        for i, seg in enumerate(segments):
            img_path = os.path.join(OUTPUT_DIR, f"sub_{i}_{int(time.time())}.png")
            
            img_result = generate_subtitle_image(
                text=seg["text"],
                video_width=video_width,
                video_height=video_height,
                style=style,
                position=position,
                output_path=img_path
            )
            
            if img_result.get("success"):
                subtitle_images.append({
                    "path": img_path,
                    "start": seg["start"],
                    "end": seg["end"]
                })
        
        if not subtitle_images:
            return {"success": False, "error": "无法生成字幕图片"}
        
        # 生成输出路径
        if not output_path:
            base_name = os.path.splitext(os.path.basename(video_path))[0]
            output_path = os.path.join(OUTPUT_DIR, f"{base_name}_subtitled.mp4")
        
        # 构建复杂的FFmpeg filter
        # 使用 overlay + enable 来控制每个字幕的显示时间
        inputs = ["-i", video_path]
        filter_parts = []
        
        for i, sub in enumerate(subtitle_images):
            inputs.extend(["-i", sub["path"]])
        
        # 构建filter_complex
        # [0:v] -> 原视频
        # [1:v], [2:v]... -> 字幕图片
        current_stream = "0:v"
        for i, sub in enumerate(subtitle_images):
            start = sub["start"]
            end = sub["end"]
            next_stream = f"v{i}"
            
            # overlay with enable condition
            filter_parts.append(
                f"[{current_stream}][{i+1}:v]overlay=0:0:enable='between(t,{start},{end})'[{next_stream}]"
            )
            current_stream = next_stream
        
        filter_complex = ";".join(filter_parts)
        
        cmd = [
            "ffmpeg", "-y",
            *inputs,
            "-filter_complex", filter_complex,
            "-map", f"[{current_stream}]",
            "-map", "0:a?",  # 音频（如果有）
            "-c:v", "libx264",
            "-preset", "medium",
            "-crf", "23",
            "-c:a", "copy",
            output_path
        ]
        
        logger.info(f"执行字幕烧录命令...")
        result = subprocess.run(cmd, capture_output=True, text=True)
        
        # 清理临时字幕图片
        for sub in subtitle_images:
            try:
                os.remove(sub["path"])
            except:
                pass
        
        if result.returncode != 0:
            logger.error(f"字幕烧录失败: {result.stderr}")
            return {"success": False, "error": result.stderr}
        
        logger.info(f"字幕烧录成功: {output_path}")
        return {"success": True, "local_path": output_path}
        
    except Exception as e:
        logger.error(f"字幕烧录失败: {e}")
        return {"success": False, "error": str(e)}


def add_subtitles_from_asr(
    video_path: str,
    asr_method: str = "whisper",  # "whisper" or "glm-asr"
    language: str = "zh",
    style: str = "default",
    position: str = "bottom",
    output_path: str = ""
) -> Dict:
    """
    通过ASR识别视频语音并添加字幕
    
    完整流程：
    1. 从视频提取音频
    2. 使用ASR识别语音
    3. 生成字幕并烧录到视频
    
    Args:
        video_path: 输入视频路径
        asr_method: ASR方法 ("whisper" 或 "glm-asr")
        language: 语言
        style: 字幕样式
        position: 字幕位置
        output_path: 输出视频路径
    
    Returns:
        包含success, local_path, segments的字典
    """
    logger.info(f"开始ASR字幕处理: {video_path}")
    
    # Step 1: 提取音频
    logger.info("Step 1: 提取音频...")
    audio_result = extract_audio_from_video(video_path)
    if not audio_result.get("success"):
        return {"success": False, "error": f"提取音频失败: {audio_result.get('error')}"}
    
    audio_path = audio_result["audio_path"]
    
    # Step 2: ASR识别
    logger.info(f"Step 2: 使用{asr_method}进行语音识别...")
    if asr_method == "whisper":
        asr_result = transcribe_audio_whisper(audio_path, language)
    else:
        asr_result = transcribe_audio_glm_asr(audio_path)
    
    # 清理临时音频
    try:
        os.remove(audio_path)
    except:
        pass
    
    if not asr_result.get("success"):
        return {"success": False, "error": f"ASR识别失败: {asr_result.get('error')}"}
    
    segments = asr_result.get("segments", [])
    if not segments:
        return {"success": False, "error": "ASR未识别到任何语音"}
    
    logger.info(f"识别到 {len(segments)} 个字幕片段")
    
    # Step 3: 烧录字幕
    logger.info("Step 3: 烧录字幕到视频...")
    burn_result = burn_subtitles_with_pillow(
        video_path=video_path,
        segments=segments,
        style=style,
        position=position,
        output_path=output_path
    )
    
    if burn_result.get("success"):
        burn_result["segments"] = segments
        burn_result["text"] = asr_result.get("text", "")
    
    return burn_result


def create_srt_file(
    text: str,
    duration: float,
    output_path: str,
    chars_per_line: int = 15,
    chars_per_second: float = 4.0
) -> str:
    """
    将文本转换为SRT字幕文件
    
    Args:
        text: 字幕文本
        duration: 视频时长（秒）
        output_path: 输出SRT文件路径
        chars_per_line: 每行最大字符数
        chars_per_second: 每秒显示的字符数
    
    Returns:
        SRT文件路径
    """
    import re
    
    # 清理文本
    text = text.strip()
    
    # 分割成句子（按标点符号）
    sentences = re.split(r'([。！？，；、\n])', text)
    
    # 重新组合句子（保留标点）
    segments = []
    current = ""
    for i, part in enumerate(sentences):
        if part in '。！？，；、\n':
            current += part
            if current.strip():
                segments.append(current.strip())
            current = ""
        else:
            current += part
    if current.strip():
        segments.append(current.strip())
    
    # 如果分段太少，按字符数分割
    if len(segments) < 2:
        segments = []
        words = list(text)
        current = ""
        for char in words:
            current += char
            if len(current) >= chars_per_line and char in '，。！？、；\n ':
                segments.append(current.strip())
                current = ""
        if current.strip():
            segments.append(current.strip())
    
    # 如果还是太少，强制分割
    if len(segments) < 2:
        segments = [text[i:i+chars_per_line] for i in range(0, len(text), chars_per_line)]
    
    # 计算每个片段的时间
    total_chars = sum(len(s) for s in segments)
    
    srt_content = []
    current_time = 0.0
    
    for i, segment in enumerate(segments):
        # 计算该片段的持续时间
        segment_duration = max((len(segment) / total_chars) * duration, 1.0)
        
        # 确保不超过视频时长
        if current_time + segment_duration > duration:
            segment_duration = duration - current_time
        
        if segment_duration <= 0:
            break
        
        start_time = current_time
        end_time = current_time + segment_duration
        
        # 格式化时间
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
    
    # 写入文件
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(srt_content))
    
    logger.info(f"SRT file created: {output_path} ({len(segments)} segments)")
    return output_path


def get_video_duration(video_path: str) -> float:
    """获取视频时长"""
    try:
        import subprocess
        result = subprocess.run(
            ['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
             '-of', 'default=noprint_wrappers=1:nokey=1', video_path],
            capture_output=True, text=True
        )
        return float(result.stdout.strip())
    except Exception as e:
        logger.warning(f"Failed to get video duration: {e}")
        return 6.0  # 默认6秒


def add_subtitles_to_video(
    video_path: str,
    subtitle_text: str,
    subtitle_style: str = "default",
    font_size: int = 0,
    font_color: str = "",
    position: str = "bottom",
    output_name: str = ""
) -> Dict:
    """
    为视频添加字幕
    
    Args:
        video_path: 视频文件路径
        subtitle_text: 字幕文本
        subtitle_style: 字幕样式预设ID
        font_size: 字体大小（0表示使用预设）
        font_color: 字体颜色（空表示使用预设）
        position: 字幕位置（top, center, bottom）
        output_name: 输出文件名
    
    Returns:
        包含输出视频路径的字典
    """
    if not shutil.which("ffmpeg"):
        return {"success": False, "error": "系统未安装 FFmpeg"}
    
    if not os.path.exists(video_path):
        return {"success": False, "error": f"视频文件不存在: {video_path}"}
    
    if not subtitle_text.strip():
        return {"success": False, "error": "字幕文本为空"}
    
    try:
        # 获取视频时长
        duration = get_video_duration(video_path)
        
        # 创建SRT文件
        srt_filename = f"subtitle_{uuid.uuid4()}.srt"
        srt_path = os.path.join(OUTPUT_DIR, srt_filename)
        create_srt_file(subtitle_text, duration, srt_path)
        
        # 获取字幕样式
        style_config = next(
            (s for s in SUBTITLE_STYLES if s["id"] == subtitle_style),
            SUBTITLE_STYLES[0]
        )
        
        # 使用参数覆盖预设
        actual_fontsize = font_size if font_size > 0 else style_config.get("fontsize", 24)
        actual_fontcolor = font_color if font_color else style_config.get("fontcolor", "white")
        borderw = style_config.get("borderw", 2)
        bordercolor = style_config.get("bordercolor", "black")
        
        # 计算位置
        position_map = {
            "top": "10",
            "center": "(h-text_h)/2",
            "bottom": "h-th-20"
        }
        margin_v = position_map.get(position, "h-th-20")
        
        if not output_name:
            output_name = f"video_with_subtitles_{uuid.uuid4()}.mp4"
        output_path = os.path.join(OUTPUT_DIR, output_name)
        
        # 转义SRT路径中的特殊字符（FFmpeg需要）
        escaped_srt_path = srt_path.replace("\\", "/").replace(":", "\\:").replace("'", "\\'")
        
        # 构建subtitles filter
        subtitle_filter = (
            f"subtitles='{escaped_srt_path}'"
            f":force_style='FontSize={actual_fontsize},"
            f"PrimaryColour=&H{''.join(reversed([actual_fontcolor[i:i+2] if len(actual_fontcolor) > 2 else 'FFFFFF' for i in range(0, 6, 2)]))},"
            f"OutlineColour=&H000000,"
            f"BorderStyle=1,"
            f"Outline={borderw},"
            f"Shadow=1,"
            f"MarginV=20'"
        )
        
        # 简化的subtitle filter（更兼容）
        # 注意：subtitles滤镜需要FFmpeg编译时启用libass
        # 先尝试subtitles，失败则用drawtext
        subtitle_filter = f"subtitles='{escaped_srt_path}'"
        
        cmd = [
            "ffmpeg", "-y",
            "-i", video_path,
            "-vf", subtitle_filter,
            "-c:a", "copy",
            output_path
        ]
        
        logger.info(f"Running FFmpeg for subtitles: {' '.join(cmd)}")
        result = subprocess.run(cmd, capture_output=True, text=True)
        
        if result.returncode != 0:
            logger.warning(f"FFmpeg subtitles filter failed (may need libass): {result.stderr[:200]}")
            # 尝试使用drawtext作为备选
            logger.info("Falling back to drawtext method...")
            return add_subtitles_drawtext(video_path, subtitle_text, actual_fontsize, actual_fontcolor, output_name)
        
        if os.path.exists(output_path):
            logger.info(f"Video with subtitles created: {output_path}")
            return {
                "success": True,
                "local_path": output_path,
                "srt_path": srt_path
            }
        else:
            return {"success": False, "error": "输出文件未生成"}
            
    except Exception as e:
        logger.error(f"Add subtitles error: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


def add_subtitles_drawtext(
    video_path: str,
    subtitle_text: str,
    font_size: int = 24,
    font_color: str = "white",
    output_name: str = ""
) -> Dict:
    """
    使用drawtext滤镜添加简单字幕（备选方案）
    适用于不支持subtitles滤镜的情况
    """
    try:
        if not output_name:
            output_name = f"video_with_subtitles_{uuid.uuid4()}.mp4"
        output_path = os.path.join(OUTPUT_DIR, output_name)
        
        # 获取视频时长
        duration = get_video_duration(video_path)
        
        # 查找中文字体
        font_paths = [
            "/System/Library/Fonts/PingFang.ttc",  # macOS
            "/System/Library/Fonts/STHeiti Light.ttc",  # macOS
            "/System/Library/Fonts/Hiragino Sans GB.ttc",  # macOS
            "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",  # Linux
            "/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc",  # Linux
            "C:/Windows/Fonts/msyh.ttc",  # Windows
            "C:/Windows/Fonts/simhei.ttf",  # Windows
        ]
        
        font_file = None
        for fp in font_paths:
            if os.path.exists(fp):
                font_file = fp
                break
        
        # 分割字幕
        segments = []
        text = subtitle_text.strip()
        max_chars = 18
        
        # 按标点分割
        import re
        parts = re.split(r'([。！？，、；])', text)
        current = ""
        for part in parts:
            if part in '。！？，、；':
                current += part
                if current.strip():
                    segments.append(current.strip())
                current = ""
            else:
                current += part
        if current.strip():
            segments.append(current.strip())
        
        # 如果没有分割成功，按长度分割
        if len(segments) <= 1:
            segments = [text[i:i+max_chars] for i in range(0, len(text), max_chars)]
        
        # 如果还是空的，直接用原文本
        if not segments:
            segments = [text[:max_chars]] if text else [""]
        
        # 计算每段时间
        segment_duration = duration / len(segments) if segments else duration
        
        # 构建drawtext filter
        filters = []
        for i, seg in enumerate(segments):
            if not seg.strip():
                continue
            start = i * segment_duration
            end = (i + 1) * segment_duration
            # 转义特殊字符 - FFmpeg需要双重转义
            escaped_text = seg.replace("\\", "\\\\").replace("'", "'\\''").replace(":", "\\:")
            
            filter_str = f"drawtext=text='{escaped_text}'"
            if font_file:
                escaped_font = font_file.replace(":", "\\:")
                filter_str += f":fontfile='{escaped_font}'"
            filter_str += (
                f":fontsize={font_size}"
                f":fontcolor={font_color}"
                f":borderw=2:bordercolor=black"
                f":x=(w-text_w)/2:y=h-th-40"
                f":enable='between(t,{start:.2f},{end:.2f})'"
            )
            filters.append(filter_str)
        
        if not filters:
            return {"success": False, "error": "没有有效的字幕内容"}
        
        filter_complex = ",".join(filters)
        
        cmd = [
            "ffmpeg", "-y",
            "-i", video_path,
            "-vf", filter_complex,
            "-c:a", "copy",
            output_path
        ]
        
        logger.info(f"Running FFmpeg drawtext with {len(filters)} segments...")
        result = subprocess.run(cmd, capture_output=True, text=True)
        
        if result.returncode != 0:
            logger.error(f"FFmpeg drawtext error: {result.stderr}")
            # 最后尝试：不加字幕，直接返回原视频
            logger.warning("字幕添加失败，返回原视频")
            return {
                "success": True,
                "local_path": video_path,
                "method": "skipped",
                "warning": "字幕添加失败，已跳过"
            }
        
        if os.path.exists(output_path):
            logger.info(f"Video with subtitles (drawtext) created: {output_path}")
            return {
                "success": True,
                "local_path": output_path,
                "method": "drawtext"
            }
        else:
            return {"success": False, "error": "输出文件未生成"}
            
    except Exception as e:
        logger.error(f"Drawtext subtitles error: {e}", exc_info=True)
        return {"success": False, "error": str(e)}
