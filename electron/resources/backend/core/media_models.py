"""
媒体模型注册表 — 动态管理图片/视频/音频模型

功能:
1. 从 OpenRouter API 动态获取支持 image/video output 的模型
2. 合并本地 provider (即梦、智谱、OpenAI) 的模型
3. 支持用户选择当前使用的模型 (持久化到 JSON)
4. 按 modality 分组: image / video / audio

参考: @openrouter/ai-sdk-provider SDK
- 图片生成: POST /chat/completions + modalities: ["image", "text"]
- 视频生成: POST /chat/completions + modalities: ["video"] (当有模型时)
- 响应: choices[0].message.images[].image_url.url
"""
import os
import json
import time
import requests
from typing import Optional, Dict, List, Any
from utils.logger import setup_logger

logger = setup_logger("media_models")

# 配置文件路径
_CONFIG_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "storage")
_CONFIG_FILE = os.path.join(_CONFIG_DIR, "media_model_config.json")

# ============== 本地 Provider 模型 ==============
# 不走 OpenRouter, 走各自原生 API
LOCAL_MODELS: Dict[str, List[Dict[str, Any]]] = {
    "image": [
        {
            "id": "jimeng/image-v4",
            "name": "即梦图片 4.0",
            "provider": "jimeng",
            "model_id": "jimeng_high_aes_general_v21",
            "api_type": "jimeng_native",
            "description": "即梦 AI 高质量图片生成",
        },
        {
            "id": "zhipu/cogview-3-plus",
            "name": "CogView-3-Plus",
            "provider": "zhipu",
            "model_id": "cogview-3-plus",
            "api_type": "zhipu_native",
            "description": "智谱 CogView-3 旗舰版图片生成",
        },
        {
            "id": "zhipu/cogview-3",
            "name": "CogView-3",
            "provider": "zhipu",
            "model_id": "cogview-3",
            "api_type": "zhipu_native",
            "description": "智谱 CogView-3 基础版图片生成 (极速/低成本)",
        },
        {
            "id": "openai/dalle3",
            "name": "DALL-E 3",
            "provider": "openai",
            "model_id": "dall-e-3",
            "api_type": "openai_native",
            "description": "OpenAI DALL-E 3 图片生成",
        },
        {
            "id": "google/imagen-3.0-generate-001",
            "name": "Imagen 3 Standard",
            "provider": "google",
            "model_id": "imagen-3.0-generate-001",
            "api_type": "google_native",
            "description": "Google Imagen 3 高质量图片生成",
        },
        {
            "id": "google/imagen-3.0-fast-generate-001",
            "name": "Imagen 3 Fast",
            "provider": "google",
            "model_id": "imagen-3.0-fast-generate-001",
            "api_type": "google_native",
            "description": "Google Imagen 3 快速预览版",
        },
        # 通义万相文生图：按百炼文档当前代际能力排序（2.7 Pro > 2.7 标准 > 2.6 > 2.5 预览 > 2.2 Plus）
        {
            "id": "alibaba/wan2.7-image-pro",
            "name": "通义万相 2.7 图像生成 Pro（旗舰）",
            "provider": "alibaba",
            "model_id": "wan2.7-image-pro",
            "api_type": "dashscope_wanx_image",
            "description": "万相 2.7 旗舰，支持更高规格与思考模式（image-generation 异步）",
        },
        {
            "id": "alibaba/wan2.7-image",
            "name": "通义万相 2.7 图像生成 标准版",
            "provider": "alibaba",
            "model_id": "wan2.7-image",
            "api_type": "dashscope_wanx_image",
            "description": "万相 2.7 标准版，速度与质量平衡",
        },
        {
            "id": "alibaba/wan2.6-t2i",
            "name": "通义万相 2.6 文生图",
            "provider": "alibaba",
            "model_id": "wan2.6-t2i",
            "api_type": "dashscope_wanx_image",
            "description": "万相 2.6 文生图（新版 image-generation，支持智能扩写）",
        },
        {
            "id": "alibaba/wan2.5-t2i-preview",
            "name": "通义万相 2.5 文生图 Preview",
            "provider": "alibaba",
            "model_id": "wan2.5-t2i-preview",
            "api_type": "dashscope_wanx_image",
            "description": "万相 2.5 预览版，高分辨率与宽高比自由度（旧版 text2image 异步）",
        },
        {
            "id": "alibaba/wan2.2-t2i-plus",
            "name": "通义万相 2.2 文生图 Plus",
            "provider": "alibaba",
            "model_id": "wan2.2-t2i-plus",
            "api_type": "dashscope_wanx_image",
            "description": "万相 2.2 专业版文生图（旧版 text2image 异步）",
        },
    ],
    "image_edit": [
        {
            "id": "alibaba/wanx2.1-imageedit",
            "name": "万相 2.1 图像编辑",
            "provider": "alibaba",
            "model_id": "wanx2.1-imageedit",
            "api_type": "dashscope_wanx_image_edit",
            "description": "局部重绘、指令编辑、扩图、去水印",
        },
    ],
    "video": [
        {
            "id": "doubao/seedance-1-0-pro",
            "name": "豆包 海溯视频 1.0 Pro",
            "provider": "doubao",
            "model_id": "doubao-seedance-1-0-pro-250528",
            "api_type": "doubao_native",
            "description": "Doubao SeaDance 高自由度长视频生成",
        },
        {
            "id": "zhipu/cogvideox",
            "name": "CogVideoX",
            "provider": "zhipu",
            "model_id": "cogvideox",
            "api_type": "zhipu_native",
            "description": "智谱 CogVideoX 视频生成",
        },
        # 千问系 HappyHorse（欢乐马）：与万影共用 video-synthesis 异步端点，参数协议见百炼文档
        {
            "id": "alibaba/happyhorse-1.0-t2v",
            "name": "欢乐马 HappyHorse 1.0 文生视频",
            "provider": "alibaba",
            "model_id": "happyhorse-1.0-t2v",
            "api_type": "dashscope_wan_video",
            "description": "千问系 HappyHorse，音画联合生成，3-15 秒，支持 720P/1080P",
        },
        {
            "id": "alibaba/happyhorse-1.0-i2v",
            "name": "欢乐马 HappyHorse 1.0 图生视频",
            "provider": "alibaba",
            "model_id": "happyhorse-1.0-i2v",
            "api_type": "dashscope_wan_video",
            "description": "首帧图驱动视频，画幅自动跟随输入图",
        },
        # 通义万影文生视频：文档中 wan2.7 为新协议参数，2.6/2.5/2.2/wanx2.1 为旧版 size 参数（同一路径）
        {
            "id": "alibaba/wan2.7-t2v",
            "name": "通义万影 2.7 文生视频",
            "provider": "alibaba",
            "model_id": "wan2.7-t2v",
            "api_type": "dashscope_wan_video",
            "description": "万影 2.7 最新代，长提示词与叙事能力更强（resolution/ratio 新参数）",
        },
        {
            "id": "alibaba/wan2.6-t2v",
            "name": "通义万影 2.6 文生视频",
            "provider": "alibaba",
            "model_id": "wan2.6-t2v",
            "api_type": "dashscope_wan_video",
            "description": "万影 2.6 旗舰档，默认有声画、1080P 档位",
        },
        {
            "id": "alibaba/wan2.5-t2v-preview",
            "name": "通义万影 2.5 文生视频 Preview",
            "provider": "alibaba",
            "model_id": "wan2.5-t2v-preview",
            "api_type": "dashscope_wan_video",
            "description": "万影 2.5 预览版，支持 480P/720P/1080P",
        },
        {
            "id": "alibaba/wan2.2-t2v-plus",
            "name": "通义万影 2.2 文生视频 Plus",
            "provider": "alibaba",
            "model_id": "wan2.2-t2v-plus",
            "api_type": "dashscope_wan_video",
            "description": "万影 2.2 Plus，无声画默认，运动与细节增强",
        },
        {
            "id": "alibaba/wanx2.1-t2v-plus",
            "name": "通义万影 2.1 文生视频 Plus",
            "provider": "alibaba",
            "model_id": "wanx2.1-t2v-plus",
            "api_type": "dashscope_wan_video",
            "description": "万影 2.1 Plus（wanx2.1 系列），适合无声短片",
        },
    ],
    "audio": [
        {
            "id": "edge-tts/default",
            "name": "Edge TTS (免费)",
            "provider": "edge",
            "model_id": "edge-tts",
            "api_type": "edge_native",
            "description": "微软 Edge TTS, 免费高质量语音合成",
        },
        {
            "id": "openai/tts-1",
            "name": "OpenAI TTS-1",
            "provider": "openai",
            "model_id": "tts-1",
            "api_type": "openai_native",
            "description": "OpenAI 语音合成",
        },
    ],
}

