"""
图片生成工具 — 独立模块
支持供应商: OpenRouter, OpenAI, 智谱, 即梦, Google
"""
import os
import re
import json
import requests
from typing import Dict, Any
from langchain.tools import tool
from openai import OpenAI as OpenAIClient
from utils.logger import setup_logger

from tools.media_common import (
    _resolve_provider, _check_provider_capability, _get_provider_api_key,
    _get_provider_base_url, get_client,
    download_file, save_base64_image,
    OPENROUTER_IMAGE_MODEL, OUTPUT_DIR,
    jimeng_call,
    dashscope_submit_async, dashscope_wait_task,
)
from tools.memory_tools import save_generation_to_memory

logger = setup_logger("image_tools")


def _dashscope_image_uses_new_image_generation_api(model_id: str) -> bool:
    """万相新版文生图：image-generation/generation，结果为 choices[].message.content[].image"""
    if not model_id:
        return False
    if model_id.startswith("wan2.6-t2i"):
        return True
    if model_id.startswith("wan2.7-image"):
        return True
    return False


def _dashscope_legacy_text2image_body(prompt: str, model_id: str) -> Dict[str, Any]:
    """旧版 text2image/image-synthesis：wan2.5 及以下、wan2.2、wanx2.1、wanx-v1 等"""
    inp: Dict[str, Any] = {"prompt": prompt}
    params: Dict[str, Any] = {"n": 1}
    if model_id == "wanx-v1":
        params["style"] = "<auto>"
        params["size"] = "1024*1024"
    elif model_id.startswith("wan2.5"):
        params["size"] = "1280*1280"
    elif model_id.startswith("wan2.2") or model_id.startswith("wanx2.1"):
        params["size"] = "1024*1024"
    else:
        params["size"] = "1024*1024"
    return {"model": model_id, "input": inp, "parameters": params}


def _dashscope_new_image_generation_body(prompt: str, model_id: str) -> Dict[str, Any]:
    """新版 image-generation/generation：wan2.6-t2i、wan2.7-image*"""
    params: Dict[str, Any] = {
        "prompt_extend": True,
        "watermark": False,
        "n": 1,
        "negative_prompt": "",
    }
    if model_id.startswith("wan2.7-image"):
        params["size"] = "2K"
        params["thinking_mode"] = True
    else:
        params["size"] = "1280*1280"
    return {
        "model": model_id,
        "input": {
            "messages": [
                {
                    "role": "user",
                    "content": [{"text": prompt}],
                }
            ]
        },
        "parameters": params,
    }


def _dashscope_extract_image_url_from_output(out: Dict[str, Any]) -> str:
    for item in out.get("results") or []:
        if isinstance(item, dict) and item.get("url"):
            return str(item["url"])
    for choice in out.get("choices") or []:
        msg = choice.get("message") or {}
        for part in msg.get("content") or []:
            if isinstance(part, dict) and part.get("image"):
                u = part["image"]
                if isinstance(u, str) and u.startswith("http"):
                    return u
    return ""


# ============== 即梦图片生成 ==============

