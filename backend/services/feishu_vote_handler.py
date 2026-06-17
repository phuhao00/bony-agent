"""飞书投票 · 卡片回调与事件分发。"""
from __future__ import annotations

import logging
from typing import Any, Optional

from services import feishu_vote_service as vote

logger = logging.getLogger(__name__)


def _parse_json_value(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw.strip():
        try:
            import json

            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            pass
    return {}


def _extract_action_value(event: dict[str, Any]) -> dict[str, Any]:
    action = event.get("action") or {}
    if isinstance(action, dict):
        return _parse_json_value(action.get("value"))
    return {}


def _extract_operator(event: dict[str, Any]) -> tuple[str, str]:
    op = event.get("operator") or {}
    if not isinstance(op, dict):
        return "", ""
    open_id = str(op.get("open_id") or "").strip()
    name = str(op.get("name") or op.get("user_name") or "").strip()
    return open_id, name


def handle_card_action_event(event: dict[str, Any]) -> Optional[dict[str, Any]]:
    """处理 card.action.trigger，返回飞书回调响应体。"""
    action_val = _extract_action_value(event)
    if action_val.get("action") != vote.VOTE_ACTION:
        return None

    poll_id = str(action_val.get("poll_id") or "").strip()
    option_id = str(action_val.get("option_id") or "").strip()
    voter_id, voter_name = _extract_operator(event)

    if not poll_id or not option_id:
        return _callback_response("error", "参数无效")

    if not voter_id:
        return _callback_response("error", "无法识别投票人")

    result = vote.record_vote(poll_id, option_id, voter_id, voter_name)
    toast_type = "success" if result.get("ok") else "error"
    toast_msg = result.get("toast") or result.get("error") or "操作失败"
    card = result.get("card") if result.get("ok") else None
    return _callback_response(toast_type, toast_msg, card=card)


def _callback_response(
    toast_type: str,
    toast_msg: str,
    *,
    card: Optional[dict] = None,
) -> dict[str, Any]:
    """飞书卡片回调 JSON 响应（HTTP 或 lark-cli 事件响应）。"""
    body: dict[str, Any] = {
        "toast": {
            "type": toast_type,
            "content": toast_msg,
            "i18n": {"zh_cn": toast_msg},
        }
    }
    if card:
        body["card"] = {"type": "raw", "data": card}
    return body


def dispatch_platform_event(body: dict[str, Any]) -> Optional[dict[str, Any]]:
    """统一处理开放平台回调 / lark-cli NDJSON / 长连接事件。"""
    if not isinstance(body, dict):
        return None

    header = body.get("header") or {}
    event_type = str(
        header.get("event_type") or body.get("event_type") or ""
    ).strip()

    if event_type != "card.action.trigger":
        return None

    event = body.get("event")
    if isinstance(event, dict):
        return handle_card_action_event(event)
    if body.get("action"):
        return handle_card_action_event(body)
    return None


def build_lark_oapi_card_response(result: Optional[dict[str, Any]]):
    """将 dict 响应转为 lark-oapi P2CardActionTriggerResponse。"""
    from lark_oapi.event.callback.model.p2_card_action_trigger import (
        CallBackCard,
        CallBackToast,
        P2CardActionTriggerResponse,
    )

    resp = P2CardActionTriggerResponse()
    if not result:
        return resp

    toast = result.get("toast") or {}
    if isinstance(toast, dict) and toast.get("content"):
        t = CallBackToast()
        t.type = str(toast.get("type") or "info")
        t.content = str(toast.get("content") or "")
        i18n = toast.get("i18n")
        if isinstance(i18n, dict):
            t.i18n = i18n
        resp.toast = t

    card_wrap = result.get("card")
    if isinstance(card_wrap, dict) and card_wrap.get("data"):
        c = CallBackCard()
        c.type = str(card_wrap.get("type") or "raw")
        c.data = card_wrap.get("data")
        resp.card = c
    return resp
