"""Chat Platform Bridge — API 路由。"""

from __future__ import annotations

import os
from typing import Any

from fastapi import APIRouter, Request, Response, HTTPException
from pydantic import BaseModel, Field

from services.chat_platform.agent_bridge import handle_platform_message
from services.chat_platform.config_store import (
    get_public_config,
    load_config,
    save_config,
)
from services.chat_platform.discord_adapter import DiscordPlatformAdapter
from services.chat_platform.feishu_adapter import FeishuPlatformAdapter, verify_feishu_signature
from services.meal_feishu_config import is_configured as is_feishu_configured
from utils.logger import setup_logger

logger = setup_logger("chat_platform.router")

router = APIRouter(prefix="/chat-platform", tags=["chat_platform"])

_feishu_adapter: FeishuPlatformAdapter | None = None
_discord_adapter: DiscordPlatformAdapter | None = None


class ChatPlatformConfigUpdate(BaseModel):
    feishu: dict[str, Any] = Field(default_factory=dict)
    discord: dict[str, Any] = Field(default_factory=dict)
    common: dict[str, Any] = Field(default_factory=dict)


def _get_feishu_adapter() -> FeishuPlatformAdapter:
    global _feishu_adapter
    if _feishu_adapter is None:
        _feishu_adapter = FeishuPlatformAdapter()
    return _feishu_adapter


def _get_discord_adapter() -> DiscordPlatformAdapter:
    global _discord_adapter
    if _discord_adapter is None:
        _discord_adapter = DiscordPlatformAdapter()
    return _discord_adapter


@router.get("/config")
async def chat_platform_config() -> dict[str, Any]:
    """返回前端可展示的配置（脱敏）。"""
    return get_public_config()


@router.post("/config")
async def chat_platform_config_update(body: ChatPlatformConfigUpdate) -> dict[str, Any]:
    """更新配置。"""
    patch: dict[str, Any] = {}
    if body.feishu:
        patch["feishu"] = body.feishu
    if body.discord:
        patch["discord"] = body.discord
    if body.common:
        patch["common"] = body.common
    updated = save_config(patch)
    return {"ok": True, "config": get_public_config(), "saved": updated}


@router.get("/status")
async def chat_platform_status() -> dict[str, Any]:
    """返回各平台桥接状态。"""
    feishu = _get_feishu_adapter()
    discord = _get_discord_adapter()
    public_cfg = get_public_config()
    backend_url = os.getenv("PUBLIC_BACKEND_URL", "http://localhost:8000").rstrip("/")
    return {
        "feishu": {
            "enabled": feishu.enabled,
            "configured": is_feishu_configured(),
            "bridge_configured": public_cfg["feishu"]["configured"],
            "webhook_url": f"{backend_url}/chat-platform/webhook/feishu",
        },
        "discord": {
            "enabled": discord.enabled,
            "configured": public_cfg["discord"]["configured"],
        },
        "common": public_cfg["common"],
    }


@router.post("/webhook/feishu", response_model=None)
async def feishu_webhook(request: Request) -> Response | dict[str, Any]:
    """接收飞书事件推送（challenge / im.message.receive_v1）。"""
    adapter = _get_feishu_adapter()
    if not adapter.enabled:
        raise HTTPException(status_code=503, detail="Feishu chat platform bridge is disabled")

    body_bytes = await request.body()
    body_text = body_bytes.decode("utf-8")
    try:
        import json

        payload = json.loads(body_text) if body_text else {}
    except Exception:
        raise HTTPException(status_code=400, detail="invalid json")

    # challenge 验证
    challenge = (payload.get("challenge") or "") if isinstance(payload, dict) else ""
    if challenge:
        return {"challenge": challenge}

    # 可选签名校验
    signature = request.headers.get("X-Lark-Signature", "")
    timestamp = request.headers.get("X-Lark-Request-Timestamp", "")
    nonce = request.headers.get("X-Lark-Request-Nonce", "")
    if signature and not verify_feishu_signature(body_bytes, signature, timestamp, nonce):
        raise HTTPException(status_code=401, detail="invalid signature")

    event = payload.get("event") or payload
    msg = adapter.parse_event(event)
    if msg is None:
        return {"ok": True, "handled": False, "reason": "not_a_text_message"}

    result = await handle_platform_message(msg, adapter=adapter)
    return {"ok": True, **result}


@router.post("/webhook/discord/interactions")
async def discord_interactions(request: Request) -> Response:
    """Discord Interaction 端点（预留，用于后续 slash command / 按钮）。"""
    raise HTTPException(status_code=501, detail="Discord interactions not implemented yet")
