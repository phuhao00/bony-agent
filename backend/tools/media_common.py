"""
媒体工具共享基础设施
- Provider 路由、能力声明
- 文件下载、注册表
- 客户端初始化
"""
import os
import time
import requests
import uuid
import json
import base64
from typing import Optional, Dict, List, Tuple, Any
from openai import OpenAI as OpenAIClient
from utils.logger import setup_logger
from utils.url_safety import is_safe_fetch_url
from tools.memory_tools import save_generation_to_memory

logger = setup_logger("media_common")

# 全局客户端实例（仅 provider=zhipu 时使用，懒加载）
_client: Optional[Any] = None


def create_zhipu_client(api_key: str):
    """按需创建智谱客户端；未安装 zhipuai 时不影响默认通义千问启动。"""
    try:
        from zhipuai import ZhipuAI
    except ImportError as exc:
        raise ImportError(
            "智谱 zhipuai SDK 未安装或版本不兼容。"
            "请配置 ALIBABA_API_KEY / DASHSCOPE_API_KEY 并设置 LLM_PROVIDER=alibaba（通义千问）。"
            "仅在使用智谱媒体能力时才需: pip install zhipuai"
        ) from exc
    return ZhipuAI(api_key=api_key)

# ============== 统一供应商路由 ==============
PROVIDER_CAPABILITIES = {
    "zhipu":      {"image": True,  "video": True,  "tts": True,  "asr": True},
    "openai": {"image": True, "video": False, "audio": True, "env": ["OPENAI_API_KEY"]},
    "openrouter": {"image": True, "video": True, "audio": False, "env": ["OPENROUTER_API_KEY"]},
    "google": {"image": True, "video": False, "audio": False, "env": ["GOOGLE_API_KEY"]},
    "doubao": {"image": False, "video": True, "audio": False, "env": ["ARK_API_KEY", "BYTEDANCE_API_KEY"]},
    "deepseek":   {"image": False, "video": False, "tts": False, "asr": False},
    "alibaba":    {"image": True,  "video": True,  "tts": False, "asr": True, "env": ["ALIBABA_API_KEY", "DASHSCOPE_API_KEY"]},
    "bytedance":  {"image": False, "video": False, "tts": False, "asr": False},
}

# OpenRouter 默认图片生成模型
OPENROUTER_IMAGE_MODEL = "google/gemini-3-pro-image-preview"

# 项目根目录
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# 本地保存目录
OUTPUT_DIR = os.path.join(PROJECT_ROOT, "storage", "outputs")
os.makedirs(OUTPUT_DIR, exist_ok=True)

# 临时文件目录
TEMP_DIR = os.path.join(PROJECT_ROOT, "storage", "temp")
os.makedirs(TEMP_DIR, exist_ok=True)

