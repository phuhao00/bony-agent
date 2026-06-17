"""
视频生成工具 — 独立模块
支持供应商: 即梦, 智谱 (CogVideoX), OpenRouter (Minimax等)
"""
import base64
import mimetypes
import os
import re
import time
import json
import requests
from typing import Any, Dict, Optional
from urllib.parse import urlparse, unquote
from langchain.tools import tool
from utils.logger import setup_logger

from tools.media_common import (
    _resolve_provider, _check_provider_capability, _get_provider_api_key,
    create_zhipu_client,
    download_file, jimeng_call,
    dashscope_submit_async, dashscope_wait_task,
    UPLOAD_DIR,
)
from tools.memory_tools import save_generation_to_memory
from utils.generation_history import add_generation_record

logger = setup_logger("video_tools")


def _env_float(name: str, default: float, minimum: float) -> float:
    try:
        return max(minimum, float(os.getenv(name, str(default))))
    except ValueError:
        logger.warning("Invalid %s value; using default %s", name, default)
        return default


def _env_int(name: str, default: int, minimum: int) -> int:
    try:
        return max(minimum, int(os.getenv(name, str(default))))
    except ValueError:
        logger.warning("Invalid %s value; using default %s", name, default)
        return default


DOUBAO_VIDEO_POLL_INTERVAL = _env_float("DOUBAO_VIDEO_POLL_INTERVAL", 5.0, 1.0)
DOUBAO_VIDEO_MAX_WAIT = _env_int("DOUBAO_VIDEO_MAX_WAIT", 600, 60)
ZHIPU_VIDEO_POLL_INTERVAL = _env_float("ZHIPU_VIDEO_POLL_INTERVAL", 5.0, 1.0)
ZHIPU_VIDEO_MAX_WAIT = _env_int("ZHIPU_VIDEO_MAX_WAIT", 600, 60)
ZHIPU_INTERNAL_VIDEO_POLL_INTERVAL = _env_float("ZHIPU_INTERNAL_VIDEO_POLL_INTERVAL", 10.0, 1.0)


# ============== 豆包 海溯视频生成 ==============