# ============== OpenRouter 动态缓存 ==============
_OPENROUTER_MEDIA_CACHE: Dict[str, Any] = {
    "timestamp": 0,
    "models": {"image": [], "video": []},
}
_CACHE_TTL = 3600  # 1小时缓存


def _get_api_key(provider: str) -> Optional[str]:
    """根据供应商获取 API Key"""
    key_map = {
        "zhipu": "ZHIPUAI_API_KEY",
        "openai": "OPENAI_API_KEY",
        "openrouter": "OPENROUTER_API_KEY",
        "google": "GOOGLE_API_KEY",
        "doubao": ["ARK_API_KEY", "BYTEDANCE_API_KEY"],
        "alibaba": ["ALIBABA_API_KEY", "DASHSCOPE_API_KEY"],
        "jimeng": "JIMENG_ACCESS_KEY",  # 即梦需同时配置 SECRET，availability 在下方特判
        "edge": None,  # Edge TTS 免费
    }
    
    env_var_config = key_map.get(provider)

    if provider == "edge":
        return "free"  # Edge TTS 无需 Key
    elif provider == "jimeng":
        ak = os.getenv("JIMENG_ACCESS_KEY", "")
        sk = os.getenv("JIMENG_SECRET_KEY", "")
        return ak if (ak and sk) else ""
    elif isinstance(env_var_config, str):
        return os.getenv(env_var_config, "")
    elif isinstance(env_var_config, list):
        for var in env_var_config:
            val = os.getenv(var, "")
            if val:
                return val
    return None