# 上传目录
UPLOAD_DIR = os.path.join(PROJECT_ROOT, "storage", "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

# 媒体记录文件
MEDIA_REGISTRY = os.path.join(OUTPUT_DIR, "media_registry.json")


def _get_current_provider() -> str:
    """获取当前选择的 LLM Provider ID"""
    return os.getenv("LLM_PROVIDER", "alibaba").lower()


def _get_provider_api_key(provider: str) -> Optional[str]:
    """根据供应商获取对应的 API Key"""
    key_map = {
        "zhipu": "ZHIPUAI_API_KEY",
        "openai": "OPENAI_API_KEY",
        "openrouter": "OPENROUTER_API_KEY",
        "google": "GOOGLE_API_KEY",
        "deepseek": "DEEPSEEK_API_KEY",
        "alibaba": ["ALIBABA_API_KEY", "DASHSCOPE_API_KEY"],
        "bytedance": "BYTEDANCE_API_KEY",
        "doubao": ["ARK_API_KEY", "BYTEDANCE_API_KEY"],
        "seedance": "SEEDANCE_API_KEY",
    }
    
    env_var_config = key_map.get(provider)
    if not env_var_config:
        return None

    if isinstance(env_var_config, str):
        val = os.getenv(env_var_config)
        return str(val).strip() if val and str(val).strip() else None
    elif isinstance(env_var_config, list):
        for var in env_var_config:
            val = os.getenv(var)
            if val and str(val).strip():
                return str(val).strip()
    return None


def _get_provider_base_url(provider: str) -> str:
    """根据供应商获取对应的 Base URL"""
    url_map = {
        "zhipu": "https://open.bigmodel.cn/api/paas/v4/",
        "openai": os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1/"),
        "openrouter": "https://openrouter.ai/api/v1/",
        "google": "https://generativelanguage.googleapis.com/v1beta/openai/",
        "deepseek": "https://api.deepseek.com/v1/",
        "alibaba": "https://dashscope.aliyuncs.com/compatible-mode/v1/",
        "bytedance": "https://ark.cn-beijing.volces.com/api/v3/",
        "seedance": "https://api-us.97claude.com/seedance/v1/",
    }
    return url_map.get(provider, "")


def _check_provider_capability(provider: str, capability: str) -> bool:
    """检查供应商是否支持指定能力"""
    caps = PROVIDER_CAPABILITIES.get(provider, {})
    return caps.get(capability, False)


def _resolve_provider(capability: str) -> Tuple[str, bool]:
    """智能解析供应商：优先当前供应商，不支持时自动寻找有 Key 的备选。

    Returns:
        (provider_id, is_fallback) — is_fallback=True 表示使用了备选供应商
    """
    current = _get_current_provider()

    # 1. 当前供应商支持且有 Key → 直接用
    if _check_provider_capability(current, capability):
        key = _get_provider_api_key(current)
        if key:
            return current, False

    # 2. 当前不支持或无 Key → 按优先级查找备选
    fallback_order = ["alibaba", "jimeng", "openai", "openrouter", "google", "bytedance", "deepseek", "zhipu"]
    for pid in fallback_order:
        if pid == current:
            continue
        if _check_provider_capability(pid, capability) and _get_provider_api_key(pid):
            logger.info(f"Provider [{current}] 不支持 {capability}，自动使用备选: {pid}")
            return pid, True

    # 3. 没有任何可用的供应商
    return current, False


# ============== 文件管理 ==============

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
    if not is_safe_fetch_url(url):
        logger.error("Blocked unsafe download URL: %s", url)
        return ""
    try:
        response = requests.get(url, stream=True, timeout=60)
        response.raise_for_status()

        filename = f"{uuid.uuid4()}{suffix}"
        filepath = os.path.join(OUTPUT_DIR, filename)

        with open(filepath, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)

        logger.info(f"File downloaded successfully to: {filepath}")

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


def save_base64_image(data_url: str, prompt: str = "") -> str:
    """将 base64 data URL 保存为本地图片文件"""
    try:
        header, b64data = data_url.split(",", 1)
        ext = ".png"
        if "jpeg" in header or "jpg" in header:
            ext = ".jpg"
        elif "webp" in header:
            ext = ".webp"

        img_bytes = base64.b64decode(b64data)
        filename = f"{uuid.uuid4()}{ext}"
        filepath = os.path.join(OUTPUT_DIR, filename)

        with open(filepath, "wb") as f:
            f.write(img_bytes)

        logger.info(f"Base64 image saved to: {filepath}")

        registry = load_media_registry()
        registry["images"].append({
            "filename": filename,
            "type": "image",
            "url": "(base64)",
            "local_path": filepath,
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        })
        save_media_registry(registry)
        return filepath
    except Exception as e:
        logger.error(f"Failed to save base64 image: {e}")
        return ""


# ============== DashScope 异步任务（万相文生图 / 万影文生视频）=============

def dashscope_api_root() -> str:
    """DashScope HTTP API 根路径，默认中国内地（北京）。可通过 DASHSCOPE_API_ROOT 覆盖。"""
    return os.getenv("DASHSCOPE_API_ROOT", "https://dashscope.aliyuncs.com/api/v1").rstrip("/")


def dashscope_submit_async(service_suffix: str, body: Dict[str, Any]) -> Dict[str, Any]:
    """
    创建异步任务。service_suffix 例如 services/aigc/text2image/image-synthesis
    返回 {"ok": True, "task_id": "..."} 或 {"ok": False, "error": "..."}
    """
    api_key = _get_provider_api_key("alibaba")
    if not api_key:
        return {"ok": False, "error": "未配置 ALIBABA_API_KEY 或 DASHSCOPE_API_KEY"}

    url = f"{dashscope_api_root()}/{service_suffix.lstrip('/')}"
    try:
        r = requests.post(
            url,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "X-DashScope-Async": "enable",
            },
            json=body,
            timeout=90,
        )
        data = r.json() if r.content else {}
    except Exception as e:
        logger.error(f"DashScope submit failed: {e}", exc_info=True)
        return {"ok": False, "error": str(e)}

    if r.status_code >= 400:
        msg = data.get("message") or data.get("code") or r.text or str(r.status_code)
        return {"ok": False, "error": str(msg)}

    out = data.get("output") or {}
    task_id = out.get("task_id")
    if not task_id:
        return {"ok": False, "error": f"未返回 task_id: {json.dumps(data, ensure_ascii=False)[:500]}"}

    return {"ok": True, "task_id": task_id, "request_id": data.get("request_id")}


