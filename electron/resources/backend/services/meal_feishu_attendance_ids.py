"""open_id → 飞书考勤 employee_id / employee_no（缓存 + 配置覆盖 + 通讯录 API）"""
from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from typing import Any, Literal, Optional
from urllib.parse import quote

from services.meal_feishu_config import PROJECT_ROOT, load_config, uses_lark_cli

logger = logging.getLogger(__name__)

_CACHE_PATH = PROJECT_ROOT / "storage" / "meal" / "feishu_attendance_id_cache.json"
_BATCH = 50

AttendanceIdType = Literal["employee_id", "employee_no"]

_MISSING_SCOPE_HINT = (
    "无法解析考勤用户 ID：请在飞书开放平台为应用开通 "
    "contact:user.employee_id:readonly（或 contact:user.employee:readonly），"
    "或在 storage/meal/feishu_config.json 配置 attendance_user_id_map"
)


def _cache_load() -> dict[str, dict[str, str]]:
    if not _CACHE_PATH.exists():
        return {}
    try:
        raw = json.loads(_CACHE_PATH.read_text(encoding="utf-8"))
        if isinstance(raw, dict):
            return {k: v for k, v in raw.items() if isinstance(v, dict)}
    except Exception as e:
        logger.debug("[meal_attendance_ids] cache read: %s", e)
    return {}


def _cache_save(data: dict[str, dict[str, str]]) -> None:
    _CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    _CACHE_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _config_maps() -> tuple[dict[str, str], dict[str, str]]:
    cfg = load_config()
    uid_map = cfg.get("attendance_user_id_map") or {}
    no_map = cfg.get("attendance_employee_no_map") or {}
    if not isinstance(uid_map, dict):
        uid_map = {}
    if not isinstance(no_map, dict):
        no_map = {}
    return (
        {str(k).strip(): str(v).strip() for k, v in uid_map.items() if k and v},
        {str(k).strip(): str(v).strip() for k, v in no_map.items() if k and v},
    )


def remember_attendance_ids(
    open_id: str,
    *,
    user_id: str = "",
    employee_no: str = "",
) -> None:
    oid = (open_id or "").strip()
    if not oid.startswith("ou_"):
        return
    uid = (user_id or "").strip()
    eno = (employee_no or "").strip()
    if not uid and not eno:
        return
    cache = _cache_load()
    row = dict(cache.get(oid) or {})
    if uid:
        row["user_id"] = uid
    if eno:
        row["employee_no"] = eno
    row["updated_at"] = str(int(time.time()))
    cache[oid] = row
    _cache_save(cache)


def _fetch_user_from_contact(open_id: str) -> dict[str, Any]:
    if not uses_lark_cli():
        return {}
    from services import meal_feishu_lark_cli as lc

    code, body, _ = lc.api_request(
        "GET",
        f"/open-apis/contact/v3/users/{quote(open_id, safe='')}",
        params={"user_id_type": "open_id"},
        as_who="bot",
    )
    if code == 0 and body and body.get("code") == 0:
        user = (body.get("data") or {}).get("user") or {}
        return user if isinstance(user, dict) else {}
    return {}


def _fetch_users_batch(open_ids: list[str]) -> dict[str, dict[str, Any]]:
    if not open_ids or not uses_lark_cli():
        return {}
    from services import meal_feishu_lark_cli as lc

    out: dict[str, dict[str, Any]] = {}
    for i in range(0, len(open_ids), _BATCH):
        chunk = open_ids[i : i + _BATCH]
        code, body, _ = lc.api_request(
            "GET",
            "/open-apis/contact/v3/users/batch",
            params={
                "user_ids": ",".join(chunk),
                "user_id_type": "open_id",
            },
            as_who="bot",
            timeout=60,
        )
        if code != 0 or not body or body.get("code") != 0:
            continue
        for user in (body.get("data") or {}).get("items") or []:
            if isinstance(user, dict):
                oid = str(user.get("open_id") or "").strip()
                if oid:
                    out[oid] = user
    return out


