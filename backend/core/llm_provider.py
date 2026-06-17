"""
多供应商 LLM 配置中心

支持的供应商：
- zhipu (智谱 AI) — GLM-4.7, CogView-3-Plus, CogVideoX
- google (Google AI) — Gemini 1.5/2.0 系列, Imagen 3
- deepseek — DeepSeek-V3, DeepSeek-R1
- bytedance (字节火山引擎) — Doubao-1.5 系列
- jimeng (即梦 AI) — 图片生成 4.0, 视频生成 1.0 Pro
- alibaba (阿里通义千问 / DashScope) — Qwen 系列，OpenAI 兼容接口
- openai — GPT-4o 系列

通过环境变量 LLM_PROVIDER 切换供应商，默认 alibaba（通义千问 Qwen）。
通过环境变量 LLM_MODEL 覆盖默认模型。
所有供应商均通过 OpenAI 兼容接口调用。
"""

import os
from typing import Optional, List, Dict
import time
import requests
from dataclasses import dataclass
from utils.logger import setup_logger

logger = setup_logger("llm_provider")


@dataclass
class ProviderConfig:
    """供应商配置"""
    name: str                # 供应商名称
    api_key_env: str         # 环境变量名
    base_url: str            # API 基础 URL
    default_model: str       # 默认模型
    available_models: list   # 可选模型列表
    embedding_model: str     # Embedding 模型 (空字符串表示无自有 embedding)
    embedding_provider: str  # Embedding 来源 ("self" 或 "zhipu" 等)
    extra_keys: list = None  # 额外的环境变量 (如 Jimeng 的 SK)