def dashscope_get_task(task_id: str) -> Dict[str, Any]:
    api_key = _get_provider_api_key("alibaba")
    if not api_key:
        return {"ok": False, "error": "missing api key"}

    url = f"{dashscope_api_root()}/tasks/{task_id}"
    try:
        r = requests.get(url, headers={"Authorization": f"Bearer {api_key}"}, timeout=60)
        data = r.json() if r.content else {}
    except Exception as e:
        return {"ok": False, "error": str(e)}

    if r.status_code >= 400:
        err = data.get("message") or str(data)
        logger.error(f"[DashScope] get_task HTTP {r.status_code}: {err}")
        return {"ok": False, "error": err, "http_data": data}

    return {"ok": True, "data": data}


def dashscope_wait_task(
    task_id: str,
    *,
    label: str = "dashscope",
    interval: float = 3.0,
    max_wait: int = 900,
) -> Dict[str, Any]:
    """轮询任务直到终态。成功时返回 {"ok": True, "output": output_dict, "raw": data}"""
    deadline = time.time() + max_wait
    while time.time() < deadline:
        got = dashscope_get_task(task_id)
        if not got.get("ok"):
            return {"ok": False, "error": got.get("error", "poll failed")}

        data = got.get("data") or {}
        out = data.get("output") or {}
        status = (out.get("task_status") or "").upper()

        if status == "SUCCEEDED":
            return {"ok": True, "output": out, "raw": data}

        if status in ("FAILED", "CANCELED", "UNKNOWN"):
            msg = out.get("message") or out.get("code") or status
            logger.error(f"[{label}] task={task_id} status={status} error={msg} raw={json.dumps(out, ensure_ascii=False)[:400]}")
            return {"ok": False, "error": f"任务结束({status}): {msg}", "output": out, "raw": data}

        logger.info(f"[{label}] task={task_id} status={status or '...'}")
        time.sleep(interval)

    return {"ok": False, "error": f"{label} 任务超时 ({max_wait}s)"}


# ============== 客户端初始化 ==============

def init_client(api_key: str):
    global _client
    _client = create_zhipu_client(api_key)
    logger.info("ZhipuAI media client initialized manually.")


def get_client() -> Optional[Any]:
    """获取 ZhipuAI 媒体客户端（仅在 provider=zhipu 时使用）"""
    global _client
    if _client is None:
        api_key = os.getenv("ZHIPUAI_API_KEY")
        if api_key:
            _client = create_zhipu_client(api_key)
            logger.info("ZhipuAI media client initialized from environment variable.")
        else:
            logger.warning("ZHIPUAI_API_KEY not set.")
    return _client


# ============== 上传 ==============

def save_upload_file(file_content: bytes, filename: str) -> str:
    """保存上传的文件到本地"""
    ext = os.path.splitext(filename)[1] or ".bin"
    unique_filename = f"{uuid.uuid4()}{ext}"
    filepath = os.path.join(UPLOAD_DIR, unique_filename)

    with open(filepath, 'wb') as f:
        f.write(file_content)

    logger.info(f"File uploaded successfully: {filepath}")
    return filepath


def get_file_public_url(filepath: str) -> str:
    """获取文件的公网URL"""
    filename = os.path.basename(filepath)
    return f"/uploads/{filename}"


# ============== 即梦 AI 通用调用 ==============

def jimeng_get_api():
    """初始化即梦 API 客户端 (Volcengine UniversalApi)"""
    try:
        from volcenginesdkcore import Configuration, UniversalApi, ApiClient
        ak = os.getenv("JIMENG_ACCESS_KEY", "")
        sk = os.getenv("JIMENG_SECRET_KEY", "")
        if not ak or not sk:
            return None, "未设置 JIMENG_ACCESS_KEY 或 JIMENG_SECRET_KEY"
        config = Configuration()
        config.ak = ak
        config.sk = sk
        config.region = "cn-north-1"
        api_client = ApiClient(config)
        return UniversalApi(api_client), None
    except ImportError:
        return None, "请安装 volcengine-python-sdk: pip install volcengine-python-sdk"


def jimeng_call(action: str, body: dict) -> dict:
    """调用即梦 API (通用)"""
    from volcenginesdkcore import UniversalInfo
    api, err = jimeng_get_api()
    if not api:
        raise RuntimeError(err)

    info = UniversalInfo()
    info.service = "cv"
    info.action = action
    info.version = "2022-08-31"
    info.method = "POST"
    info.content_type = "application/json"

    from volcenginesdkcore.rest import ApiException

    max_retries = 5
    for attempt in range(max_retries):
        try:
            resp = api.do_call(info, body)
            return resp
        except ApiException as e:
            is_rate_limit = e.status == 429 or '50430' in str(e.body)
            if is_rate_limit and attempt < max_retries - 1:
                wait_time = 2 ** attempt
                logger.warning(f"Jimeng API Rate Limit. Retrying in {wait_time}s... (Attempt {attempt+1}/{max_retries})")
                time.sleep(wait_time)
                continue
            raise e
            raise e
        except Exception as e:
            raise e

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
