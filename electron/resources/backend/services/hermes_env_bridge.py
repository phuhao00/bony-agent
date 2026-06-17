"""Bridge AI Media Agent backend/.env credentials into Hermes CLI subprocesses."""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from utils.logger import setup_logger

logger = setup_logger("hermes_env_bridge")

PROJECT_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ENV_PATH = PROJECT_ROOT / "backend" / ".env"
ROOT_ENV_PATH = PROJECT_ROOT / ".env"
HERMES_HOME = Path.home() / ".hermes"
HERMES_DOTENV = HERMES_HOME / ".env"

# Hermes env var -> project env vars (first non-empty wins)
_HERMES_KEY_SOURCES: Dict[str, Tuple[str, ...]] = {
    "DASHSCOPE_API_KEY": ("DASHSCOPE_API_KEY", "ALIBABA_API_KEY"),
    "ALIBABA_API_KEY": ("ALIBABA_API_KEY", "DASHSCOPE_API_KEY"),
    "OPENROUTER_API_KEY": ("OPENROUTER_API_KEY",),
    "DEEPSEEK_API_KEY": ("DEEPSEEK_API_KEY",),
    "GOOGLE_API_KEY": ("GOOGLE_API_KEY", "GEMINI_API_KEY"),
    "GEMINI_API_KEY": ("GEMINI_API_KEY", "GOOGLE_API_KEY"),
    "OPENAI_API_KEY": ("OPENAI_API_KEY",),
    "ZHIPUAI_API_KEY": ("ZHIPUAI_API_KEY",),
    "GLM_API_KEY": ("ZHIPUAI_API_KEY", "GLM_API_KEY"),
    "BYTEDANCE_API_KEY": ("BYTEDANCE_API_KEY", "ARK_API_KEY"),
    "XAI_API_KEY": ("XAI_API_KEY",),
    "ANTHROPIC_API_KEY": ("ANTHROPIC_API_KEY",),
}

_PROVIDER_KEY_MAP: Dict[str, Tuple[str, ...]] = {
    "alibaba": ("DASHSCOPE_API_KEY", "ALIBABA_API_KEY"),
    "dashscope": ("DASHSCOPE_API_KEY", "ALIBABA_API_KEY"),
    "qwen": ("DASHSCOPE_API_KEY", "ALIBABA_API_KEY"),
    "qwen cloud": ("DASHSCOPE_API_KEY", "ALIBABA_API_KEY"),
    "openrouter": ("OPENROUTER_API_KEY",),
    "deepseek": ("DEEPSEEK_API_KEY",),
    "google": ("GOOGLE_API_KEY", "GEMINI_API_KEY"),
    "gemini": ("GOOGLE_API_KEY", "GEMINI_API_KEY"),
    "zhipu": ("ZHIPUAI_API_KEY", "GLM_API_KEY"),
    "z.ai": ("ZHIPUAI_API_KEY", "GLM_API_KEY"),
    "glm": ("ZHIPUAI_API_KEY", "GLM_API_KEY"),
    "openai": ("OPENAI_API_KEY",),
    "xai": ("XAI_API_KEY",),
    "anthropic": ("ANTHROPIC_API_KEY",),
}

_dotenv_loaded = False


def ensure_project_dotenv_loaded() -> None:
    """Load backend/.env into os.environ when keys are missing."""
    global _dotenv_loaded
    if _dotenv_loaded:
        return
    try:
        from dotenv import load_dotenv

        load_dotenv(BACKEND_ENV_PATH, override=False)
        load_dotenv(ROOT_ENV_PATH, override=False)
    except Exception as exc:
        logger.debug("dotenv load skipped: %s", exc)
    _dotenv_loaded = True


def _first_env(*names: str) -> str:
    for name in names:
        value = (os.getenv(name) or "").strip()
        if value:
            return value
    return ""


def collect_hermes_credentials() -> Dict[str, str]:
    """Collect Hermes-compatible env vars from the project configuration."""
    ensure_project_dotenv_loaded()
    creds: Dict[str, str] = {}

    for hermes_var, sources in _HERMES_KEY_SOURCES.items():
        value = _first_env(*sources)
        if value:
            creds[hermes_var] = value

    try:
        from core.llm_provider import PROVIDERS, get_api_key, get_provider_id

        alibaba_key = get_api_key("alibaba")
        if alibaba_key:
            creds["DASHSCOPE_API_KEY"] = alibaba_key
            creds["ALIBABA_API_KEY"] = alibaba_key
            base_url = PROVIDERS["alibaba"].base_url.rstrip("/")
            creds["DASHSCOPE_BASE_URL"] = base_url

        pid = get_provider_id()
        if pid in PROVIDERS and pid != "alibaba":
            key = get_api_key(pid)
            if key:
                cfg = PROVIDERS[pid]
                creds[cfg.api_key_env] = key
                for extra in getattr(cfg, "extra_keys", ()) or ():
                    creds[extra] = key
                base = (cfg.base_url or "").rstrip("/")
                if base:
                    base_env = _provider_base_url_env(pid)
                    if base_env:
                        creds[base_env] = base
    except Exception as exc:
        logger.debug("llm_provider bridge skipped: %s", exc)

    return {k: v for k, v in creds.items() if v}