# 供应商注册表
PROVIDERS = {
    "zhipu": ProviderConfig(
        name="智谱 AI",
        api_key_env="ZHIPUAI_API_KEY",
        base_url="https://open.bigmodel.cn/api/paas/v4/",
        default_model="glm-4-plus",
        available_models=["glm-4-plus", "glm-4", "glm-4-flash", "glm-4.7", "glm-3-turbo"],
        embedding_model="embedding-2",
        embedding_provider="self",
    ),
    "alibaba": ProviderConfig(
        name="阿里通义千问（DashScope）",
        api_key_env="ALIBABA_API_KEY",
        base_url="https://dashscope.aliyuncs.com/compatible-mode/v1/",
        default_model="qwen-max",
        available_models=[
            "qwen-max",
            "qwen-plus",
            "qwen-turbo",
            "qwen-long",
            "qwen3-max",
            "qwen2.5-72b-instruct",
            "qwen2.5-32b-instruct",
            "qwen2.5-14b-instruct",
            "qwen-vl-max",
            "qwen-vl-plus",
            "qwen2.5-vl-72b-instruct",
            "qwen2.5-vl-32b-instruct",
            "qwen2.5-vl-7b-instruct",
        ],
        embedding_model="text-embedding-v3",
        embedding_provider="self",
        extra_keys=["DASHSCOPE_API_KEY"],
    ),
    "google": ProviderConfig(
        name="Google AI",
        api_key_env="GOOGLE_API_KEY",
        base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
        default_model="gemini-2.0-flash",
        available_models=["gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash", "gemini-2.0-flash-lite"],
        embedding_model="text-embedding-004",
        embedding_provider="self",
    ),
    "deepseek": ProviderConfig(
        name="DeepSeek",
        api_key_env="DEEPSEEK_API_KEY",
        base_url="https://api.deepseek.com/v1/",
        default_model="deepseek-chat",
        available_models=["deepseek-chat", "deepseek-reasoner", "deepseek-v3.2"],
        embedding_model="",
        embedding_provider="alibaba",  # DeepSeek 无 embedding，复用通义
    ),
    "bytedance": ProviderConfig(
        name="字节火山引擎 (豆包)",
        api_key_env="BYTEDANCE_API_KEY",
        base_url="https://ark.cn-beijing.volces.com/api/v3/",
        default_model="doubao-1.5-pro-32k",
        available_models=["doubao-1.5-pro-32k", "doubao-1.5-pro-256k", "doubao-seed-1.6", "doubao-pro-32k"],
        embedding_model="doubao-embedding",
        embedding_provider="self",
    ),
    "jimeng": ProviderConfig(
        name="即梦 AI (火山引擎)",
        api_key_env="JIMENG_ACCESS_KEY",
        base_url="https://ark.cn-beijing.volces.com/api/v3/",  # 聊天走火山引擎 Ark
        default_model="doubao-1.5-pro-32k",
        available_models=["doubao-1.5-pro-32k", "doubao-1.5-pro-256k"],
        embedding_model="",
        embedding_provider="alibaba",
        extra_keys=["JIMENG_SECRET_KEY"],
    ),
    "openai": ProviderConfig(
        name="OpenAI",
        api_key_env="OPENAI_API_KEY",
        base_url="https://api.openai.com/v1/",
        default_model="gpt-4o",
        available_models=["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-5.2"],
        embedding_model="text-embedding-3-small",
        embedding_provider="self",
    ),
    "ollama": ProviderConfig(
        name="Ollama (Local)",
        api_key_env="OLLAMA_API_KEY",
        base_url=os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434/v1/").rstrip("/") + "/",
        default_model=os.getenv("OLLAMA_MODEL", "llama3.2:3b"),
        available_models=[
            "llama3.2:3b",
            "llama3.2:1b",
            "qwen2.5:3b",
            "qwen2.5:7b",
            "gemma2:2b",
        ],
        embedding_model="",
        embedding_provider="alibaba",
    ),
    "openrouter": ProviderConfig(
        name="OpenRouter",
        api_key_env="OPENROUTER_API_KEY",
        base_url="https://openrouter.ai/api/v1/",
        default_model="google/gemini-3-pro-preview",
        available_models=[
            # --- Text: Top Tier ---
            "google/gemini-3-pro-preview", 
            "openai/gpt-4o",
            "openrouter/auto",
            
            # --- Google / Gemini Series ---
            "google/gemini-2.0-flash-001",
            "google/gemini-2.0-pro-exp-02-05", 
            
            "anthropic/claude-3.5-sonnet",
            
            "deepseek/deepseek-r1",
            "deepseek/deepseek-v3",
            
            "qwen/qwen-max",
            "qwen/qwen-2.5-72b-instruct",
            
            # --- Multimodal / VL Models ---
            "nvidia/nemotron-nano-2-vl",
            
            # --- Image: Top Tier Only ---
            "google/imagen-3.0-generate-001",
            "google/imagen-3.0-fast-generate-001",
            "black-forest-labs/flux-1.1-pro",
            
            # --- Video ---
            # OpenRouter currently does not support direct video generation models.
            # Use Jimeng (Volcengine) for video tasks.
        ],
        embedding_model="",  # OpenRouter 暂不作为 Embedding 主力
        embedding_provider="alibaba",  # 复用通义 Embedding
    ),
}

# 各供应商默认视觉模型（图片理解 / OCR 降级；勿与 LLM_MODEL 文本模型混用）
VISION_MODELS: Dict[str, str] = {
    "alibaba": "qwen-vl-max",
    "zhipu": "glm-4v",
    "google": "gemini-2.0-flash",
    "openai": "gpt-4o",
    "deepseek": "qwen-vl-max",  # DeepSeek 无原生 VL，降级用通义 VL（需 ALIBABA/DASHSCOPE Key）
    "bytedance": "doubao-1.5-vision-pro-32k",
    "jimeng": "doubao-1.5-vision-pro-32k",
    "openrouter": "google/gemini-2.0-flash",
}

_PROVIDER_ALIASES = {
    "": "alibaba",
    "dashscope": "alibaba",
    "qwen": "alibaba",
    "qwan": "alibaba",
    "tongyi": "alibaba",
    "通义": "alibaba",
}