def _doubao_generate_video(prompt: str = "", image_url: str = None) -> Dict:
    """豆包 SeaDance API 调用"""
    logger.info(f"[Doubao] 提交视频生成任务: prompt={prompt[:40]}..., image={bool(image_url)}")
    
    api_key = _get_provider_api_key("doubao")
    if not api_key:
        return {"success": False, "error": "Doubao API Key (BYTEDANCE_API_KEY) 未配置"}

    url = "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}"
    }

    content_list = []
    if prompt:
        content_list.append({
            "type": "text",
            "text": prompt
        })
    if image_url:
        content_list.append({
            "type": "image_url",
            "image_url": {"url": image_url}
        })
        
    data = {
        "model": "doubao-seedance-1-0-pro-250528",
        "content": content_list,
        "ratio": "16:9",
        "duration": 5,
        "watermark": False
    }

    try:
        resp = requests.post(url, headers=headers, json=data, timeout=30)
        resp.raise_for_status()
        resp_json = resp.json()
        
        # 兼容两种返回结构
        task_id = resp_json.get("id")
        if not task_id and "data" in resp_json:
            task_id = resp_json["data"].get("id")
            
        if not task_id:
            return {"success": False, "error": f"豆包服务端未返回 task_id: {resp_json}"}

        logger.info(f"[Doubao] 视频任务已提交: task_id={task_id}")

        # 轮询结果
        deadline = time.monotonic() + DOUBAO_VIDEO_MAX_WAIT
        attempt = 0
        while time.monotonic() < deadline:
            attempt += 1
            time.sleep(DOUBAO_VIDEO_POLL_INTERVAL)
            poll_resp = requests.get(f"{url}/{task_id}", headers=headers, timeout=30)
            poll_resp.raise_for_status()
            poll_data = poll_resp.json()

            status = poll_data.get("status", "")
            
            if status == "succeeded":
                # 解析视频 URL
                video_url = ""
                content = poll_data.get("content", {})
                if isinstance(content, dict):
                    video_url = content.get("video_url", "")
                elif isinstance(content, list):
                    # 兼容可能返回 list 的老版本
                    for item in content:
                        if isinstance(item, dict) and item.get("type") == "video_url":
                            video_url = item.get("video_url", {}).get("url", "")
                            break
                        
                if video_url:
                    local_path = download_file(video_url, ".mp4", "video")
                    return {
                        "success": True,
                        "url": video_url,
                        "local_path": local_path,
                        "provider": "doubao",
                        "model": "doubao-seedance-1-0-pro-250528"
                    }
                else:
                    return {"success": False, "error": f"豆包返回成功但无法解析视频 URL: {poll_data}"}

            elif status in ["failed", "cancelled"]:
                return {"success": False, "error": f"豆包视频生成失败: 状态 {status}, {poll_data.get('error', '')}"}

            if attempt % 6 == 0:
                logger.info(f"[Doubao] ⏳ 视频生成中... task_id={task_id}, status={status}")

        return {"success": False, "error": "豆包视频生成超时"}
    except requests.exceptions.RequestException as e:
        logger.error(f"[Doubao] 请求异常: {e}")
        return {"success": False, "error": f"网络请求失败: {str(e)}"}
    except Exception as e:
        logger.error(f"[Doubao] 视频生成异常: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


def _is_happyhorse_model(model_id: str) -> bool:
    return (model_id or "").lower().startswith("happyhorse")


def _dashscope_video_provider_label(model_id: str) -> str:
    return "欢乐马 HappyHorse" if _is_happyhorse_model(model_id) else "通义万影 Wan"


def _dashscope_video_request_body(prompt: str, model_id: str) -> Dict:
    """按模型代际组装请求体：HappyHorse / wan2.7 使用 resolution/ratio；更早 Wan 使用 size。"""
    mid = model_id or "wan2.7-t2v"
    body: Dict = {"model": mid, "input": {"prompt": prompt}}
    if _is_happyhorse_model(mid):
        body["parameters"] = {
            "resolution": "720P",
            "ratio": "16:9",
            "duration": 5,
            "watermark": False,
        }
    elif mid.startswith("wan2.7"):
        body["parameters"] = {
            "resolution": "720P",
            "ratio": "16:9",
            "prompt_extend": True,
            "duration": 5,
            "watermark": False,
        }
    elif mid.startswith("wan2.6"):
        body["parameters"] = {
            "size": "1920*1080",
            "prompt_extend": True,
            "duration": 5,
        }
    elif mid.startswith("wan2.5"):
        body["parameters"] = {
            "size": "1920*1080",
            "prompt_extend": True,
            "duration": 5,
        }
    elif mid.startswith("wan2.2") or mid.startswith("wanx2.1"):
        body["parameters"] = {
            "size": "1280*720",
            "prompt_extend": True,
        }
    else:
        body["parameters"] = {
            "size": "1280*720",
            "prompt_extend": True,
        }
    return body


def _dashscope_generate_video(prompt: str, model_id: str = "") -> Dict:
    """阿里云 DashScope 万影文生视频（异步任务 + 轮询）"""
    mid = model_id or "wan2.7-t2v"
    logger.info(f"[DashScope/Wan] 提交文生视频: model={mid}, prompt={prompt[:60]}...")

    submit = dashscope_submit_async(
        "services/aigc/video-generation/video-synthesis",
        _dashscope_video_request_body(prompt, mid),
    )
    if not submit.get("ok"):
        return {"success": False, "error": submit.get("error", "unknown")}

    task_id = submit["task_id"]
    logger.info(f"[DashScope/Wan] video task created: task_id={task_id}")

    wait = dashscope_wait_task(task_id, label="wan-video", interval=5.0, max_wait=1200)
    if not wait.get("ok"):
        err = wait.get("error", "unknown")
        logger.error(f"[DashScope/Wan] task={task_id} failed: {err}")
        return {"success": False, "error": f"视频生成失败(task={task_id}): {err}"}

    out = wait.get("output") or {}
    video_url = out.get("video_url", "")
    if not video_url:
        return {
            "success": False,
            "error": f"未返回 video_url: {json.dumps(out, ensure_ascii=False)[:400]}",
        }

    local_path = download_file(video_url, ".mp4", "video")
    return {
        "success": True,
        "url": video_url,
        "local_path": local_path,
        "provider": "alibaba",
        "model": mid,
    }


def _dashscope_i2v_max_inline_image_bytes() -> int:
    """Wan i2v 可走 data URI；过大则仍可依赖公网 URL。"""
    return int(os.getenv("DASHSCOPE_I2V_MAX_INLINE_BYTES") or str(14 * 1024 * 1024))


def _dashscope_extract_uploads_basename(image_url: str) -> Optional[str]:
    raw = image_url.strip()
    if not raw:
        return None
    path = ""
    if raw.startswith("/"):
        path = unquote(raw.split("?", 1)[0].split("#", 1)[0])
    else:
        parsed = urlparse(raw)
        if parsed.scheme not in ("http", "https"):
            return None
        path = unquote((parsed.path or "").split("?", 1)[0].split("#", 1)[0])
    if not path.startswith("/uploads/"):
        return None
    base = os.path.basename(path.rstrip("/"))
    if not base or base in (".", ".."):
        return None
    return base


def _dashscope_infer_image_mime(raw: bytes, filename_hint: str) -> str:
    mime_guess, _ = mimetypes.guess_type(filename_hint)
    if mime_guess and mime_guess.startswith("image/"):
        return mime_guess
    if len(raw) >= 8 and raw[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if len(raw) >= 3 and raw[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if len(raw) >= 12 and raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return "image/webp"
    if len(raw) >= 6 and raw[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    return "image/jpeg"


def _dashscope_prepare_i2v_image_url(
    image_url: str,
    *,
    upload_dir: Optional[str] = None,
) -> str:
    """若 URL 指向本仓库 storage/uploads，则把图片打成 data:image/…;base64，供 DashScope 拉取。"""
    raw = image_url.strip()
    if not raw:
        return raw
    if raw.startswith("data:image/"):
        return raw
    basename = _dashscope_extract_uploads_basename(raw)
    if not basename:
        return raw

    udir = upload_dir if upload_dir is not None else UPLOAD_DIR
    local_fp = os.path.join(udir, basename)
    if not os.path.isfile(local_fp):
        return raw

    try:
        sz = os.path.getsize(local_fp)
        mx = _dashscope_i2v_max_inline_image_bytes()
        if sz > mx:
            logger.error(
                "[DashScope/Wan-i2v] 参考图过大 (%sMB > %sMB)，请压缩图片或配置 CDN/公网上传后再试",
                sz // (1024 * 1024),
                mx // (1024 * 1024),
            )
            return raw
        with open(local_fp, "rb") as f:
            blob = f.read()
        mime = _dashscope_infer_image_mime(blob, basename)
        b64 = base64.b64encode(blob).decode("ascii")
        data_uri = f"data:{mime};base64,{b64}"
        logger.info("[DashScope/Wan-i2v] 使用 data URI 内联本地上传 basename=%s", basename)
        return data_uri
    except OSError as e:
        logger.warning("[DashScope/Wan-i2v] 读取本地上传失败: %s", e)
        return raw


def _prepare_local_image_for_provider(image_url: str) -> str:
    """将本地 storage/outputs 或 storage/uploads 的图片转换为 base64 data URI，
    供各视频供应商（DashScope、Doubao、ZhipuAI）直接使用。
    若传入的已是公网 URL 或 data URI，则原样返回。
    """
    raw = image_url.strip() if image_url else ""
    if not raw or raw.startswith("data:image/"):
        return raw

    from tools.media_common import OUTPUT_DIR, UPLOAD_DIR, PROJECT_ROOT

    candidate: Optional[str] = None

    # 绝对路径直接使用
    if os.path.isabs(raw) and os.path.isfile(raw):
        candidate = raw
    else:
        # 匹配 storage/outputs/<filename> 或 storage/uploads/<filename>
        m = re.search(r"storage[/\\](outputs|uploads)[/\\]([\w\-\.]+)", raw)
        if m:
            subdir = "outputs" if m.group(1) == "outputs" else "uploads"
            base_dir = OUTPUT_DIR if subdir == "outputs" else UPLOAD_DIR
            candidate = os.path.join(base_dir, m.group(2))

    if not candidate or not os.path.isfile(candidate):
        return raw

    # 限制内联大小：20 MB
    max_bytes = 20 * 1024 * 1024
    try:
        sz = os.path.getsize(candidate)
        if sz > max_bytes:
            logger.warning("[ImagePrep] 图片过大 (%sMB)，跳过内联 base64: %s", sz // (1024 * 1024), candidate)
            return raw
        with open(candidate, "rb") as f:
            blob = f.read()
        mime = _dashscope_infer_image_mime(blob, os.path.basename(candidate))
        b64 = base64.b64encode(blob).decode("ascii")
        logger.info("[ImagePrep] 已将本地图片内联为 data URI: %s", os.path.basename(candidate))
        return f"data:{mime};base64,{b64}"
    except OSError as e:
        logger.warning("[ImagePrep] 读取本地图片失败: %s", e)
        return raw


def _dashscope_resolve_i2v_model(model_id: str) -> str:
    """文生视频模型选中时，自动映射到对应的图生视频模型。"""
    mid = (model_id or "").strip()
    if _is_happyhorse_model(mid):
        if "i2v" in mid.lower():
            return mid
        return "happyhorse-1.0-i2v"
    default_i2v = (os.getenv("DASHSCOPE_I2V_MODEL") or "").strip() or "wan2.6-i2v-flash"
    if mid and "i2v" not in mid.lower() and "t2v" in mid.lower():
        return default_i2v
    return mid or default_i2v


def _dashscope_i2v_video_request_body(image_url: str, prompt: str, model_id: str) -> Dict:
    """DashScope 图生视频：HappyHorse 用 media.first_frame；万影用 img_url。"""
    mid = _dashscope_resolve_i2v_model(model_id)
    pr = prompt.strip() or "主体自然动起来，轻快搞笑，简短运镜。"
    if _is_happyhorse_model(mid):
        return {
            "model": mid,
            "input": {
                "prompt": pr,
                "media": [{"type": "first_frame", "url": image_url}],
            },
            "parameters": {
                "resolution": "720P",
                "duration": 5,
                "watermark": False,
            },
        }
    return {
        "model": mid,
        "input": {"prompt": pr, "img_url": image_url},
        "parameters": {
            "resolution": "720P",
            "prompt_extend": True,
            "duration": 5,
            "watermark": False,
            "shot_type": "multi",
        },
    }


def _dashscope_generate_video_from_image(image_url: str, prompt: str = "", model_id: str = "") -> Dict:
    """通义 DashScope 图生视频；勿用 Zhipu 客户端调用通义 Key。"""
    resolved = _dashscope_resolve_i2v_model(model_id)
    if (model_id or "").strip() and resolved != (model_id or "").strip():
        logger.info("[DashScope/i2v] 文生视频模型映射到 i2v: %s -> %s", model_id, resolved)
    mid = resolved

    effective_img = _dashscope_prepare_i2v_image_url(image_url)
    log_img = effective_img[:120] + ("..." if len(effective_img) > 120 else "")
    label = "HappyHorse-i2v" if _is_happyhorse_model(mid) else "Wan-i2v"
    logger.info("[DashScope/%s] img=%s model=%s", label, log_img, mid)
    submit = dashscope_submit_async(
        "services/aigc/video-generation/video-synthesis",
        _dashscope_i2v_video_request_body(effective_img, prompt, mid),
    )
    if not submit.get("ok"):
        return {"success": False, "error": submit.get("error", "unknown")}

    task_id = submit["task_id"]
    wait = dashscope_wait_task(task_id, label="wan-i2v", interval=5.0, max_wait=1200)
    if not wait.get("ok"):
        return {"success": False, "error": wait.get("error", "unknown")}

    out = wait.get("output") or {}
    video_url = (out.get("video_url") or "").strip()
    if not video_url:
        return {
            "success": False,
            "error": f"未返回 video_url: {json.dumps(out, ensure_ascii=False)[:400]}",
        }
    local_path = download_file(video_url, ".mp4", "video")
    return {
        "success": True,
        "url": video_url,
        "local_path": local_path,
        "provider": "alibaba",
        "model": mid,
    }


# ============== 智谱视频任务轮询 ==============

def _wait_for_video_task(client: Any, task_id: str, prompt: str, model_name: str = "cogvideox") -> str:
    """等待视频任务完成的通用函数"""
    deadline = time.monotonic() + ZHIPU_VIDEO_MAX_WAIT
    attempt = 0
    while time.monotonic() < deadline:
        attempt += 1
        time.sleep(ZHIPU_VIDEO_POLL_INTERVAL)
        result_obj = client.videos.retrieve_videos_result(id=task_id)

        status = getattr(result_obj, "task_status", None)
        if not status and isinstance(result_obj, dict):
            status = result_obj.get("task_status")

        if status == "SUCCESS":
            video_result = getattr(result_obj, "video_result", [])
            if not video_result and isinstance(result_obj, dict):
                video_result = result_obj.get("video_result", [])

            url = ""
            if video_result:
                if isinstance(video_result, list):
                    url = video_result[0].get("url") if isinstance(video_result[0], dict) else getattr(video_result[0], "url", "")
                else:
                    url = video_result.url

            logger.info(f"Video generated successfully: {url}")

            try:
                save_generation_to_memory(prompt, url, "video")
            except Exception as mem_err:
                logger.warning(f"Failed to save to memory (non-critical): {mem_err}")

            local_path = download_file(url, ".mp4", "video")
            model_info = f"\n**Model:** {model_name}"

            if local_path:
                display_path = f"./storage/outputs/{os.path.basename(local_path)}"
                try:
                    add_generation_record("video", prompt, local_path, {"url": url, "provider": "zhipu", "model": model_name})
                except Exception as hist_err:
                    logger.warning(f"Failed to save generation history (non-critical): {hist_err}")
                return f"✅ 视频生成成功！\n\n**供应商:** 智谱 AI{model_info}\n**URL:** {url}\n\n**本地路径:** {display_path}\n\n**直接显示:** {local_path}"

            return f"✅ 视频生成成功！\n\n**供应商:** 智谱 AI{model_info}\n**URL:** {url}"

        elif status == "FAIL":
            logger.error(f"Video task failed. Task ID: {task_id}")
            return f"❌ 视频生成失败: {str(result_obj)}"

        if attempt % 6 == 0:
            logger.info(f"⏳ 等待视频任务 {task_id}... 状态: {status}")

    logger.error(f"Video task timed out. Task ID: {task_id}")
    return "❌ 视频生成超时，请重试或稍后尝试。"


# ============== 统一视频生成入口 ==============

@tool
def generate_video(prompt: str) -> str:
    """
    根据文本描述生成视频。
    输入应该是一段描述性的文本，例如 '海浪拍打沙滩，夕阳西下'。
    视频生成需要较长时间，请耐心等待。
    返回生成的视频 URL 和本地保存路径。
    """
    from core.media_models import get_current_media_model

    # 从媒体模型注册表获取用户选中的视频模型
    selected = get_current_media_model("video")
    api_type = selected.get("api_type", "none")
    provider_name = selected.get("provider", "unknown")
    model_id = selected.get("model_id", "")
    model_name = selected.get("name", model_id)

    try:
        from services.taste_art_direction import enrich_video_prompt, is_taste_art_direction_enabled

        if is_taste_art_direction_enabled():
            prompt = enrich_video_prompt(prompt)
    except Exception as taste_exc:
        logger.warning("[VideoGen] taste enrich skipped: %s", taste_exc)

    logger.info(f"[VideoGen] model={selected['id']}, api_type={api_type}, prompt={prompt[:80]}")

    if not selected.get("available", False):
        return f"❌ 选中的视频模型 [{model_name}] 不可用 (API Key 未配置)。请在设置中切换到可用的模型。"

    try:
        if api_type == "doubao_native":
            # 豆包 Ark (SeaDance) 视频生成
            result = _doubao_generate_video(prompt=prompt)
            if not result.get("success"):
                return f"❌ 豆包视频生成失败: {result.get('error', 'unknown')}"
            local_path = result.get("local_path", "")
            video_url = result.get("url", "")
            if local_path:
                display_path = f"./storage/outputs/{os.path.basename(local_path)}"
                try:
                    add_generation_record("video", prompt, local_path, {"url": video_url, "provider": "doubao", "model": model_name})
                except Exception as hist_err:
                    logger.warning(f"Failed to save generation history: {hist_err}")
                return f"✅ 视频生成成功！\n\n**供应商:** 豆包 (Doubao)\n**Model:** {model_name}\n**URL:** {video_url}\n\n**本地路径:** {display_path}\n\n**直接显示:** {local_path}"
            return f"✅ 视频生成成功！\n\n**供应商:** 豆包 (Doubao)\n**Model:** {model_name}\n**URL:** {video_url}"

        elif api_type == "dashscope_wan_video":
            result = _dashscope_generate_video(prompt, model_id)
            if not result.get("success"):
                family = _dashscope_video_provider_label(model_id)
                return f"❌ {family} 视频生成失败: {result.get('error', 'unknown')}"
            local_path = result.get("local_path", "")
            video_url = result.get("url", "")
            family = _dashscope_video_provider_label(model_id)
            if local_path:
                display_path = f"./storage/outputs/{os.path.basename(local_path)}"
                try:
                    add_generation_record("video", prompt, local_path, {"url": video_url, "provider": "dashscope", "model": model_name})
                except Exception as hist_err:
                    logger.warning(f"Failed to save generation history: {hist_err}")
                return (
                    f"✅ 视频生成成功！\n\n**供应商:** 阿里通义 (DashScope) · {family}\n**Model:** {model_name}\n"
                    f"**URL:** {video_url}\n\n**本地路径:** {display_path}\n\n**直接显示:** {local_path}"
                )
            return f"✅ 视频生成成功！\n\n**供应商:** 阿里通义 (DashScope) · {family}\n**Model:** {model_name}\n**URL:** {video_url}"

        elif api_type == "openrouter":
            # OpenRouter 视频生成 — 参考 SDK: /chat/completions + modalities
            api_key = _get_provider_api_key("openrouter")
            logger.info(f"🎬 Generating Video via OpenRouter with Model: {model_id}")

            resp = requests.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                    "HTTP-Referer": "https://github.com/phuhao00/ai-media-agent",
                    "X-Title": "AI Media Agent"
                },
                json={
                    "model": model_id,
                    "messages": [{"role": "user", "content": prompt}],
                    "modalities": ["video"],
                    "max_tokens": 4096,
                },
                timeout=300,
            )
            try:
                resp.raise_for_status()
            except requests.exceptions.HTTPError as e:
                err_msg = e.response.text if e.response and e.response.text else str(e)
                error_context = f"OpenRouter API Error {e.response.status_code if e.response else 'Unknown'}: {err_msg}"
                logger.error(error_context)
                raise ValueError(error_context)
            data = resp.json()

            choices = data.get("choices", [])
            if not choices:
                raise ValueError(f"No choices in OpenRouter response: {json.dumps(data)[:300]}")

            message = choices[0].get("message", {})

            # 检查 message.videos (类似 SDK 中 images 的模式)
            videos = message.get("videos", [])
            if videos:
                video_data_url = videos[0].get("video_url", {}).get("url", "")
                if video_data_url.startswith("data:video"):
                    # base64 视频数据, 保存到本地
                    import base64 as b64
                    header, b64_data = video_data_url.split(",", 1)
                    ext = ".mp4"
                    if "webm" in header:
                        ext = ".webm"
                    filename = f"video_{int(time.time())}{ext}"
                    from tools.media_common import OUTPUT_DIR
                    local_path = os.path.join(OUTPUT_DIR, filename)
                    with open(local_path, "wb") as f:
                        f.write(b64.b64decode(b64_data))
                    display_path = f"./storage/outputs/{filename}"
                    try:
                        add_generation_record("video", prompt, local_path, {"provider": "openrouter", "model": model_name})
                    except Exception as hist_err:
                        logger.warning(f"Failed to save generation history: {hist_err}")
                    return f"✅ 视频生成成功！\n\n**供应商:** OpenRouter\n**Model:** {model_name}\n\n**本地路径:** {display_path}\n\n**直接显示:** {local_path}"
                else:
                    # URL
                    local_path = download_file(video_data_url, ".mp4", "video")
                    if local_path:
                        display_path = f"./storage/outputs/{os.path.basename(local_path)}"
                        try:
                            add_generation_record("video", prompt, local_path, {"url": video_data_url, "provider": "openrouter", "model": model_name})
                        except Exception as hist_err:
                            logger.warning(f"Failed to save generation history: {hist_err}")
                        return f"✅ 视频生成成功！\n\n**供应商:** OpenRouter\n**Model:** {model_name}\n**URL:** {video_data_url}\n\n**本地路径:** {display_path}\n\n**直接显示:** {local_path}"
                    return f"✅ 视频生成成功！\n\n**供应商:** OpenRouter\n**Model:** {model_name}\n**URL:** {video_data_url}"

            # Fallback: 检查 content 中的 URL
            content = message.get("content", "")
            url = ""
            md_match = re.search(r'\[.*?\]\((https?://[^)]+)\)', content)
            if md_match:
                url = md_match.group(1)
            else:
                url_match = re.search(r'(https?://[^\s)\]]+)', content)
                if url_match:
                    url = url_match.group(0)

            if url:
                local_path = download_file(url, ".mp4", "video")
                if local_path:
                    display_path = f"./storage/outputs/{os.path.basename(local_path)}"
                    try:
                        add_generation_record("video", prompt, local_path, {"url": url, "provider": "openrouter", "model": model_name})
                    except Exception as hist_err:
                        logger.warning(f"Failed to save generation history: {hist_err}")
                    return f"✅ 视频生成成功！\n\n**供应商:** OpenRouter\n**Model:** {model_name}\n**URL:** {url}\n\n**本地路径:** {display_path}\n\n**直接显示:** {local_path}"
                return f"✅ 视频生成成功！\n\n**供应商:** OpenRouter\n**Model:** {model_name}\n**URL:** {url}"

            raise ValueError(f"No video data found in response: {content[:200]}...")

        else:
            # 智谱 AI: CogVideoX
            api_key = _get_provider_api_key("zhipu")
            client = create_zhipu_client(api_key)
            response = client.videos.generations(
                model=model_id or "cogvideox",
                prompt=prompt
            )
            task_id = response.id
            logger.info(f"Video task submitted (zhipu, model={model_name}). Task ID: {task_id}")
            return _wait_for_video_task(client, task_id, prompt, model_name)

    except Exception as e:
        error_msg = f"Failed to generate video ({provider_name}): {str(e)}"
        logger.error(error_msg, exc_info=True)
        return f"❌ 视频生成失败 ({model_name}): {str(e)}"


# ============== 图生视频 ==============

def generate_video_from_image_internal(image_url: str, prompt: str = "") -> str:
    """图生视频内部函数（非Tool，供API直接调用）"""
    provider, is_fallback = _resolve_provider("video")
    fb_tag = f" (备选:{provider})" if is_fallback else ""
    try:
        from services.taste_art_direction import enrich_video_prompt, is_taste_art_direction_enabled

        if is_taste_art_direction_enabled():
            prompt = enrich_video_prompt(prompt, ref_image_context=image_url)
    except Exception as taste_exc:
        logger.warning("[VideoGen] taste enrich i2v skipped: %s", taste_exc)

    logger.info(f"Generating video from image ({provider}, fallback={is_fallback}): {image_url}, prompt: {prompt}")

    # 将本地 storage/outputs 或 storage/uploads 路径转为 base64 data URI，
    # 使各供应商能直接接收本地生成的分镜图片作为参考帧
    effective_image_url = _prepare_local_image_for_provider(image_url)
    if effective_image_url != image_url:
        logger.info("[ImagePrep] 图片已转换为 data URI，长度: %d bytes", len(effective_image_url))

    if not _check_provider_capability(provider, "video"):
        return "❌ 没有可用的视频生成供应商。请配置 DASHSCOPE_API_KEY / ALIBABA_API_KEY、ZHIPUAI_API_KEY、BYTEDANCE_API_KEY 之一。"

    api_key = _get_provider_api_key(provider)
    if not api_key:
        return f"❌ 供应商 [{provider}] 的 API Key 未设置，无法图生视频。"

    try:
        if provider == "doubao":
            result = _doubao_generate_video(prompt=prompt, image_url=effective_image_url)
            if not result.get("success"):
                return f"❌ 豆包图生视频失败{fb_tag}: {result.get('error', 'unknown')}"
            local_path = result.get("local_path", "")
            if local_path:
                display_path = f"./storage/outputs/{os.path.basename(local_path)}"
                return f"✅ 图生视频成功！{fb_tag}\n\n**供应商:** 豆包 (Doubao)\n**本地路径:** {display_path}\n\n**直接显示:** {local_path}"
            return "❌ 豆包返回成功但没有视频 URL"

        # 阿里云通义万相（DashScope）：必须使用异步 video-synthesis + i2v 模型，禁止用 Zhipu 客户端带通义 Key
        if provider == "alibaba":
            from core.media_models import get_current_media_model

            sel = get_current_media_model("video")
            mid = ""
            if sel.get("provider") == "alibaba" and sel.get("api_type") == "dashscope_wan_video":
                mid = (sel.get("model_id") or "").strip()

            result = _dashscope_generate_video_from_image(effective_image_url, prompt, mid)
            if not result.get("success"):
                return (
                    f"❌ 通义图生视频失败{fb_tag}: {result.get('error', 'unknown')}\n"
                    "提示：本地上传的参考图应自动内联发送；若为外链请确保可公网访问，或改用先上传再走图生视频。"
                )
            local_path = result.get("local_path", "")
            video_u = result.get("url", "")
            model_used = result.get("model", "wan-i2v")
            family = _dashscope_video_provider_label(model_used)
            if local_path:
                display_path = f"./storage/outputs/{os.path.basename(local_path)}"
                try:
                    add_generation_record(
                        "video",
                        prompt or f"图生视频: {image_url[:120]}",
                        local_path,
                        {"url": video_u, "provider": "dashscope", "model": model_used},
                    )
                except Exception as hist_err:
                    logger.warning("Failed to save generation history (non-critical): %s", hist_err)
                return (
                    f"✅ 图生视频成功！{fb_tag}\n\n**供应商:** 阿里通义 (DashScope) · {family}\n**Model:** {model_used}\n"
                    f"**URL:** {video_u}\n\n**本地路径:** {display_path}\n\n**直接显示:** {local_path}"
                )
            return f"✅ 图生视频成功！{fb_tag}\n\n**供应商:** 阿里通义 (DashScope) · {family}\n**URL:** {video_u}"

        if provider == "zhipu":
            client = create_zhipu_client(api_key)
            params = {"model": "cogvideox", "image_url": effective_image_url}
            if prompt:
                params["prompt"] = prompt

            response = client.videos.generations(**params)
            task_id = response.id
            logger.info(f"Image-to-video task submitted ({provider}{fb_tag}). Task ID: {task_id}")
            return _wait_for_video_task(client, task_id, prompt or f"从图片生成: {image_url}")

        return (
            f"❌ 当前视频供应商 [{provider}] 暂不支持程序化图生视频{fb_tag}。\n"
            "请切换为通义（DashScope）视频模型并配置 DASHSCOPE_API_KEY，或使用豆包/智谱。"
        )

    except Exception as e:
        error_msg = f"Failed to generate video from image ({provider}): {str(e)}"
        logger.error(error_msg, exc_info=True)
        return f"❌ 图生视频失败 ({provider}): {str(e)}"


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


# ============== 内部视频生成函数（结构化返回） ==============

def generate_video_internal(prompt: str) -> Dict:
    """内部视频生成函数，使用完整的统一媒体模型获取策略返回结构化结果"""
    from core.media_models import get_current_media_model
    selected = get_current_media_model("video")
    api_type = selected.get("api_type", "none")
    provider_name = selected.get("provider", "unknown")
    model_name = selected.get("name", "unknown")

    try:
        from services.taste_art_direction import enrich_video_prompt, is_taste_art_direction_enabled

        if is_taste_art_direction_enabled():
            prompt = enrich_video_prompt(prompt)
    except Exception as taste_exc:
        logger.warning("[VideoGen] taste enrich internal skipped: %s", taste_exc)

    logger.info(f"generate_video_internal: provider={provider_name}, api_type={api_type}")

    if not selected.get("available", False):
        return {"success": False, "error": f"选中的视频模型 [{model_name}] 不可用。请在设置中检查对应的 API Key。"}

    try:
        if api_type == "doubao_native":
            res = _doubao_generate_video(prompt=prompt)
            if res.get("success"):
                res["provider"] = "doubao"
                res["is_fallback"] = False
            return res
            
        elif api_type == "zhipu_native":
            api_key = _get_provider_api_key("zhipu")
            if not api_key:
                return {"success": False, "error": "智谱 API Key 未设置"}

            client = create_zhipu_client(api_key)
            response = client.videos.generations(model="cogvideox", prompt=prompt)
            task_id = response.id
            logger.info(f"Video generation task created (zhipu_native): {task_id}")

            deadline = time.monotonic() + ZHIPU_VIDEO_MAX_WAIT
            while time.monotonic() < deadline:
                time.sleep(ZHIPU_INTERNAL_VIDEO_POLL_INTERVAL)
                result = client.videos.retrieve_videos_result(id=task_id)

                if result.task_status == "SUCCESS":
                    video_url = result.video_result[0].url
                    local_path = download_file(video_url, ".mp4", "video")
                    return {
                        "success": True,
                        "url": video_url,
                        "local_path": local_path,
                        "provider": "zhipu",
                        "is_fallback": False,
                    }
                elif result.task_status == "FAIL":
                    return {"success": False, "error": "视频生成失败"}

            return {"success": False, "error": "生成超时"}

        elif api_type == "dashscope_wan_video":
            res = _dashscope_generate_video(prompt, selected.get("model_id", ""))
            if res.get("success"):
                res["is_fallback"] = False
            return res
            
        else:
            return {"success": False, "error": f"暂不支持的内置视频 API 类型: {api_type}"}
            
    except Exception as e:
        logger.error(f"Video generation error ({api_type}): {e}")
        return {"success": False, "error": str(e)}


# ============== HappyHorse 专用视频生成（固定模型，不依赖媒体模型选择） ==============

HAPPYHORSE_T2V_MODEL = "happyhorse-1.0-t2v"
HAPPYHORSE_I2V_MODEL = "happyhorse-1.0-i2v"
HAPPYHORSE_RATIOS = {"16:9", "9:16", "1:1", "4:3", "3:4", "4:5", "5:4", "9:21", "21:9"}


def _normalize_happyhorse_resolution(value: str) -> str:
    raw = (value or "720P").strip().upper().replace("P", "P")
    if raw in ("720", "720P"):
        return "720P"
    if raw in ("1080", "1080P"):
        return "1080P"
    return "720P"


def _normalize_happyhorse_duration(value: int) -> int:
    try:
        n = int(value)
    except (TypeError, ValueError):
        return 5
    return max(3, min(n, 15))


def _happyhorse_t2v_request_body(
    prompt: str,
    *,
    duration: int = 5,
    resolution: str = "720P",
    ratio: str = "16:9",
    watermark: bool = False,
    seed: Optional[int] = None,
) -> Dict:
    params: Dict = {
        "resolution": _normalize_happyhorse_resolution(resolution),
        "ratio": ratio if ratio in HAPPYHORSE_RATIOS else "16:9",
        "duration": _normalize_happyhorse_duration(duration),
        "watermark": bool(watermark),
    }
    if seed is not None:
        params["seed"] = max(0, min(int(seed), 2147483647))
    return {
        "model": HAPPYHORSE_T2V_MODEL,
        "input": {"prompt": prompt},
        "parameters": params,
    }


def _happyhorse_i2v_request_body(
    image_url: str,
    prompt: str,
    *,
    duration: int = 5,
    resolution: str = "720P",
    watermark: bool = False,
    seed: Optional[int] = None,
) -> Dict:
    pr = prompt.strip() or "主体自然动起来，镜头平稳，细节清晰。"
    params: Dict = {
        "resolution": _normalize_happyhorse_resolution(resolution),
        "duration": _normalize_happyhorse_duration(duration),
        "watermark": bool(watermark),
    }
    if seed is not None:
        params["seed"] = max(0, min(int(seed), 2147483647))
    return {
        "model": HAPPYHORSE_I2V_MODEL,
        "input": {
            "prompt": pr,
            "media": [{"type": "first_frame", "url": image_url}],
        },
        "parameters": params,
    }


def generate_happyhorse_t2v_internal(
    prompt: str,
    *,
    duration: int = 5,
    resolution: str = "720P",
    ratio: str = "16:9",
    watermark: bool = False,
    seed: Optional[int] = None,
) -> Dict:
    """HappyHorse 文生视频专用入口，始终使用 happyhorse-1.0-t2v。"""
    pr = (prompt or "").strip()
    if not pr:
        return {"success": False, "error": "prompt 不能为空"}

    logger.info(
        "[HappyHorse/t2v] duration=%s resolution=%s ratio=%s prompt=%.80r",
        duration,
        resolution,
        ratio,
        pr,
    )
    submit = dashscope_submit_async(
        "services/aigc/video-generation/video-synthesis",
        _happyhorse_t2v_request_body(
            pr,
            duration=duration,
            resolution=resolution,
            ratio=ratio,
            watermark=watermark,
            seed=seed,
        ),
    )
    if not submit.get("ok"):
        return {"success": False, "error": submit.get("error", "unknown")}

    task_id = submit["task_id"]
    wait = dashscope_wait_task(task_id, label="happyhorse-t2v", interval=8.0, max_wait=1200)
    if not wait.get("ok"):
        return {"success": False, "error": wait.get("error", "unknown")}

    out = wait.get("output") or {}
    video_url = (out.get("video_url") or "").strip()
    if not video_url:
        return {
            "success": False,
            "error": f"未返回 video_url: {json.dumps(out, ensure_ascii=False)[:400]}",
        }

    local_path = download_file(video_url, ".mp4", "video")
    return {
        "success": True,
        "url": video_url,
        "local_path": local_path,
        "provider": "alibaba",
        "model": HAPPYHORSE_T2V_MODEL,
        "family": "happyhorse",
    }


def generate_happyhorse_i2v_internal(
    image_url: str,
    prompt: str = "",
    *,
    duration: int = 5,
    resolution: str = "720P",
    watermark: bool = False,
    seed: Optional[int] = None,
) -> Dict:
    """HappyHorse 图生视频专用入口，始终使用 happyhorse-1.0-i2v。"""
    if not (image_url or "").strip():
        return {"success": False, "error": "image_url 不能为空"}

    effective_img = _dashscope_prepare_i2v_image_url(image_url)
    logger.info(
        "[HappyHorse/i2v] duration=%s resolution=%s model=%s",
        duration,
        resolution,
        HAPPYHORSE_I2V_MODEL,
    )
    submit = dashscope_submit_async(
        "services/aigc/video-generation/video-synthesis",
        _happyhorse_i2v_request_body(
            effective_img,
            prompt,
            duration=duration,
            resolution=resolution,
            watermark=watermark,
            seed=seed,
        ),
    )
    if not submit.get("ok"):
        return {"success": False, "error": submit.get("error", "unknown")}

    task_id = submit["task_id"]
    wait = dashscope_wait_task(task_id, label="happyhorse-i2v", interval=8.0, max_wait=1200)
    if not wait.get("ok"):
        return {"success": False, "error": wait.get("error", "unknown")}

    out = wait.get("output") or {}
    video_url = (out.get("video_url") or "").strip()
    if not video_url:
        return {
            "success": False,
            "error": f"未返回 video_url: {json.dumps(out, ensure_ascii=False)[:400]}",
        }

    local_path = download_file(video_url, ".mp4", "video")
    return {
        "success": True,
        "url": video_url,
        "local_path": local_path,
        "provider": "alibaba",
        "model": HAPPYHORSE_I2V_MODEL,
        "family": "happyhorse",
    }