def _jimeng_generate_image(prompt: str) -> Dict:
    """即梦 AI 图片生成 4.0"""
    logger.info(f"[Jimeng] 图片生成: {prompt[:60]}...")

    model_name = "jimeng_high_aes_general_v21"
    body = {
        "req_key": model_name,
        "prompt": prompt,
        "width": 1024,
        "height": 1024,
        "seed": -1,
        "return_url": True,
        "logo_info": {"add_logo": False}
    }

    try:
        resp = jimeng_call("CVProcess", body)
        if resp.get("code") != 10000:
            return {"success": False, "error": f"即梦图片生成失败: {resp.get('message', resp)}"}

        data = resp.get("data", {})
        image_urls = data.get("image_urls", [])

        if image_urls:
            url = image_urls[0]
            local_path = download_file(url, ".png", "image")
            return {"success": True, "url": url, "local_path": local_path, "model": model_name}

        return {"success": False, "error": "即梦未返回图片数据"}
    except Exception as e:
        logger.error(f"[Jimeng] 图片生成异常: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


# ============== 统一图片生成入口 ==============

@tool
def generate_image(prompt: str) -> str:
    """
    根据文本描述生成图片。
    输入应该是一段描述性的文本，例如 '一只在太空弹吉他的猫'。
    返回生成的图片 URL 和本地保存路径。
    """
    from core.media_models import get_current_media_model

    # 从媒体模型注册表获取用户选中的图片模型
    selected = get_current_media_model("image")
    api_type = selected.get("api_type", "none")
    provider_name = selected.get("provider", "unknown")
    model_id = selected.get("model_id", "")
    model_name = selected.get("name", model_id)

    try:
        from services.taste_art_direction import enrich_image_prompt, is_taste_art_direction_enabled

        if is_taste_art_direction_enabled():
            prompt = enrich_image_prompt(prompt)
    except Exception as taste_exc:
        logger.warning("[ImageGen] taste enrich skipped: %s", taste_exc)

    logger.info(f"[ImageGen] model={selected['id']}, api_type={api_type}, prompt={prompt[:80]}")

    if not selected.get("available", False):
        return f"❌ 选中的图片模型 [{model_name}] 不可用 (API Key 未配置)。请在设置中切换到可用的模型。"

    try:
        url = ""
        local_path = ""
        model_used = model_name

        if api_type == "openrouter":
            # OpenRouter: /chat/completions + modalities (参考 SDK)
            api_key = _get_provider_api_key("openrouter")
            logger.info(f"🎨 Generating Image via OpenRouter with Model: {model_id}")

            resp = requests.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model_id,
                    "messages": [{"role": "user", "content": prompt}],
                    "modalities": ["image", "text"],
                    "max_tokens": 4096,
                },
                timeout=120,
            )
            resp.raise_for_status()
            data = resp.json()

            choices = data.get("choices", [])
            if not choices:
                return f"❌ OpenRouter 图片生成失败: 没有返回结果。\n\n原始响应: {json.dumps(data, ensure_ascii=False)[:500]}"

            message = choices[0].get("message", {})
            images = message.get("images", [])
            content = message.get("content", "")

            if images:
                img_data_url = images[0].get("image_url", {}).get("url", "")
                if img_data_url.startswith("data:image"):
                    local_path = save_base64_image(img_data_url, prompt)
                    url = img_data_url[:80] + "...(base64)"
                else:
                    url = img_data_url
            elif content and "data:image" in content:
                match = re.search(r'data:image/[^;]+;base64,[A-Za-z0-9+/=]+', content)
                if match:
                    img_data_url = match.group(0)
                    local_path = save_base64_image(img_data_url, prompt)
                    url = img_data_url[:80] + "...(base64)"

            if not local_path and content:
                md_match = re.search(r'!\[.*?\]\((https?://[^)]+)\)', content)
                if md_match:
                    url = md_match.group(1)
                else:
                    url_match = re.search(r'(https?://[^\s)\]]+\.(?:png|jpg|jpeg|webp|gif))', content, re.IGNORECASE)
                    if url_match:
                        url = url_match.group(1)

            if not url and not local_path:
                return f"❌ OpenRouter 图片生成失败: 无法从响应中提取图片。\n\n内容预览: {content[:300] if content else '(空)'}"

            logger.info(f"Image generated successfully (OpenRouter): local={local_path}, model={model_used}")

        elif api_type == "openai_native":
            api_key = _get_provider_api_key("openai")
            client = OpenAIClient(
                api_key=api_key,
                base_url=_get_provider_base_url("openai"),
            )
            response = client.images.generate(
                model=model_id or "dall-e-3",
                prompt=prompt,
                size="1024x1024",
                quality="standard",
                n=1,
            )
            url = response.data[0].url
            logger.info(f"Image generated successfully (OpenAI): {url}")

        elif api_type == "zhipu_native":
            client = get_client()
            if not client:
                return "❌ ZhipuAI 客户端初始化失败，请检查 ZHIPUAI_API_KEY。"
            response = client.images.generations(
                model=model_id or "cogview-3-plus",
                prompt=prompt,
            )
            url = response.data[0].url
            logger.info(f"Image generated successfully (Zhipu): {url}")

        elif api_type == "jimeng_native":
            result = _jimeng_generate_image(prompt)
            if not result.get("success"):
                return f"❌ 即梦图片生成失败: {result.get('error', 'unknown')}"
            url = result.get("url", "")
            local_path = result.get("local_path", "")
            logger.info(f"Image generated successfully (Jimeng): local={local_path}")

        elif api_type == "google_native":
            # Google Gemini 原生图片生成 (REST API)
            api_key = _get_provider_api_key("google")
            logger.info(f"🎨 Generating Image via Google Gemini with Model: {model_id}")

            api_url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_id}:generateContent"
            resp = requests.post(
                api_url,
                headers={
                    "x-goog-api-key": api_key,
                    "Content-Type": "application/json",
                },
                json={
                    "contents": [{"parts": [{"text": prompt}]}],
                    "generationConfig": {"responseModalities": ["TEXT", "IMAGE"]},
                },
                timeout=120,
            )
            
            if resp.status_code == 429:
                return f"❌ Google Gemini API 频率限制 (429): 多半是免费额度已用完或请求太快。请稍后再试，或切换到其他供应商 (如智谱 AI)。"
            
            resp.raise_for_status()
            data = resp.json()

            candidates = data.get("candidates", [])
            if not candidates:
                return f"❌ Google Gemini 图片生成失败: 没有返回结果。\n\n原始响应: {json.dumps(data, ensure_ascii=False)[:500]}"

            parts = candidates[0].get("content", {}).get("parts", [])
            for part in parts:
                inline_data = part.get("inlineData")
                if inline_data:
                    mime_type = inline_data.get("mimeType", "image/png")
                    b64_data = inline_data.get("data", "")
                    if b64_data:
                        ext = ".png"
                        if "jpeg" in mime_type or "jpg" in mime_type:
                            ext = ".jpg"
                        elif "webp" in mime_type:
                            ext = ".webp"
                        data_url = f"data:{mime_type};base64,{b64_data}"
                        local_path = save_base64_image(data_url, prompt)
                        url = data_url[:80] + "...(base64)"
                        break

            if not local_path:
                # 尝试从 text parts 里提取 URL
                for part in parts:
                    text_content = part.get("text", "")
                    if text_content:
                        url_match = re.search(r'(https?://[^\s)\]]+\.(?:png|jpg|jpeg|webp|gif))', text_content, re.IGNORECASE)
                        if url_match:
                            url = url_match.group(1)
                            break

            if not url and not local_path:
                return f"❌ Google Gemini 图片生成失败: 无法从响应中提取图片。请检查当前模型 {model_id} 是否支持图片生成。\n\n内容: {json.dumps(parts[:2], ensure_ascii=False)[:300]}"

            logger.info(f"Image generated successfully (Google Gemini): local={local_path}, model={model_used}")

        elif api_type == "dashscope_wanx_image":
            mid = model_id or "wan2.6-t2i"
            if _dashscope_image_uses_new_image_generation_api(mid):
                submit = dashscope_submit_async(
                    "services/aigc/image-generation/generation",
                    _dashscope_new_image_generation_body(prompt, mid),
                )
                poll_interval = 4.0
                poll_max = 900
            else:
                submit = dashscope_submit_async(
                    "services/aigc/text2image/image-synthesis",
                    _dashscope_legacy_text2image_body(prompt, mid),
                )
                poll_interval = 2.0
                poll_max = 600

            if not submit.get("ok"):
                return f"❌ 通义万相图片任务创建失败: {submit.get('error', 'unknown')}"

            task_id = submit["task_id"]
            logger.info(f"[DashScope/Wanx] image task created: {task_id}, model={mid}")

            wait = dashscope_wait_task(
                task_id,
                label="wanx-image",
                interval=poll_interval,
                max_wait=poll_max,
            )
            if not wait.get("ok"):
                return f"❌ 通义万相图片生成失败: {wait.get('error', 'unknown')}"

            out = wait.get("output") or {}
            first_url = _dashscope_extract_image_url_from_output(out)

            if not first_url:
                return f"❌ 通义万相未返回图片 URL: {json.dumps(out, ensure_ascii=False)[:400]}"

            url = first_url
            local_path = download_file(url, ".png", "image")
            model_used = mid
            logger.info(f"Image generated successfully (DashScope Wanx): local={local_path}, model={model_used}")

        else:
            return f"❌ 不支持的图片生成类型: {api_type}"

        # 自动保存到记忆
        try:
            save_generation_to_memory(prompt, url if url else "(local)", "image")
        except Exception as mem_err:
            logger.warning(f"Failed to save to memory (non-critical): {mem_err}")

        # 下载到本地（如果还没保存）
        if not local_path and url and not url.endswith("(base64)"):
            local_path = download_file(url, ".jpg", "image")

        model_info = f"\n**Model:** {model_used}" if model_used else ""

        if local_path:
            display_path = f"./storage/outputs/{os.path.basename(local_path)}"
            return f"✅ 图片生成成功！\n\n**供应商:** {provider_name}{model_info}\n**本地路径:** {display_path}\n\n**直接显示:** {local_path}"

        return f"✅ 图片生成成功！\n\n**供应商:** {provider_name}{model_info}\n**URL:** {url}"

    except requests.exceptions.HTTPError as he:
        status_code = he.response.status_code if he.response is not None else "Unknown"
        if status_code == 429:
            return f"❌ API 频率限制 (429): 多半是由于 Google AI 免费层级的限流。建议切换到智谱 AI (ZhipuAI) 或降低请求频率。"
        error_msg = f"HTTP Error {status_code}: {str(he)}"
        logger.error(error_msg, exc_info=True)
        return f"❌ 图片生成失败 ({model_name}): {error_msg}"
    except Exception as e:
        error_msg = f"Failed to generate image ({model_name}): {str(e)}"
        logger.error(error_msg, exc_info=True)
        return f"❌ 图片生成失败 ({model_name}): {str(e)}"