def _normalize_provider_id(provider_id: str) -> str:
    pid = (provider_id or "alibaba").strip().lower()
    return _PROVIDER_ALIASES.get(pid, pid) or "alibaba"


def is_vision_capable_model(model: str) -> bool:
    """判断模型是否可能支持 image_url 多模态输入。"""
    m = (model or "").strip().lower()
    if not m:
        return False
    vision_hints = (
        "vl", "vision", "4v", "gpt-4o", "gemini", "nemotron-nano-2-vl",
        "doubao-1.5-vision", "glm-4v",
        "qwen-vl", "qwen2-vl", "qwen2.5-vl", "qwen3-vl",
    )
    if any(h in m for h in vision_hints):
        return True
    text_only_hints = (
        "qwen-max", "qwen-plus", "qwen-turbo", "qwen-long", "qwen3-max",
        "qwen2.5-72b-instruct", "qwen2.5-32b-instruct", "qwen2.5-14b-instruct",
        "deepseek-chat", "deepseek-reasoner", "deepseek-v3",
        "glm-4-plus", "glm-4-flash", "glm-4.7", "glm-3-turbo",
        "doubao-1.5-pro", "doubao-seed",
    )
    if any(h in m for h in text_only_hints):
        return False
    return False


def default_vision_model_for_provider(provider_id: Optional[str] = None) -> str:
    pid = _normalize_provider_id(provider_id or get_provider_id())
    return VISION_MODELS.get(pid) or "qwen-vl-max"


def get_vision_model(provider_id: Optional[str] = None) -> str:
    """
    获取图片视觉理解专用模型。
    优先 LLM_VISION_MODEL；否则按供应商映射。
    绝不返回纯文本对话模型（如 qwen-max / LLM_MODEL）。
    """
    pid = _normalize_provider_id(provider_id or get_provider_id())
    override = (os.getenv("LLM_VISION_MODEL") or "").strip()
    chosen: Optional[str] = None

    if override:
        if is_vision_capable_model(override):
            chosen = override
        else:
            logger.warning(
                "LLM_VISION_MODEL=%s is text-only or unknown; using provider vision model",
                override,
            )

    if not chosen:
        chosen = default_vision_model_for_provider(pid)

    if not is_vision_capable_model(chosen):
        fallback = default_vision_model_for_provider(pid)
        logger.error(
            "Refusing text-only vision model %s (provider=%s); using %s",
            chosen,
            pid,
            fallback,
        )
        chosen = fallback

    return chosen


def _is_qwen_vision_model(model: str) -> bool:
    m = (model or "").strip().lower()
    if not m:
        return False
    if any(h in m for h in ("qwen-vl", "qwen2-vl", "qwen2.5-vl", "qwen3-vl")):
        return True
    return m.startswith("qwen") and "vl" in m


def resolve_vision_credentials() -> tuple[str, str, Optional[str], ProviderConfig]:
    """
    解析视觉 API 的 provider、model、api_key、config。

    - 支持 LLM_VISION_PROVIDER 单独指定视觉供应商（如 alibaba / qwen）
    - Qwen VL 模型自动走 DashScope（ALIBABA_API_KEY / DASHSCOPE_API_KEY）
    - 当前对话 provider 无 Key 时，若配置了通义 Key 则降级使用 alibaba 视觉模型
    """
    override_pid = (os.getenv("LLM_VISION_PROVIDER") or "").strip()
    pid = _normalize_provider_id(override_pid) if override_pid else get_provider_id()
    model = get_vision_model(pid)

    if _is_qwen_vision_model(model) and pid != "alibaba":
        ali_key = get_api_key("alibaba")
        if ali_key:
            pid = "alibaba"
            if not override_pid:
                model = get_vision_model("alibaba")

    key = get_api_key(pid)
    if not key:
        ali_key = get_api_key("alibaba")
        if ali_key:
            pid = "alibaba"
            model = get_vision_model("alibaba")
            key = ali_key

    config = PROVIDERS.get(pid) or PROVIDERS["alibaba"]
    return pid, model, key, config


