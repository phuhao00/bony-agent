"""餐费 · 飞书员工资料（姓名、昵称、部门/团队）与 H5 免登。"""
from __future__ import annotations

import logging
from typing import Any, Optional
from urllib.parse import quote

import httpx

from services.meal_feishu_config import load_config, uses_lark_cli

logger = logging.getLogger(__name__)

API_BASE = "https://open.feishu.cn/open-apis"
_client = httpx.Client(trust_env=False, timeout=60.0)


def _department_name(dept_id: str) -> str:
    if not dept_id:
        return ""
    from services import meal_feishu_lark_cli as lc

    if uses_lark_cli():
        code, body, _ = lc.api_request(
            "GET",
            f"/open-apis/contact/v3/departments/{quote(dept_id, safe='')}",
            params={"department_id_type": "department_id"},
            as_who="bot",
        )
        if code == 0 and body and body.get("code") == 0:
            dep = (body.get("data") or {}).get("department") or {}
            return (dep.get("name") or "").strip()
        return ""

    from services.meal_feishu_api import get_app_access_token

    tok = get_app_access_token()
    if not tok or tok == "lark-cli":
        return ""
    try:
        r = _client.get(
            f"{API_BASE}/contact/v3/departments/{quote(dept_id, safe='')}",
            params={"department_id_type": "department_id"},
            headers={"Authorization": f"Bearer {tok}"},
        )
        d = r.json()
        if d.get("code") == 0:
            dep = (d.get("data") or {}).get("department") or {}
            return (dep.get("name") or "").strip()
    except Exception as e:
        logger.debug("[meal_profile] department %s: %s", dept_id[:8], e)
    return ""


def get_user_profile(open_id: str) -> dict[str, str]:
    """从通讯录拉取姓名、昵称、团队（主部门名，多级用 / 连接）。"""
    oid = (open_id or "").strip()
    empty = {
        "open_id": oid,
        "name": "",
        "nickname": "",
        "team": "",
        "departments": "",
    }
    if not oid:
        return empty

    user: dict[str, Any] = {}
    from services import meal_feishu_lark_cli as lc

    if uses_lark_cli():
        code, body, _ = lc.api_request(
            "GET",
            f"/open-apis/contact/v3/users/{quote(oid, safe='')}",
            params={"user_id_type": "open_id"},
            as_who="bot",
        )
        if code == 0 and body and body.get("code") == 0:
            user = (body.get("data") or {}).get("user") or {}
    else:
        from services.meal_feishu_api import get_app_access_token

        tok = get_app_access_token()
        if tok:
            try:
                r = _client.get(
                    f"{API_BASE}/contact/v3/users/{quote(oid, safe='')}",
                    params={"user_id_type": "open_id"},
                    headers={"Authorization": f"Bearer {tok}"},
                )
                d = r.json()
                if d.get("code") == 0:
                    user = (d.get("data") or {}).get("user") or {}
            except Exception as e:
                logger.warning("[meal_profile] user %s: %s", oid[:12], e)

    name = (user.get("name") or user.get("en_name") or "").strip()
    nickname = (user.get("nickname") or user.get("nick_name") or name or "").strip()
    dept_ids = user.get("department_ids") or []
    if not isinstance(dept_ids, list):
        dept_ids = []
    dept_names: list[str] = []
    for did in dept_ids[:6]:
        dn = _department_name(str(did))
        if dn and dn not in dept_names:
            dept_names.append(dn)
    team = dept_names[0] if dept_names else ""
    departments = " / ".join(dept_names)
    return {
        "open_id": oid,
        "name": name,
        "nickname": nickname,
        "team": team,
        "departments": departments,
    }


def open_id_to_attendance_user_id(open_id: str) -> str:
    """将 open_id 转为考勤 API 所需的 employee_id（管理后台 user_id）。"""
    from services.meal_feishu_attendance_ids import resolve_attendance_identity

    att_id, id_type, _ = resolve_attendance_identity(open_id)
    if id_type == "employee_id":
        return att_id
    return ""


def _exchange_auth_code_once(
    code: str,
    *,
    redirect_uri: str = "",
) -> tuple[Optional[dict[str, Any]], str]:
    payload: dict[str, str] = {"grant_type": "authorization_code", "code": code}
    ru = (redirect_uri or "").strip()
    if ru:
        payload["redirect_uri"] = ru

    if uses_lark_cli():
        from services import meal_feishu_lark_cli as lc

        code0, body, err = lc.api_request(
            "POST",
            "/open-apis/authen/v1/access_token",
            data=payload,
            as_who="bot",
        )
        if code0 != 0 or not body or body.get("code") != 0:
            detail = err or str((body or {}).get("msg") or "换取 user_access_token 失败")
            return None, detail[:300]
        return body.get("data") or {}, ""

    from services.meal_feishu_api import get_app_access_token

    tok = get_app_access_token()
    if not tok:
        return None, "飞书应用未配置"
    try:
        r = _client.post(
            f"{API_BASE}/authen/v1/access_token",
            headers={
                "Authorization": f"Bearer {tok}",
                "Content-Type": "application/json; charset=utf-8",
            },
            json=payload,
        )
        body = r.json()
        if body.get("code") != 0:
            return None, str(body.get("msg") or "换取 user_access_token 失败")[:300]
        return body.get("data") or {}, ""
    except Exception as e:
        return None, str(e)[:200]