def resolve_attendance_identity(open_id: str) -> tuple[str, AttendanceIdType, str]:
    """
    返回 (考勤 API 用的 id, id 类型, 说明/错误提示)。
    无可用 id 时 id 为空，说明非空。
    """
    oid = (open_id or "").strip()
    if not oid.startswith("ou_"):
        return "", "employee_id", "非飞书 open_id"

    cfg_uid, cfg_no = _config_maps()
    if cfg_uid.get(oid):
        remember_attendance_ids(oid, user_id=cfg_uid[oid])
        return cfg_uid[oid], "employee_id", ""
    if cfg_no.get(oid):
        remember_attendance_ids(oid, employee_no=cfg_no[oid])
        return cfg_no[oid], "employee_no", ""

    cache = _cache_load().get(oid) or {}
    if cache.get("user_id"):
        return cache["user_id"], "employee_id", ""
    if cache.get("employee_no"):
        return cache["employee_no"], "employee_no", ""

    user = _fetch_user_from_contact(oid)
    uid = str(user.get("user_id") or "").strip()
    eno = str(user.get("employee_no") or "").strip()
    if uid or eno:
        remember_attendance_ids(oid, user_id=uid, employee_no=eno)
        if uid:
            return uid, "employee_id", ""
        return eno, "employee_no", ""

    return "", "employee_id", _MISSING_SCOPE_HINT


def batch_resolve_attendance_identities(
    open_ids: list[str],
) -> dict[str, tuple[str, AttendanceIdType, str]]:
    """批量解析；优先缓存与配置，再批量通讯录。"""
    oids = sorted({o.strip() for o in open_ids if o.strip().startswith("ou_")})
    result: dict[str, tuple[str, AttendanceIdType, str]] = {}
    cfg_uid, cfg_no = _config_maps()
    cache = _cache_load()
    need_api: list[str] = []

    for oid in oids:
        if cfg_uid.get(oid):
            remember_attendance_ids(oid, user_id=cfg_uid[oid])
            result[oid] = (cfg_uid[oid], "employee_id", "")
            continue
        if cfg_no.get(oid):
            remember_attendance_ids(oid, employee_no=cfg_no[oid])
            result[oid] = (cfg_no[oid], "employee_no", "")
            continue
        row = cache.get(oid) or {}
        if row.get("user_id"):
            result[oid] = (row["user_id"], "employee_id", "")
            continue
        if row.get("employee_no"):
            result[oid] = (row["employee_no"], "employee_no", "")
            continue
        need_api.append(oid)

    if need_api:
        users = _fetch_users_batch(need_api)
        for oid in need_api:
            user = users.get(oid) or _fetch_user_from_contact(oid)
            uid = str(user.get("user_id") or "").strip()
            eno = str(user.get("employee_no") or "").strip()
            if uid or eno:
                remember_attendance_ids(oid, user_id=uid, employee_no=eno)
                if uid:
                    result[oid] = (uid, "employee_id", "")
                else:
                    result[oid] = (eno, "employee_no", "")
            else:
                result[oid] = ("", "employee_id", _MISSING_SCOPE_HINT)

    return result


def name_to_open_id_map(chat_id: str = "") -> dict[str, str]:
    """提醒群成员：显示名(小写) -> open_id。"""
    cid = (chat_id or "").strip()
    if not cid:
        cfg = load_config()
        cid = (cfg.get("reminder_chat_id") or "").strip()
    if not cid:
        return {}
    from services.meal_feishu_lark_cli import list_chat_members

    members, err = list_chat_members(cid)
    if err:
        logger.debug("[meal_attendance_ids] chat members: %s", err[:120])
    out: dict[str, str] = {}
    for m in members:
        name = (m.get("name") or "").strip()
        oid = (m.get("open_id") or "").strip()
        if name and oid:
            key = name.lower()
            if key not in out:
                out[key] = oid
    return out


def resolve_record_open_id(record: dict, name_map: dict[str, str]) -> str:
    """将记录的 employee_id 规范为可用于考勤的 open_id。"""
    eid = (record.get("employee_id") or "").strip()
    if eid.startswith("ou_"):
        return eid
    name = (record.get("employee_name") or "").strip().lower()
    if name and name_map.get(name):
        return name_map[name]
    return eid
