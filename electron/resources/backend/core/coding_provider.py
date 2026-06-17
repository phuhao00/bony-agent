"""Coding engine credentials — separate from main chat LLM provider.

Claude Code CLI reads ``ANTHROPIC_API_KEY`` and ``ANTHROPIC_BASE_URL`` in its
subprocess environment. This module maps user-configured coding keys (any
Anthropic-compatible gateway) into those variables.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, Optional

from utils.logger import setup_logger

logger = setup_logger("coding_provider")

# Dedicated env vars (persisted via POST /config/coding)
ENV_PROVIDER = "CODING_PROVIDER"
ENV_API_KEY = "CODING_API_KEY"
ENV_BASE_URL = "CODING_BASE_URL"
ENV_MODEL = "CODING_MODEL"

# 通义百炼 Anthropic 兼容端点（Claude Code 官方文档推荐）
QWEN_ANTHROPIC_BASE_URL = os.environ.get(
    "DASHSCOPE_ANTHROPIC_BASE_URL",
    "https://dashscope.aliyuncs.com/apps/anthropic",
).rstrip("/")

# 默认 Coding 模型：通义代码系列最新旗舰（Agent 场景官方推荐）
# 若需极致质量可设 CODING_MODEL_DEFAULT=qwen3-coder-plus
DEFAULT_CODING_MODEL = os.environ.get("CODING_MODEL_DEFAULT", "qwen3-coder-next")

# auto 模式密钥探测顺序（Anthropic 兼容）
_AUTO_KEY_ENVS = (
    ENV_API_KEY,
    "ALIBABA_API_KEY",
    "DASHSCOPE_API_KEY",
    "ANTHROPIC_API_KEY",
    "OPENROUTER_API_KEY",
)


@dataclass(frozen=True)
class CodingProviderOption:
    id: str
    name: str
    default_base_url: str
    default_model: str
    description: str


CODING_PROVIDERS: dict[str, CodingProviderOption] = {
    "qwen": CodingProviderOption(
        id="qwen",
        name="通义千问（百炼）",
        default_base_url=QWEN_ANTHROPIC_BASE_URL,
        default_model=DEFAULT_CODING_MODEL,
        description=(
            "DashScope Anthropic 兼容接口；"
            "密钥：CODING_API_KEY / ALIBABA_API_KEY / DASHSCOPE_API_KEY"
        ),
    ),
    "auto": CodingProviderOption(
        id="auto",
        name="自动检测",
        default_base_url="",
        default_model=DEFAULT_CODING_MODEL,
        description="优先 CODING_API_KEY，其次通义 / ANTHROPIC / OPENROUTER 已配置密钥",
    ),
    "anthropic": CodingProviderOption(
        id="anthropic",
        name="Anthropic 直连",
        default_base_url="https://api.anthropic.com",
        default_model="claude-sonnet-4-5",
        description="官方 API；未填 CODING_API_KEY 时使用 ANTHROPIC_API_KEY",
    ),
    "openrouter": CodingProviderOption(
        id="openrouter",
        name="OpenRouter",
        default_base_url="https://openrouter.ai/api",
        default_model="anthropic/claude-sonnet-4",
        description="OpenRouter 聚合；未填 CODING_API_KEY 时使用 OPENROUTER_API_KEY",
    ),
    "custom": CodingProviderOption(
        id="custom",
        name="自定义兼容网关",
        default_base_url="",
        default_model="claude-sonnet-4-5",
        description="任意 Anthropic 兼容 Base URL + API Key（如企业内部代理）",
    ),
}

_PROVIDER_KEY_FALLBACK: dict[str, tuple[str, ...]] = {
    "qwen": ("CODING_API_KEY", "ALIBABA_API_KEY", "DASHSCOPE_API_KEY"),
    "anthropic": ("CODING_API_KEY", "ANTHROPIC_API_KEY"),
    "openrouter": ("CODING_API_KEY", "OPENROUTER_API_KEY"),
    "custom": ("CODING_API_KEY",),
    "auto": _AUTO_KEY_ENVS,
}


@dataclass
class CodingCredentials:
    provider_id: str
    api_key: str
    base_url: str
    model: str
    key_source: str
    auth_mode: str  # api_key | oauth | none

    @property
    def ready(self) -> bool:
        return bool(self.api_key) or self.auth_mode == "oauth"


def get_coding_provider_id() -> str:
    raw = os.environ.get(ENV_PROVIDER, "qwen").strip().lower()
    if raw in ("alibaba", "dashscope", "tongyi", "通义", "qwan"):
        return "qwen"
    return raw if raw in CODING_PROVIDERS else "qwen"


def _first_key(env_names: tuple[str, ...]) -> tuple[str, str]:
    for name in env_names:
        val = os.environ.get(name, "").strip()
        if val:
            return val, name
    return "", ""


def _oauth_available() -> bool:
    from pathlib import Path
    import json

    auth_file = Path.home() / ".claude" / "auth.json"
    if not auth_file.is_file():
        return False
    try:
        data = json.loads(auth_file.read_text(encoding="utf-8"))
        return bool(data)
    except Exception:
        return False


def resolve_coding_credentials() -> CodingCredentials:
    """Resolve API key / base URL / model for Claude Code subprocess."""
    provider_id = get_coding_provider_id()
    option = CODING_PROVIDERS.get(provider_id) or CODING_PROVIDERS["auto"]

    key_names = _PROVIDER_KEY_FALLBACK.get(provider_id, _AUTO_KEY_ENVS)
    api_key, key_source = _first_key(key_names)

    base_url = os.environ.get(ENV_BASE_URL, "").strip()
    if not base_url:
        if provider_id in ("qwen", "auto") and key_source in (
            "ALIBABA_API_KEY",
            "DASHSCOPE_API_KEY",
            "CODING_API_KEY",
        ):
            base_url = CODING_PROVIDERS["qwen"].default_base_url
        elif provider_id == "qwen":
            base_url = option.default_base_url
        elif provider_id == "openrouter":
            base_url = option.default_base_url
        elif provider_id == "anthropic":
            base_url = option.default_base_url
        elif provider_id == "auto" and key_source == "OPENROUTER_API_KEY":
            base_url = CODING_PROVIDERS["openrouter"].default_base_url
        elif provider_id == "auto" and key_source == "ANTHROPIC_API_KEY":
            base_url = CODING_PROVIDERS["anthropic"].default_base_url
        elif provider_id == "custom":
            base_url = ""
        else:
            base_url = option.default_base_url if option.default_base_url else ""

    model = os.environ.get(ENV_MODEL, "").strip() or option.default_model

    auth_mode = "none"
    if api_key:
        auth_mode = "api_key"
    elif _oauth_available():
        auth_mode = "oauth"

    return CodingCredentials(
        provider_id=provider_id,
        api_key=api_key,
        base_url=base_url.rstrip("/"),
        model=model,
        key_source=key_source or ("oauth" if auth_mode == "oauth" else ""),
        auth_mode=auth_mode,
    )


def build_claude_code_subprocess_env(
    creds: Optional[CodingCredentials] = None,
) -> dict[str, str]:
    """Env dict passed to ClaudeAgentOptions.env for the CLI child process."""
    c = creds or resolve_coding_credentials()
    env: dict[str, str] = {}
    if c.api_key:
        env["ANTHROPIC_API_KEY"] = c.api_key
        # 百炼文档亦支持 ANTHROPIC_AUTH_TOKEN
        env["ANTHROPIC_AUTH_TOKEN"] = c.api_key
    if c.base_url:
        env["ANTHROPIC_BASE_URL"] = c.base_url
    if c.model:
        env["ANTHROPIC_MODEL"] = c.model
        env["ANTHROPIC_DEFAULT_SONNET_MODEL"] = c.model
        env["ANTHROPIC_DEFAULT_OPUS_MODEL"] = c.model
        env["CLAUDE_CODE_SUBAGENT_MODEL"] = c.model
    return env


def get_coding_config_summary() -> dict[str, Any]:
    creds = resolve_coding_credentials()
    option = CODING_PROVIDERS.get(creds.provider_id) or CODING_PROVIDERS["auto"]
    dedicated_key = os.environ.get(ENV_API_KEY, "").strip()
    return {
        "current": {
            "provider": creds.provider_id,
            "provider_name": option.name,
            "model": creds.model,
            "base_url": creds.base_url,
            "has_key": bool(creds.api_key),
            "auth": creds.auth_mode,
            "key_source": creds.key_source,
            "api_key_value": dedicated_key,
            "ready": creds.ready,
        },
        "available": [
            {
                "id": p.id,
                "name": p.name,
                "default_base_url": p.default_base_url,
                "default_model": p.default_model,
                "description": p.description,
            }
            for p in CODING_PROVIDERS.values()
        ],
        "env_vars": {
            "provider": ENV_PROVIDER,
            "api_key": ENV_API_KEY,
            "base_url": ENV_BASE_URL,
            "model": ENV_MODEL,
        },
    }


def apply_coding_config_update(
    *,
    provider: Optional[str] = None,
    api_key: Optional[str] = None,
    base_url: Optional[str] = None,
    model: Optional[str] = None,
) -> list[str]:
    """Apply coding config to os.environ; returns change log (no secrets)."""
    changes: list[str] = []

    if provider is not None:
        pid = provider.strip().lower()
        if pid in ("alibaba", "dashscope", "tongyi", "通义", "qwan"):
            pid = "qwen"
        if pid not in CODING_PROVIDERS:
            raise ValueError(f"Unknown coding provider: {provider}")
        os.environ[ENV_PROVIDER] = pid
        changes.append(f"{ENV_PROVIDER}={pid}")

    if api_key is not None:
        val = api_key.strip()
        if val:
            os.environ[ENV_API_KEY] = val
            changes.append(f"{ENV_API_KEY}=***")
        else:
            os.environ.pop(ENV_API_KEY, None)
            changes.append(f"{ENV_API_KEY}=<cleared>")

    if base_url is not None:
        val = base_url.strip().rstrip("/")
        if val:
            os.environ[ENV_BASE_URL] = val
            changes.append(f"{ENV_BASE_URL}={val}")
        else:
            os.environ.pop(ENV_BASE_URL, None)
            changes.append(f"{ENV_BASE_URL}=<cleared>")

    if model is not None:
        val = model.strip()
        if val:
            os.environ[ENV_MODEL] = val
            changes.append(f"{ENV_MODEL}={val}")
        else:
            os.environ.pop(ENV_MODEL, None)
            changes.append(f"{ENV_MODEL}=<cleared>")

    return changes


def _resolve_bootstrap_api_key() -> str:
    if os.environ.get(ENV_API_KEY, "").strip():
        return os.environ[ENV_API_KEY].strip()
    for name in ("ALIBABA_API_KEY", "DASHSCOPE_API_KEY"):
        val = os.environ.get(name, "").strip()
        if val:
            return val
    return ""


def ensure_coding_config_auto(
    *,
    env_file: Optional[str] = None,
    persist: bool = True,
) -> dict[str, Any]:
    """首次启动时从已有通义/百炼密钥自动补齐 Coding 配置并可选写入 .env。"""
    changes: dict[str, str] = {}

    provider = os.environ.get(ENV_PROVIDER, "").strip().lower()
    if not provider:
        llm = os.environ.get("LLM_PROVIDER", "").strip().lower()
        if llm in ("alibaba", "dashscope", "qwen", "qwan", "tongyi", "通义", ""):
            changes["provider"] = "qwen"
        else:
            changes["provider"] = "qwen"

    if not os.environ.get(ENV_MODEL, "").strip():
        changes["model"] = DEFAULT_CODING_MODEL

    if not os.environ.get(ENV_BASE_URL, "").strip():
        changes["base_url"] = QWEN_ANTHROPIC_BASE_URL

    if not os.environ.get(ENV_API_KEY, "").strip():
        synced = _resolve_bootstrap_api_key()
        if synced:
            changes["api_key"] = synced

    bootstrapped = False
    if changes:
        apply_coding_config_update(**changes)
        bootstrapped = True
        if persist and env_file:
            persist_coding_env(env_file, **changes)
            logger.info(
                "Coding config auto-bootstrapped: %s",
                ", ".join(f"{k}=..." if k == "api_key" else f"{k}={v}" for k, v in changes.items()),
            )

    creds = resolve_coding_credentials()
    return {
        "bootstrapped": bootstrapped,
        "changes": list(changes.keys()),
        "ready": creds.ready,
        "provider": creds.provider_id,
        "model": creds.model,
        "base_url": creds.base_url,
        "key_source": creds.key_source,
    }


def persist_coding_env(
    env_file: str,
    *,
    provider: Optional[str] = None,
    api_key: Optional[str] = None,
    base_url: Optional[str] = None,
    model: Optional[str] = None,
) -> None:
    """Merge coding settings into backend .env file."""
    existing: dict[str, str] = {}
    if os.path.exists(env_file):
        with open(env_file, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, _, val = line.partition("=")
                    existing[key.strip()] = val.strip()

    if provider is not None and provider.strip():
        pid = provider.strip().lower()
        if pid in ("alibaba", "dashscope", "tongyi", "通义", "qwan"):
            pid = "qwen"
        existing[ENV_PROVIDER] = pid

    if api_key is not None:
        if api_key.strip():
            existing[ENV_API_KEY] = api_key.strip()
        elif ENV_API_KEY in existing:
            del existing[ENV_API_KEY]

    if base_url is not None:
        if base_url.strip():
            existing[ENV_BASE_URL] = base_url.strip().rstrip("/")
        elif ENV_BASE_URL in existing:
            del existing[ENV_BASE_URL]

    if model is not None:
        if model.strip():
            existing[ENV_MODEL] = model.strip()
        elif ENV_MODEL in existing:
            del existing[ENV_MODEL]

    with open(env_file, "w", encoding="utf-8") as f:
        for k, v in existing.items():
            f.write(f"{k}={v}\n")