def exchange_auth_code(
    code: str,
    redirect_uri: str = "",
    *,
    h5_jsapi: bool = False,
) -> tuple[Optional[dict[str, Any]], str]:
    """用飞书 H5 预授权码换取用户身份（含 open_id、姓名）。"""
    c = (code or "").strip()
    if not c:
        return None, "缺少授权码 code"

    ru = (redirect_uri or "").strip()
    attempts: list[str | None] = []
    if h5_jsapi:
        attempts.append(None)
        if ru:
            attempts.append(ru)
    else:
        if ru:
            attempts.append(ru)
        attempts.append(None)

    last_err = ""
    data: dict[str, Any] = {}
    for attempt_ru in attempts:
        data, last_err = _exchange_auth_code_once(c, redirect_uri=attempt_ru or "")
        if data:
            break
    if not data:
        return None, last_err or "换取身份失败"

    open_id = (data.get("open_id") or "").strip()
    name = (data.get("name") or data.get("en_name") or "").strip()
    if not open_id:
        return None, "未获取到用户 open_id"
    prof = get_user_profile(open_id)
    if name and not prof.get("name"):
        prof["name"] = name
    if name and not prof.get("nickname"):
        prof["nickname"] = name
    return prof, ""


def build_upload_session(
    *,
    open_id: str = "",
    name: str = "",
    nickname: str = "",
    team: str = "",
) -> dict[str, Any]:
    """生成上传页用的 token + 展示用 profile。"""
    from routers import meal_receipt_router as meal

    oid = (open_id or "").strip()
    if oid:
        prof = get_user_profile(oid)
        if name:
            prof["name"] = name
        if nickname:
            prof["nickname"] = nickname
        if team:
            prof["team"] = team
    else:
        prof = {
            "open_id": "",
            "name": (name or "").strip(),
            "nickname": (nickname or name or "").strip(),
            "team": (team or "").strip(),
            "departments": (team or "").strip(),
        }
    display_name = (prof.get("name") or prof.get("nickname") or "").strip()
    token = ""
    if prof.get("open_id"):
        token = meal.make_upload_token(
            prof["open_id"],
            display_name,
            nickname=prof.get("nickname") or "",
            team=prof.get("team") or prof.get("departments") or "",
        )
    return {
        "token": token,
        "profile": prof,
        "requires_manual_name": not bool(prof.get("open_id")),
    }


def session_from_token(token: str) -> tuple[Optional[dict[str, Any]], str]:
    from routers import meal_receipt_router as meal

    info = meal.verify_upload_token(token)
    if not info:
        return None, "链接已失效，请重新发送「餐费」"
    oid = (info.get("oid") or "").strip()
    prof: dict[str, str] = {
        "open_id": oid,
        "name": (info.get("name") or "").strip(),
        "nickname": (info.get("nickname") or info.get("name") or "").strip(),
        "team": (info.get("team") or "").strip(),
        "departments": (info.get("team") or "").strip(),
    }
    if oid:
        try:
            fresh = get_user_profile(oid)
            if fresh.get("name"):
                prof["name"] = fresh["name"]
            if fresh.get("nickname"):
                prof["nickname"] = fresh["nickname"]
            if fresh.get("team") or fresh.get("departments"):
                prof["team"] = fresh.get("team") or fresh.get("departments") or ""
                prof["departments"] = prof["team"]
        except Exception as e:
            logger.warning("[meal_profile] token 刷新通讯录失败: %s", e)
    display = (prof.get("name") or prof.get("nickname") or "").strip()
    out_token = ""
    if oid:
        out_token = meal.make_upload_token(
            oid,
            display,
            nickname=prof.get("nickname") or "",
            team=prof.get("team") or "",
        )
    return {
        "token": out_token,
        "profile": prof,
        "requires_manual_name": not bool(oid),
    }, ""


def session_from_auth_code(
    code: str,
    redirect_uri: str = "",
    *,
    h5_jsapi: bool = False,
) -> tuple[Optional[dict[str, Any]], str]:
    prof, err = exchange_auth_code(
        code,
        redirect_uri=redirect_uri,
        h5_jsapi=h5_jsapi,
    )
    if not prof:
        return None, err
    return build_upload_session(
        open_id=prof.get("open_id") or "",
        name=prof.get("name") or "",
        nickname=prof.get("nickname") or "",
        team=prof.get("team") or prof.get("departments") or "",
    ), ""


def personal_upload_url(open_id: str, name: str = "") -> str:
    return personal_meal_links(open_id, name).get("upload", "")


def personal_meal_links(open_id: str, name: str = "") -> dict[str, str]:
    """飞书「餐费」回复：上传入口 + 个人历史。"""
    from utils.meal_public_url import meal_upload_history_url, meal_upload_page_url
    from routers import meal_receipt_router as meal

    sess, _ = build_upload_session(open_id=open_id, name=name)
    tok = (sess.get("token") or "").strip()
    display = (name or (sess.get("profile") or {}).get("name") or "").strip()
    upload = meal_upload_page_url()
    if tok:
        upload = f"{upload}?token={tok}"
    history = meal_upload_history_url(token=tok, employee_name=display)
    return {"upload": upload, "history": history, "token": tok}
