"""餐费 · 飞书 OpenAPI（lark-cli 或 httpx + 本地 Secret）"""
from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from urllib.parse import quote

import httpx

from services.meal_feishu_config import load_config, uses_lark_cli

logger = logging.getLogger(__name__)

API_BASE = "https://open.feishu.cn/open-apis"
_client = httpx.Client(trust_env=False, timeout=60.0)

_token = ""
_token_expire = 0.0
_bot_open_id = ""
_user_cache: dict[str, str] = {}


def _cfg() -> dict:
    return load_config()


def _lark():
    from services import meal_feishu_lark_cli as lc

    return lc


def get_app_access_token(force: bool = False) -> str:
    if uses_lark_cli():
        return "lark-cli"
    global _token, _token_expire
    c = _cfg()
    if not c.get("app_id") or not c.get("app_secret"):
        return ""
    now = time.time()
    if not force and _token and now < _token_expire:
        return _token
    try:
        r = _client.post(
            f"{API_BASE}/auth/v3/app_access_token/internal",
            json={"app_id": c["app_id"], "app_secret": c["app_secret"]},
        )
        d = r.json()
        tok = d.get("app_access_token", "")
        if tok:
            _token = tok
            _token_expire = now + max(int(d.get("expire", 7200)) - 60, 60)
            return tok
    except Exception as e:
        logger.error(f"[meal_feishu] token 失败: {e}")
    return ""


def reset_client_cache() -> None:
    global _token, _token_expire, _bot_open_id, _user_cache
    _token = ""
    _token_expire = 0.0
    _bot_open_id = ""
    _user_cache.clear()


def get_bot_open_id() -> str:
    if uses_lark_cli():
        return _lark().get_bot_open_id()
    global _bot_open_id
    if _bot_open_id:
        return _bot_open_id
    tok = get_app_access_token()
    if not tok:
        return ""
    try:
        r = _client.get(
            f"{API_BASE}/bot/v3/info",
            headers={"Authorization": f"Bearer {tok}"},
        )
        d = r.json()
        if d.get("code") == 0 and d.get("bot"):
            _bot_open_id = d["bot"].get("open_id", "") or ""
    except Exception as e:
        logger.warning(f"[meal_feishu] bot info: {e}")
    return _bot_open_id


def get_user_name(open_id: str, chat_id: str = "") -> str:
    if uses_lark_cli():
        return _lark().get_user_name(open_id, chat_id=chat_id)
    if not open_id or open_id == "unknown":
        return "用户"
    if open_id in _user_cache:
        return _user_cache[open_id]
    tok = get_app_access_token()
    if tok:
        try:
            r = _client.get(
                f"{API_BASE}/contact/v3/users/{quote(open_id, safe='')}",
                params={"user_id_type": "open_id"},
                headers={"Authorization": f"Bearer {tok}"},
            )
            d = r.json()
            if d.get("code") == 0:
                u = (d.get("data") or {}).get("user") or {}
                name = (u.get("name") or u.get("en_name") or "").strip()
                if name:
                    _user_cache[open_id] = name
                    return name
        except Exception:
            pass
    return "用户"


def reply_text(message_id: str, text: str) -> bool:
    if uses_lark_cli():
        return _lark().reply_text(message_id, text)
    tok = get_app_access_token()
    if not tok:
        return False
    try:
        r = _client.post(
            f"{API_BASE}/im/v1/messages/{quote(message_id, safe='')}/reply",
            headers={"Authorization": f"Bearer {tok}"},
            json={
                "msg_type": "text",
                "content": json.dumps({"text": text}, ensure_ascii=False),
            },
        )
        d = r.json()
        return d.get("code") == 0
    except Exception as e:
        logger.error(f"[meal_feishu] reply 失败: {e}")
        return False


def download_message_resource(
    message_id: str, file_key: str, save_path: str, res_type: str = "image",
) -> bool:
    if uses_lark_cli():
        return _lark().download_message_resource(message_id, file_key, save_path, res_type)
    tok = get_app_access_token()
    if not tok:
        return False
    try:
        r = _client.get(
            f"{API_BASE}/im/v1/messages/{quote(message_id, safe='')}/resources/{quote(file_key, safe='')}",
            params={"type": res_type},
            headers={"Authorization": f"Bearer {tok}"},
        )
        if r.status_code == 200 and r.content:
            p = Path(save_path)
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(r.content)
            return True
    except Exception as e:
        logger.error(f"[meal_feishu] download 失败: {e}")
    return False