def get_provider_id() -> str:
    """获取当前供应商 ID"""
    return _normalize_provider_id(os.getenv("LLM_PROVIDER", "alibaba"))


def get_current_model() -> str:
    """获取当前使用的模型（支持 LLM_MODEL 覆盖）"""
    custom_model = os.getenv("LLM_MODEL", "").strip()
    if custom_model:
        return custom_model
    config = get_provider_config()
    return config.default_model


def get_rag_llm_model() -> str:
    """
    知识库智能检索（LlamaIndex query engine）使用的文本模型。
    优先 RAG_LLM_MODEL，否则与对话一致（LLM_MODEL / 供应商 default_model）。
    """
    override = (os.getenv("RAG_LLM_MODEL") or "").strip()
    if override:
        return override
    return get_current_model()


def get_provider_config() -> ProviderConfig:
    """获取当前供应商配置"""
    provider_id = get_provider_id()
    config = PROVIDERS.get(provider_id)
    if not config:
        logger.warning(f"Unknown provider '{provider_id}', falling back to 'alibaba'")
        config = PROVIDERS["alibaba"]
    return config


def get_api_key(provider_id: Optional[str] = None) -> Optional[str]:
    """获取 API Key。通义千问同时认 ALIBABA_API_KEY 与阿里云示例中的 DASHSCOPE_API_KEY。"""
    pid = provider_id if provider_id is not None else get_provider_id()
    if pid == "alibaba":
        a = (os.getenv("ALIBABA_API_KEY") or "").strip()
        if a:
            return a
        d = (os.getenv("DASHSCOPE_API_KEY") or "").strip()
        return d or None
    config = PROVIDERS.get(pid, PROVIDERS["alibaba"])
    v = (os.getenv(config.api_key_env) or "").strip()
    return v or None


def get_ollama_base_url() -> str:
    raw = (os.getenv("OLLAMA_BASE_URL") or "http://127.0.0.1:11434/v1/").strip()
    if not raw.endswith("/"):
        raw += "/"
    return raw


def get_ollama_model() -> str:
    return (os.getenv("OLLAMA_MODEL") or "llama3.2:3b").strip()


def is_ollama_available(timeout: float = 1.5) -> bool:
    """Probe local Ollama tags endpoint."""
    base = get_ollama_base_url().rstrip("/v1").rstrip("/")
    try:
        resp = requests.get(f"{base}/api/tags", timeout=timeout)
        return resp.status_code == 200
    except Exception:
        return False


def get_llm_kwargs(
    temperature: float = 0.7,
    model: Optional[str] = None,
    streaming: bool = False,
    api_key: Optional[str] = None,
    provider_id: Optional[str] = None,
) -> dict:
    """
    获取 ChatOpenAI 的初始化参数。
    
    用法:
        from core.llm_provider import get_llm_kwargs
        from langchain_openai import ChatOpenAI
        
        llm = ChatOpenAI(**get_llm_kwargs(temperature=0.7))
    """
    pid = provider_id or get_provider_id()
    config = PROVIDERS.get(pid) or get_provider_config()
    resolved_key = api_key or get_api_key(pid if provider_id else None)

    if pid == "ollama":
        resolved_key = resolved_key or (os.getenv("OLLAMA_API_KEY") or "ollama")
        resolved_model = model or get_ollama_model()
        return {
            "api_key": resolved_key,
            "base_url": get_ollama_base_url(),
            "model": resolved_model,
            "temperature": temperature,
            "streaming": streaming,
            "max_tokens": 1024,
        }

    if not resolved_key:
        hint = (
            "ALIBABA_API_KEY 或 DASHSCOPE_API_KEY"
            if pid == "alibaba"
            else config.api_key_env
        )
        logger.warning(f"{hint} not set! LLM calls will fail.")

    return {
        "api_key": resolved_key or "sk-placeholder",
        "base_url": config.base_url,
        "model": model or get_current_model(),
        "temperature": temperature,
        "streaming": streaming,
        "max_tokens": 4096,
    }


