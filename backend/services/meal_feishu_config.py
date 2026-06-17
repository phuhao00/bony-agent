"""餐费 · 飞书配置（lark-cli 模式或本地 feishu_config.json）"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).parent.parent.parent


def get_storage_dir() -> Path:
    """打包版 Electron 通过 STORAGE_DIR 指向 ~/Library/.../ai-media-agent/storage。"""
    raw = os.environ.get("STORAGE_DIR", "").strip()
    if raw:
        return Path(raw)
    return PROJECT_ROOT / "storage"


def get_feishu_config_path() -> Path:
    return get_storage_dir() / "meal" / "feishu_config.json"


_CONFIG_PATH = get_feishu_config_path()

_DEFAULT: dict[str, Any] = {
    "app_id": "",
    "app_secret": "",
    "verification_token": "",
    "encrypt_key": "",
    "use_lark_cli": False,
    "reminder_enabled": False,
    "reminder_chat_id": "",
    "reminder_chat_name": "",
    "reminder_hour": 9,
    "reminder_minute": 0,
    "reminder_days": "mon-fri",
    "reminder_extra_text": "",
    "ops_enabled": True,
    "ops_admin_open_ids": [],
    "ops_auto_jenkins_build": True,
    "ops_auto_jenkins_require_admin": True,
    "ops_auto_jenkins_min_confidence": 0.65,
    "ops_auto_jenkins_context_hours": 1.0,
    "ops_auto_jenkins_cooldown_sec": 90,
    "jenkins": {
        "enabled": False,
        "url": "",
        "username": "",
        "allowed_jobs": [],
        "poll_timeout_sec": 120,
        "console_max_chars": 8000,
    },
}


def _merge_env(data: dict) -> dict:
    out = dict(data)
    if not out.get("app_id"):
        out["app_id"] = os.getenv("FEISHU_APP_ID", "")
    if not out.get("app_secret"):
        out["app_secret"] = os.getenv("FEISHU_APP_SECRET", "")
    if not out.get("verification_token"):
        out["verification_token"] = os.getenv("FEISHU_VERIFICATION_TOKEN", "")
    if not out.get("encrypt_key"):
        out["encrypt_key"] = os.getenv("FEISHU_ENCRYPT_KEY", "")
    return out


def load_config() -> dict:
    path = get_feishu_config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                merged = {**_DEFAULT, **data}
                if isinstance(data.get("jenkins"), dict):
                    merged["jenkins"] = {
                        **_DEFAULT.get("jenkins", {}),
                        **data["jenkins"],
                    }
                if "use_lark_cli" not in data and merged.get("app_id") and not merged.get("app_secret"):
                    merged["use_lark_cli"] = False
                return _merge_env(merged)
        except Exception:
            pass
    return _merge_env(dict(_DEFAULT))


def save_config(patch: dict) -> dict:
    cur = load_config()
    for k in ("app_id", "app_secret", "verification_token", "encrypt_key"):
        if k in patch and patch[k] is not None:
            cur[k] = str(patch[k]).strip()
    if "use_lark_cli" in patch:
        cur["use_lark_cli"] = bool(patch["use_lark_cli"])
    if "reminder_enabled" in patch and patch["reminder_enabled"] is not None:
        cur["reminder_enabled"] = bool(patch["reminder_enabled"])
    for k in ("reminder_chat_id", "reminder_chat_name", "reminder_days", "reminder_extra_text"):
        if k in patch and patch[k] is not None:
            cur[k] = str(patch[k]).strip()
    for k in ("reminder_hour", "reminder_minute"):
        if k in patch and patch[k] is not None:
            try:
                cur[k] = int(patch[k])
            except (TypeError, ValueError):
                pass
    if "ops_enabled" in patch and patch["ops_enabled"] is not None:
        cur["ops_enabled"] = bool(patch["ops_enabled"])
    if "ops_admin_open_ids" in patch and patch["ops_admin_open_ids"] is not None:
        raw = patch["ops_admin_open_ids"]
        if isinstance(raw, list):
            cur["ops_admin_open_ids"] = [str(x).strip() for x in raw if str(x).strip()]
        elif isinstance(raw, str):
            cur["ops_admin_open_ids"] = [
                x.strip() for x in raw.replace("\n", ",").split(",") if x.strip()
            ]
    for k in (
        "ops_auto_jenkins_build",
        "ops_auto_jenkins_require_admin",
    ):
        if k in patch and patch[k] is not None:
            cur[k] = bool(patch[k])
    for k in ("ops_auto_jenkins_min_confidence", "ops_auto_jenkins_context_hours"):
        if k in patch and patch[k] is not None:
            try:
                cur[k] = float(patch[k])
            except (TypeError, ValueError):
                pass
    if "ops_auto_jenkins_cooldown_sec" in patch and patch["ops_auto_jenkins_cooldown_sec"] is not None:
        try:
            cur["ops_auto_jenkins_cooldown_sec"] = int(patch["ops_auto_jenkins_cooldown_sec"])
        except (TypeError, ValueError):
            pass
    if "jenkins" in patch and isinstance(patch["jenkins"], dict):
        from services.jenkins_config_store import normalize_allowed_jobs

        cur_j = cur.get("jenkins") if isinstance(cur.get("jenkins"), dict) else {}
        j_patch = dict(patch["jenkins"])
        if "allowed_jobs" in j_patch:
            jobs, err = normalize_allowed_jobs(j_patch["allowed_jobs"])
            if err:
                raise ValueError(err)
            j_patch["allowed_jobs"] = jobs
        cur["jenkins"] = {**_DEFAULT.get("jenkins", {}), **cur_j, **j_patch}
    path = get_feishu_config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    stored = {k: cur.get(k, _DEFAULT.get(k, "")) for k in _DEFAULT}
    path.write_text(json.dumps(stored, ensure_ascii=False, indent=2), encoding="utf-8")
    return load_config()


def resolve_member_list_chat_id(chat_id: str = "") -> tuple[str, str, str]:
    """
    餐费姓名选择用群 ID：显式参数 > feishu_config.reminder_chat_id > 机器人首个群（回退）。
    返回 (chat_id, error, source)。
    """
    explicit = (chat_id or "").strip()
    if explicit:
        return explicit, "", "query"
    cfg = load_config()
    saved = str(cfg.get("reminder_chat_id") or "").strip()
    if saved:
        return saved, "", "reminder"
    try:
        from services import meal_feishu_lark_cli as lc

        if not lc.is_installed():
            return "", "未安装 lark-cli，请先在上方完成飞书连接", ""
        chats, err = lc.list_bot_group_chats()
        if chats:
            first = str(chats[0].get("chat_id") or "").strip()
            if first:
                return first, "", "auto_first_group"
        return "", err or "请先在「群聊定时提醒」中选择提醒群，或先将机器人拉入目标群", ""
    except Exception as e:
        return "", str(e)[:200], ""


def uses_lark_cli() -> bool:
    return bool(load_config().get("use_lark_cli"))


def is_configured() -> bool:
    c = load_config()
    if c.get("use_lark_cli"):
        try:
            from services.meal_feishu_lark_cli import lark_cli_app_ready

            return lark_cli_app_ready()
        except Exception:
            return bool(c.get("app_id"))
    return bool(c.get("app_id") and c.get("app_secret"))
