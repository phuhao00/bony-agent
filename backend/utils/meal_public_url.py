"""餐费模块对外 Web 根地址（与 start_with_tunnel.sh 注入的环境变量一致）。"""
from __future__ import annotations

import os


_DEFAULT_PACKAGED_WEB_BASE = "https://tech-huhao.tech"


def meal_public_web_base() -> str:
    """优先 MEAL_WEB_BASE_URL / Tunnel 域名，避免群消息里出现 localhost。"""
    for key in (
        "MEAL_WEB_BASE_URL",
        "PUBLIC_BASE_URL",
        "CLOUDFLARE_FRONTEND_DOMAIN",
        "NEXT_PUBLIC_APP_URL",
        "FRONTEND_PUBLIC_URL",
    ):
        raw = (os.getenv(key) or "").strip()
        if raw:
            return raw.rstrip("/")
    # Electron 桌面包：本地跑 :3000，但飞书群链接需公网域名（Cloudflare Tunnel）
    if (os.getenv("AI_MEDIA_AGENT_HOME") or "").strip():
        return _DEFAULT_PACKAGED_WEB_BASE
    return "http://localhost:3000"


def meal_upload_page_url() -> str:
    return f"{meal_public_web_base()}/meal/upload"


def meal_upload_history_url(*, token: str = "", employee_name: str = "") -> str:
    """个人餐费提交历史（携带 token 或姓名）。"""
    from urllib.parse import quote

    base = f"{meal_public_web_base().rstrip('/')}/meal/upload/history"
    t = (token or "").strip()
    if t:
        return f"{base}?token={quote(t, safe='')}"
    name = (employee_name or "").strip()
    if name:
        return f"{base}?name={quote(name, safe='')}"
    return base
