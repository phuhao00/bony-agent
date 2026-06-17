"""Chat Platform Bridge — 配置持久化。"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from services.meal_feishu_config import get_storage_dir
from utils.logger import setup_logger

logger = setup_logger("chat_platform.config_store")

_CONFIG_FILENAME = "chat_platform_config.json"

_DEFAULT: dict[str, Any] = {
    "feishu": {
        "enabled": True,
        "webhook_url": "",
        "verification_token": "",
        "encrypt_key": "",
    },
    "discord": {
        "enabled": False,
        "bot_token": "",
    },
    "common": {
        "default_agent_id": "media_agent",
        "rate_limit_enabled": True,
        "rate_limit_per_sender": 20,
        "rate_limit_window": 60,
    },
}


def _config_path() -> Path:
    return Path(get_storage_dir()) / _CONFIG_FILENAME


def load_config() -> dict[str, Any]:
    path = _config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    data: dict[str, Any] = {}
    if path.exists():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:
            logger.warning(f"[chat_platform] config load failed: {exc}")
    merged = _deep_merge(dict(_DEFAULT), data)
    _apply_env_overrides(merged)
    return merged


def save_config(patch: dict[str, Any]) -> dict[str, Any]:
    cur = load_config()
    updated = _deep_merge(cur, patch)
    path = _config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        path.write_text(json.dumps(updated, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception as exc:
        logger.error(f"[chat_platform] config save failed: {exc}")
        raise
    return load_config()


def get_public_config() -> dict[str, Any]:
    """返回前端可展示的配置（脱敏）。"""
    cfg = load_config()
    return {
        "feishu": {
            "enabled": cfg.get("feishu", {}).get("enabled", False),
            "configured": bool(
                cfg.get("feishu", {}).get("verification_token")
                or cfg.get("feishu", {}).get("encrypt_key")
            ),
        },
        "discord": {
            "enabled": cfg.get("discord", {}).get("enabled", False),
            "configured": bool(cfg.get("discord", {}).get("bot_token")),
            "token_masked": _mask_token(cfg.get("discord", {}).get("bot_token", "")),
        },
        "common": cfg.get("common", {}),
    }


def _mask_token(token: str) -> str:
    if not token:
        return ""
    if len(token) <= 8:
        return "****"
    return token[:4] + "****" + token[-4:]


def _deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    out = dict(base)
    for key, value in override.items():
        if key in out and isinstance(out[key], dict) and isinstance(value, dict):
            out[key] = _deep_merge(out[key], value)
        else:
            out[key] = value
    return out


def _apply_env_overrides(cfg: dict[str, Any]) -> None:
    """环境变量优先级高于配置文件。"""
    if os.getenv("CHAT_PLATFORM_FEISHU_ENABLED"):
        cfg.setdefault("feishu", {})["enabled"] = os.getenv("CHAT_PLATFORM_FEISHU_ENABLED", "").lower() in ("1", "true", "yes")
    if os.getenv("CHAT_PLATFORM_DISCORD_ENABLED"):
        cfg.setdefault("discord", {})["enabled"] = os.getenv("CHAT_PLATFORM_DISCORD_ENABLED", "").lower() in ("1", "true", "yes")
    if os.getenv("CHAT_PLATFORM_DISCORD_BOT_TOKEN"):
        cfg.setdefault("discord", {})["bot_token"] = os.getenv("CHAT_PLATFORM_DISCORD_BOT_TOKEN", "")
    if os.getenv("CHAT_PLATFORM_DEFAULT_AGENT_ID"):
        cfg.setdefault("common", {})["default_agent_id"] = os.getenv("CHAT_PLATFORM_DEFAULT_AGENT_ID", "")


def get_platform_config(platform: str) -> dict[str, Any]:
    return load_config().get(platform, {})


def get_common_config() -> dict[str, Any]:
    return load_config().get("common", {})