def _fetch_openrouter_media_models() -> Dict[str, List[Dict[str, Any]]]:
    """从 OpenRouter API 动态获取支持 image/video output 的模型"""
    global _OPENROUTER_MEDIA_CACHE
    now = time.time()

    if _OPENROUTER_MEDIA_CACHE["models"]["image"] and (now - _OPENROUTER_MEDIA_CACHE["timestamp"] < _CACHE_TTL):
        return _OPENROUTER_MEDIA_CACHE["models"]

    result: Dict[str, List[Dict[str, Any]]] = {"image": [], "video": []}

    try:
        logger.info("Fetching media models from OpenRouter API...")
        resp = requests.get("https://openrouter.ai/api/v1/models", timeout=30)
        if resp.status_code != 200:
            logger.warning(f"OpenRouter API returned status {resp.status_code}")
            return result

        data = resp.json()
        all_models = data.get("data", [])

        for m in all_models:
            arch = m.get("architecture", {})
            output_mods = arch.get("output_modalities", [])
            model_id = m.get("id", "")
            model_name = m.get("name", model_id)
            pricing = m.get("pricing", {})

            if "image" in output_mods:
                result["image"].append({
                    "id": f"openrouter/{model_id}",
                    "name": model_name,
                    "provider": "openrouter",
                    "model_id": model_id,
                    "api_type": "openrouter",
                    "description": m.get("description", "")[:100],
                    "pricing": pricing,
                    "output_modalities": output_mods,
                })

            # 强制包含某些已知支持视频的模型 (即使 API metadata 未标注)
            KNOWN_VIDEO_MODELS = [
                "google/gemini-2.0-flash-exp:free",
                "google/gemini-2.0-flash-thinking-exp:free",
                "minimax/video-01",  # 尝试保留
                "luma/ray-2",
                "runway/gen-3-alpha-turbo",
            ]

            if "video" in output_mods or model_id in KNOWN_VIDEO_MODELS or any(k in model_id for k in ["video-01", "gen-3", "ray-2"]):
                result["video"].append({
                    "id": f"openrouter/{model_id}",
                    "name": model_name,
                    "provider": "openrouter",
                    "model_id": model_id,
                    "api_type": "openrouter",
                    "description": m.get("description", "")[:100],
                    "pricing": pricing,
                    "output_modalities": output_mods + (["video"] if "video" not in output_mods else []),
                })

        logger.info(f"Found {len(result['image'])} image models, {len(result['video'])} video models from OpenRouter")

    except Exception as e:
        logger.error(f"Failed to fetch OpenRouter media models: {e}")

    # OpenRouter doesn't support video generations via API right now
    _OPENROUTER_MEDIA_CACHE["models"] = result
    _OPENROUTER_MEDIA_CACHE["timestamp"] = now
    return result


def get_all_media_models() -> Dict[str, List[Dict[str, Any]]]:
    """
    获取所有可用的媒体模型, 按 modality 分组。
    合并 OpenRouter 动态模型 + 本地 Provider 模型。
    """
    # 1. 获取 OpenRouter 动态模型
    or_models = _fetch_openrouter_media_models()

    # 2. 合并
    result: Dict[str, List[Dict[str, Any]]] = {"image": [], "video": [], "audio": [], "image_edit": []}

    # OpenRouter 模型放前面
    for modality in ["image", "video"]:
        for m in or_models.get(modality, []):
            m_copy = dict(m)
            m_copy["available"] = bool(_get_api_key("openrouter"))
            result[modality].append(m_copy)

    # 本地 Provider 模型
    for modality in ["image", "video", "audio", "image_edit"]:
        for m in LOCAL_MODELS.get(modality, []):
            m_copy = dict(m)
            m_copy["available"] = bool(_get_api_key(m["provider"]))
            result[modality].append(m_copy)

    return result