def _provider_base_url_env(provider_id: str) -> str:
    mapping = {
        "alibaba": "DASHSCOPE_BASE_URL",
        "deepseek": "DEEPSEEK_BASE_URL",
        "openrouter": "OPENROUTER_BASE_URL",
    }
    return mapping.get(provider_id, "")


def build_hermes_env(base: Optional[Dict[str, str]] = None) -> Dict[str, str]:
    """Merge process env with bridged project credentials for Hermes subprocesses."""
    env = dict(base or os.environ)
    bridged = collect_hermes_credentials()
    env.update(bridged)
    return env


def credentials_ready_for_provider(provider: str) -> bool:
    """Return True when project env can satisfy the active Hermes provider."""
    creds = collect_hermes_credentials()
    provider_lower = (provider or "").strip().lower()
    if not provider_lower:
        return bool(creds.get("DASHSCOPE_API_KEY") or creds.get("OPENROUTER_API_KEY"))

    for token, keys in _PROVIDER_KEY_MAP.items():
        if token in provider_lower:
            return any(creds.get(k) for k in keys)
    return False


def _parse_dotenv(text: str) -> Dict[str, str]:
    result: Dict[str, str] = {}
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if "=" not in stripped:
            continue
        key, _, value = stripped.partition("=")
        result[key.strip()] = value.strip().strip('"').strip("'")
    return result


def _render_dotenv(values: Dict[str, str]) -> str:
    lines: List[str] = []
    for key in sorted(values.keys()):
        value = values[key]
        if not value:
            continue
        if re.search(r"\s|#|\"|'", value):
            escaped = value.replace("\\", "\\\\").replace('"', '\\"')
            lines.append(f'{key}="{escaped}"')
        else:
            lines.append(f"{key}={value}")
    return "\n".join(lines) + ("\n" if lines else "")


def sync_hermes_dotenv(*, force_base_url: bool = True) -> Dict[str, Any]:
    """Write missing project credentials into ~/.hermes/.env for Gateway/launchd."""
    bridged = collect_hermes_credentials()
    if not bridged:
        return {"synced": False, "reason": "no project credentials", "keys": []}

    existing: Dict[str, str] = {}
    if HERMES_DOTENV.exists():
        try:
            existing = _parse_dotenv(HERMES_DOTENV.read_text(encoding="utf-8"))
        except Exception as exc:
            logger.warning("Failed to read %s: %s", HERMES_DOTENV, exc)

    updated_keys: List[str] = []
    merged = dict(existing)
    for key, value in bridged.items():
        if not value:
            continue
        if key == "DASHSCOPE_BASE_URL" and force_base_url:
            if merged.get(key) != value:
                merged[key] = value
                updated_keys.append(key)
            continue
        if not (merged.get(key) or "").strip():
            merged[key] = value
            updated_keys.append(key)

    if not updated_keys:
        return {"synced": True, "reason": "already up to date", "keys": []}

    try:
        HERMES_HOME.mkdir(parents=True, exist_ok=True)
        header = "# Synced from AI Media Agent backend/.env — do not commit\n"
        body = _render_dotenv(merged)
        HERMES_DOTENV.write_text(header + body, encoding="utf-8")
        logger.info("Synced Hermes credentials: %s", ", ".join(updated_keys))
        return {"synced": True, "reason": "updated", "keys": updated_keys}
    except Exception as exc:
        logger.error("Failed to sync ~/.hermes/.env: %s", exc)
        return {"synced": False, "reason": str(exc), "keys": updated_keys}


def credential_bridge_status() -> Dict[str, Any]:
    """Summary for UI/API — which keys were bridged without exposing values."""
    creds = collect_hermes_credentials()
    return {
        "source": str(BACKEND_ENV_PATH),
        "keys": sorted(creds.keys()),
        "has_dashscope": bool(creds.get("DASHSCOPE_API_KEY")),
        "dashscope_base_url": creds.get("DASHSCOPE_BASE_URL", ""),
        "ready_for_qwen": credentials_ready_for_provider("qwen cloud"),
    }