def get_chat_llm(
    temperature: float = 0.7,
    model: Optional[str] = None,
    streaming: bool = False,
    api_key: Optional[str] = None,
    provider_id: Optional[str] = None,
):
    """
    获取 ChatOpenAI 实例（便捷方法）。
    
    用法:
        from core.llm_provider import get_chat_llm
        llm = get_chat_llm(temperature=0.5)
    """
    from langchain_openai import ChatOpenAI
    args = get_llm_kwargs(
        temperature=temperature,
        model=model,
        streaming=streaming,
        api_key=api_key,
        provider_id=provider_id,
    )
    logger.info(f"🔵 Generating with LLM Model: {args.get('model')}")
    return ChatOpenAI(**args)


def get_embedding_config() -> dict:
    """
    获取 Embedding 模型配置。
    
    返回:
        {
            "provider": "zhipu" | "google" | "openai" | ...,
            "api_key": "...",
            "model": "embedding-2",
            "base_url": "..."
        }
    """
    config = get_provider_config()
    
    if config.embedding_provider == "self" and config.embedding_model:
        return {
            "provider": get_provider_id(),
            "api_key": get_api_key(),
            "model": config.embedding_model,
            "base_url": config.base_url,
        }
    else:
        # 回退到通义千问 embedding（不再依赖智谱）
        fallback = PROVIDERS["alibaba"]
        return {
            "provider": "alibaba",
            "api_key": get_api_key("alibaba"),
            "model": fallback.embedding_model,
            "base_url": fallback.base_url,
        }


def print_provider_info():
    """打印当前供应商信息（启动时调用）"""
    config = get_provider_config()
    provider_id = get_provider_id()
    current_model = get_current_model()
    has_key = "✅" if get_api_key() else "❌"
    logger.info(f"LLM Provider: {config.name} ({provider_id}), Model: {current_model}, API Key: {has_key}")
    return {
        "provider": provider_id,
        "name": config.name,
        "model": current_model,
        "has_key": bool(get_api_key()),
    }


# Cache for OpenRouter models
_OPENROUTER_CACHE = {
    "timestamp": 0,
    "models": []
}

def fetch_openrouter_models() -> list:
    """
    动态获取 OpenRouter 模型列表
    
    Strategy: STRICT CURATION
    Keep only the filtered top models defined in 'available_models' 
    plus maybe strictly ensuring the IDs are valid.
    
    Since the user complained about "too many unrelated", we will 
    mostly trust the static curated list but verify them against the API.
    """
    global _OPENROUTER_CACHE
    now = time.time()
    
    # Check cache (1 hour)
    if _OPENROUTER_CACHE["models"] and (now - _OPENROUTER_CACHE["timestamp"] < 3600):
        return _OPENROUTER_CACHE["models"]
    
    static_curated_models = PROVIDERS["openrouter"].available_models
    validated_models = []
    
    try:
        logger.info("Fetching fresh models from OpenRouter API...")
        resp = requests.get("https://openrouter.ai/api/v1/models", timeout=30)
        
        if resp.status_code == 200:
            data = resp.json()
            all_models_data = data.get("data", [])
            
            api_model_ids = {m["id"] for m in all_models_data}
            
            # Validate static curated models against the API response
            for model_id in static_curated_models:
                if model_id in api_model_ids:
                    validated_models.append(model_id)
            
            logger.info(f"Validated {len(validated_models)} curated models against API.")
        else:
            logger.warning(f"Failed to fetch OpenRouter models: Status {resp.status_code}")
    except Exception as e:
        logger.error(f"Error fetching OpenRouter models: {e}")
    
    # If dynamic fetch failed or found no valid models, fallback to the full static list
    if not validated_models:
        _OPENROUTER_CACHE["models"] = list(static_curated_models)
    else:
        _OPENROUTER_CACHE["models"] = validated_models
    
    # Update cache timestamp
    _OPENROUTER_CACHE["timestamp"] = now
            
    return _OPENROUTER_CACHE["models"]