def _load_config() -> Dict[str, str]:
    """从文件加载用户选择的模型配置"""
    try:
        if os.path.exists(_CONFIG_FILE):
            with open(_CONFIG_FILE, "r") as f:
                return json.load(f)
    except Exception as e:
        logger.warning(f"Failed to load media model config: {e}")
    return {}


def _save_config(config: Dict[str, str]):
    """保存用户选择的模型配置"""
    try:
        os.makedirs(os.path.dirname(_CONFIG_FILE), exist_ok=True)
        with open(_CONFIG_FILE, "w") as f:
            json.dump(config, f, indent=2, ensure_ascii=False)
    except Exception as e:
        logger.error(f"Failed to save media model config: {e}")


# 默认模型 ID（与 LLM_PROVIDER=alibaba / Qwen·万相·万影 体系对齐）
DEFAULT_MODELS = {
    "image": "alibaba/wan2.7-image",
    "video": "alibaba/wan2.7-t2v",
    "audio": "edge-tts/default",
    "image_edit": "alibaba/wanx2.1-imageedit",
}


def get_current_media_model(modality: str) -> Dict[str, Any]:
    """
    获取当前选中的媒体模型的完整信息。

    Args:
        modality: "image" / "video" / "audio"

    Returns:
        模型详情 dict, 包含 id, name, provider, model_id, api_type 等
    """
    config = _load_config()
    selected_id = config.get(modality, DEFAULT_MODELS.get(modality, ""))

    all_models = get_all_media_models()
    all_modality_models = all_models.get(modality, [])
    
    current_llm_provider = os.getenv("LLM_PROVIDER", "alibaba").lower()
    modality_models = [m for m in all_modality_models if m.get("provider", "") == current_llm_provider]
    if not modality_models and modality == "image_edit":
        modality_models = all_modality_models

    for m in modality_models:
        if m["id"] == selected_id:
            return m

    # Allow custom/manual OpenRouter models that might not be in the public list
    if selected_id.startswith("openrouter/"):
        logger.info(f"Selected model '{selected_id}' not found in fetched list, assuming manual entry.")
        model_part = selected_id.replace("openrouter/", "")
        return {
            "id": selected_id,
            "name": model_part,
            "provider": "openrouter",
            "model_id": model_part,
            "api_type": "openrouter",
            "available": True, # Assume available since user selected it
            "description": "Manual entry (Custom Model)",
        }

    # 如果选中的模型不存在，回退到第一个可用的
    for m in modality_models:
        if m.get("available", False):
            logger.warning(f"Selected model '{selected_id}' not found for {modality}, falling back to '{m['id']}'")
            return m

    # 没有任何可用模型
    logger.error(f"No available model found for modality '{modality}' under provider '{current_llm_provider}'")
    return {
        "id": "none",
        "name": "暂无模型",
        "provider": current_llm_provider,
        "model_id": "",
        "api_type": "none",
        "available": False,
    }


def set_current_media_model(modality: str, model_id: str) -> bool:
    """
    设置某个 modality 的当前选中模型。

    Args:
        modality: "image" / "video" / "audio"
        model_id: 模型 ID, 例如 "openrouter/google/gemini-3-pro-image-preview"

    Returns:
        是否设置成功
    """
    # 验证模型存在
    all_models = get_all_media_models()
    modality_models = all_models.get(modality, [])
    found = any(m["id"] == model_id for m in modality_models)

    if not found:
        logger.error(f"Model '{model_id}' not found in {modality} models")
        return False

    config = _load_config()
    config[modality] = model_id
    _save_config(config)
    logger.info(f"✅ Set {modality} model to: {model_id}")
    return True


def get_media_models_summary() -> Dict[str, Any]:
    """
    获取模型列表摘要 (用于 API 返回)。
    包含各 modality 的模型列表 + 当前选中的模型。
    """
    all_models = get_all_media_models()
    config = _load_config()

    result = {}
    for modality in ["image", "video", "audio", "image_edit"]:
        models = all_models.get(modality, [])
        current_id = config.get(modality, DEFAULT_MODELS.get(modality, ""))
        result[modality] = {
            "models": models,
            "current": current_id,
        }

    return result
