"""TAPD 缺陷创建、查询统计与飞书通知。"""
from __future__ import annotations

import os
import re
from collections import Counter
from datetime import datetime, timedelta
from typing import Any, Optional

import requests

from utils.logger import setup_logger

logger = setup_logger("tapd_service")

TAPD_API_BASE = os.getenv("TAPD_API_BASE", "https://api.tapd.cn").rstrip("/")
TAPD_UPLOAD_API_BASE = os.getenv("TAPD_UPLOAD_API_BASE", TAPD_API_BASE).rstrip("/")
TAPD_WEB_BASE = os.getenv("TAPD_WEB_BASE", "https://www.tapd.cn").rstrip("/")

BUG_LIST_FIELDS = (
    "id,title,status,v_status,priority,priority_label,"
    "current_owner,reporter,created,modified,closed"
)

STATUS_LABELS: dict[str, str] = {
    "new": "新建",
    "in_progress": "处理中",
    "resolved": "已解决",
    "verified": "已验证",
    "reopened": "重新打开",
    "closed": "已关闭",
    "suspended": "挂起",
    "rejected": "已拒绝",
    "postponed": "延期",
}

PRIORITY_LABELS: dict[str, str] = {
    "urgent": "紧急",
    "high": "高",
    "medium": "中",
    "low": "低",
}

CLOSED_STATUSES = frozenset({"closed", "rejected"})


def tapd_configured() -> bool:
    ws = (os.getenv("TAPD_WORKSPACE_ID") or "").strip()
    user = (os.getenv("TAPD_API_USER") or "").strip()
    pwd = (os.getenv("TAPD_API_PASSWORD") or "").strip()
    token = (os.getenv("TAPD_ACCESS_TOKEN") or "").strip()
    return bool(ws and ((user and pwd) or token))


def tapd_status() -> dict[str, Any]:
    ws = (os.getenv("TAPD_WORKSPACE_ID") or "").strip()
    return {
        "configured": tapd_configured(),
        "workspace_id": ws,
        "web_base": TAPD_WEB_BASE,
        "has_basic_auth": bool(
            (os.getenv("TAPD_API_USER") or "").strip()
            and (os.getenv("TAPD_API_PASSWORD") or "").strip()
        ),
        "has_token": bool((os.getenv("TAPD_ACCESS_TOKEN") or "").strip()),
    }


def bug_view_url(workspace_id: str, bug_id: str) -> str:
    wid = str(workspace_id).strip()
    bid = str(bug_id).strip()
    return f"{TAPD_WEB_BASE}/{wid}/bugtrace/bugs/view/{bid}"


def _auth_headers() -> dict[str, str]:
    token = (os.getenv("TAPD_ACCESS_TOKEN") or "").strip()
    if token:
        return {"Authorization": f"Bearer {token}"}
    return {}


def _auth_tuple() -> Optional[tuple[str, str]]:
    user = (os.getenv("TAPD_API_USER") or "").strip()
    pwd = (os.getenv("TAPD_API_PASSWORD") or "").strip()
    if user and pwd:
        return user, pwd
    return None


def _workspace_id() -> str:
    return (os.getenv("TAPD_WORKSPACE_ID") or "").strip()


def _tapd_credentials_error() -> Optional[str]:
    if not _workspace_id():
        return "未配置 TAPD_WORKSPACE_ID"
    if not tapd_configured():
        return "未配置 TAPD 凭据（TAPD_API_USER + TAPD_API_PASSWORD 或 TAPD_ACCESS_TOKEN）"
    return None


def _tapd_get(path: str, params: dict[str, Any]) -> dict[str, Any]:
    """TAPD GET 请求，返回解析后的 JSON。"""
    err = _tapd_credentials_error()
    if err:
        return {"ok": False, "error": err}

    query = {"workspace_id": _workspace_id(), **params}
    headers = _auth_headers()
    auth = _auth_tuple()
    url = f"{TAPD_API_BASE}/{path.lstrip('/')}"

    try:
        resp = requests.get(url, params=query, headers=headers, auth=auth, timeout=60)
        data = resp.json() if resp.content else {}
    except Exception as e:
        logger.error("[tapd] GET %s failed: %s", path, e, exc_info=True)
        return {"ok": False, "error": f"TAPD 请求失败：{str(e)[:200]}"}

    if resp.status_code >= 400:
        msg = str(data.get("info") or data.get("message") or resp.text or resp.reason)
        return {"ok": False, "error": f"TAPD HTTP {resp.status_code}: {msg[:300]}"}

    if data.get("status") not in (1, "1", True):
        msg = str(data.get("info") or data.get("message") or "TAPD 返回失败")
        return {"ok": False, "error": msg[:300], "raw": data}

    return {"ok": True, "data": data.get("data"), "raw": data}


def _parse_bug_row(row: Any) -> dict[str, Any]:
    bug = row.get("Bug") if isinstance(row, dict) and "Bug" in row else row
    if not isinstance(bug, dict):
        return {}

    workspace_id = _workspace_id()
    bug_id = str(bug.get("id") or "").strip()
    status = str(bug.get("status") or "").strip()
    priority_key = str(bug.get("priority_label") or bug.get("priority") or "").strip()
    v_status = str(bug.get("v_status") or "").strip()

    return {
        "id": bug_id,
        "title": str(bug.get("title") or "").strip(),
        "status": status,
        "status_label": v_status or STATUS_LABELS.get(status, status or "未知"),
        "priority": priority_key,
        "priority_label": PRIORITY_LABELS.get(priority_key, priority_key or "未设置"),
        "current_owner": str(bug.get("current_owner") or "").strip() or "未分配",
        "reporter": str(bug.get("reporter") or "").strip() or "未知",
        "created": str(bug.get("created") or "").strip(),
        "modified": str(bug.get("modified") or "").strip(),
        "closed": str(bug.get("closed") or "").strip(),
        "url": bug_view_url(workspace_id, bug_id) if bug_id else "",
        "is_closed": status in CLOSED_STATUSES,
    }


def _created_range_param(created_start: str, created_end: str) -> str:
    start = (created_start or "").strip()
    end = (created_end or "").strip()
    if start and end:
        return f"{start}~{end}"
    if start:
        return f"{start}~"
    if end:
        return f"~{end}"
    return ""


def _range_from_days(range_days: int) -> tuple[str, str]:
    """根据近 N 天计算 created 起止（YYYY-MM-DD）。"""
    if range_days <= 0:
        return "", ""
    end = datetime.now().date()
    start = end - timedelta(days=max(1, range_days) - 1)
    return start.isoformat(), end.isoformat()


def count_bugs(**filters: Any) -> dict[str, Any]:
    params = {k: v for k, v in filters.items() if v not in (None, "")}
    result = _tapd_get("bugs/count", params)
    if not result.get("ok"):
        return result
    payload = result.get("data") or {}
    count = payload.get("count") if isinstance(payload, dict) else payload
    try:
        count_int = int(count)
    except (TypeError, ValueError):
        count_int = 0
    return {"ok": True, "count": count_int}


def list_bugs(
    *,
    page: int = 1,
    limit: int = 50,
    created_start: str = "",
    created_end: str = "",
    status: str = "",
    priority: str = "",
    title: str = "",
    current_owner: str = "",
    reporter: str = "",
    fields: str = BUG_LIST_FIELDS,
) -> dict[str, Any]:
    created = _created_range_param(created_start, created_end)
    params: dict[str, Any] = {
        "page": max(1, page),
        "limit": min(max(1, limit), 200),
        "fields": fields,
        "order": "created desc",
    }
    if created:
        params["created"] = created
    if status.strip():
        params["status"] = status.strip()
    if priority.strip():
        params["priority"] = priority.strip()
    if title.strip():
        params["title"] = title.strip()
    if current_owner.strip():
        params["current_owner"] = current_owner.strip()
    if reporter.strip():
        params["reporter"] = reporter.strip()

    result = _tapd_get("bugs", params)
    if not result.get("ok"):
        return result

    rows = result.get("data") or []
    if not isinstance(rows, list):
        rows = []
    bugs = [_parse_bug_row(r) for r in rows]
    bugs = [b for b in bugs if b.get("id")]
    return {
        "ok": True,
        "bugs": bugs,
        "page": params["page"],
        "limit": params["limit"],
        "count": len(bugs),
    }


def _tapd_list_filters(
    *,
    created_start: str = "",
    created_end: str = "",
    status: str = "",
    priority: str = "",
    title: str = "",
    current_owner: str = "",
    reporter: str = "",
) -> dict[str, str]:
    created = _created_range_param(created_start, created_end)
    out: dict[str, str] = {}
    if created:
        out["created"] = created
    if status.strip():
        out["status"] = status.strip()
    if priority.strip():
        out["priority"] = priority.strip()
    if title.strip():
        out["title"] = title.strip()
    if current_owner.strip():
        out["current_owner"] = current_owner.strip()
    if reporter.strip():
        out["reporter"] = reporter.strip()
    return out


def _bug_matches_client_filters(
    bug: dict[str, Any],
    *,
    keyword: str = "",
    owner_contains: str = "",
    reporter_contains: str = "",
    open_only: bool = False,
    closed_only: bool = False,
    priority_empty: bool = False,
) -> bool:
    if open_only and bug.get("is_closed"):
        return False
    if closed_only and not bug.get("is_closed"):
        return False
    if priority_empty and str(bug.get("priority") or "").strip():
        return False

    owner_q = owner_contains.strip().lower()
    if owner_q and owner_q not in str(bug.get("current_owner") or "").lower():
        return False

    reporter_q = reporter_contains.strip().lower()
    if reporter_q and reporter_q not in str(bug.get("reporter") or "").lower():
        return False

    kw = keyword.strip().lower()
    if not kw:
        return True

    haystack = " ".join(
        [
            str(bug.get("title") or ""),
            str(bug.get("id") or ""),
            str(bug.get("current_owner") or ""),
            str(bug.get("reporter") or ""),
            str(bug.get("status") or ""),
            str(bug.get("status_label") or ""),
            str(bug.get("priority") or ""),
            str(bug.get("priority_label") or ""),
        ]
    ).lower()
    return kw in haystack


def search_bugs(
    *,
    page: int = 1,
    limit: int = 50,
    range_days: int = 0,
    created_start: str = "",
    created_end: str = "",
    status: str = "",
    priority: str = "",
    keyword: str = "",
    current_owner: str = "",
    reporter: str = "",
    open_only: bool = False,
    closed_only: bool = False,
) -> dict[str, Any]:
    """分页查询缺陷，支持 TAPD 原生筛选 + 客户端模糊匹配。"""
    err = _tapd_credentials_error()
    if err:
        return {"ok": False, "error": err}

    start, end = (created_start.strip(), created_end.strip())
    if not start and not end and range_days > 0:
        start, end = _range_from_days(range_days)

    page = max(1, page)
    limit = min(max(1, limit), 200)
    kw = keyword.strip()
    owner_q = current_owner.strip()
    reporter_q = reporter.strip()
    priority_empty = priority.strip() == "unset"
    if priority_empty:
        priority = ""

    needs_client_filter = bool(kw or open_only or closed_only or priority_empty)
    owner_fuzzy = bool(owner_q)
    reporter_fuzzy = bool(reporter_q)

    tapd_filters = _tapd_list_filters(
        created_start=start,
        created_end=end,
        status=status,
        priority=priority,
        title=kw if kw and not needs_client_filter else "",
        current_owner="" if owner_fuzzy else owner_q,
        reporter="" if reporter_fuzzy else reporter_q,
    )

    if needs_client_filter or owner_fuzzy or reporter_fuzzy:
        fetched = _fetch_all_bugs_in_range(
            start,
            end,
            tapd_filters=tapd_filters,
            max_pages=50,
        )
        if not fetched.get("ok"):
            return fetched
        bugs_all = fetched.get("bugs") or []
        filtered = [
            b
            for b in bugs_all
            if _bug_matches_client_filters(
                b,
                keyword=kw,
                owner_contains=owner_q,
                reporter_contains=reporter_q,
                open_only=open_only,
                closed_only=closed_only,
                priority_empty=priority_empty,
            )
        ]
        total = len(filtered)
        start_idx = (page - 1) * limit
        page_bugs = filtered[start_idx : start_idx + limit]
        total_pages = max(1, (total + limit - 1) // limit) if total else 0
        return {
            "ok": True,
            "bugs": page_bugs,
            "page": page,
            "limit": limit,
            "total": total,
            "total_pages": total_pages,
            "truncated": bool(fetched.get("truncated")),
            "filter_mode": "client",
        }

    count_result = count_bugs(**tapd_filters)
    if not count_result.get("ok"):
        return count_result
    total = int(count_result.get("count") or 0)

    list_result = list_bugs(
        page=page,
        limit=limit,
        created_start=start,
        created_end=end,
        status=status,
        priority=priority,
        current_owner=owner_q,
        reporter=reporter_q,
    )
    if not list_result.get("ok"):
        return list_result

    total_pages = max(1, (total + limit - 1) // limit) if total else 0
    return {
        "ok": True,
        "bugs": list_result.get("bugs") or [],
        "page": page,
        "limit": limit,
        "total": total,
        "total_pages": total_pages,
        "truncated": False,
        "filter_mode": "tapd",
    }


def _fetch_all_bugs_in_range(
    created_start: str,
    created_end: str,
    *,
    tapd_filters: dict[str, str] | None = None,
    max_pages: int = 20,
) -> dict[str, Any]:
    all_bugs: list[dict[str, Any]] = []
    page = 1
    extra = tapd_filters or {}
    truncated = False
    while page <= max_pages:
        batch = list_bugs(
            page=page,
            limit=200,
            created_start=created_start,
            created_end=created_end,
            status=extra.get("status", ""),
            priority=extra.get("priority", ""),
            title=extra.get("title", ""),
            current_owner=extra.get("current_owner", ""),
            reporter=extra.get("reporter", ""),
        )
        if not batch.get("ok"):
            return batch
        rows = batch.get("bugs") or []
        if not rows:
            break
        all_bugs.extend(rows)
        if len(rows) < 200:
            break
        page += 1
    else:
        truncated = True

    return {"ok": True, "bugs": all_bugs, "truncated": truncated}


def _counter_to_rows(counter: Counter[str], label_map: dict[str, str]) -> list[dict[str, Any]]:
    total = sum(counter.values()) or 1
    rows: list[dict[str, Any]] = []
    for key, count in counter.most_common():
        rows.append(
            {
                "key": key,
                "label": label_map.get(key, key),
                "count": count,
                "percent": round(count * 100.0 / total, 1),
            }
        )
    return rows


def bug_stats_summary(
    *,
    range_days: int = 30,
    created_start: str = "",
    created_end: str = "",
) -> dict[str, Any]:
    """按时间范围汇总缺陷：总量、开闭、按状态/优先级/处理人/报告人分布。"""
    err = _tapd_credentials_error()
    if err:
        return {"ok": False, "error": err}

    workspace_id = _workspace_id()
    start, end = (created_start.strip(), created_end.strip())
    if not start and not end and range_days > 0:
        start, end = _range_from_days(range_days)

    total_all = count_bugs()
    if not total_all.get("ok"):
        return total_all

    if start or end:
        ranged = _fetch_all_bugs_in_range(start, end)
    else:
        ranged = _fetch_all_bugs_in_range("", "")

    if not ranged.get("ok"):
        return ranged

    bugs: list[dict[str, Any]] = ranged.get("bugs") or []
    total = len(bugs)
    open_count = sum(1 for b in bugs if not b.get("is_closed"))
    closed_count = total - open_count

    by_status: Counter[str] = Counter()
    by_priority: Counter[str] = Counter()
    by_owner: Counter[str] = Counter()
    by_reporter: Counter[str] = Counter()

    for b in bugs:
        by_status[b.get("status") or "unknown"] += 1
        pk = str(b.get("priority") or "").strip() or "unset"
        by_priority[pk] += 1
        by_owner[b.get("current_owner") or "未分配"] += 1
        by_reporter[b.get("reporter") or "未知"] += 1

    recent = sorted(
        bugs,
        key=lambda x: x.get("created") or "",
        reverse=True,
    )[:20]

    return {
        "ok": True,
        "workspace_id": workspace_id,
        "web_base": TAPD_WEB_BASE,
        "range": {
            "days": range_days if not (created_start or created_end) else None,
            "created_start": start or None,
            "created_end": end or None,
        },
        "summary": {
            "total_in_range": total,
            "total_all": total_all.get("count", 0),
            "open": open_count,
            "closed": closed_count,
            "open_rate": round(open_count * 100.0 / total, 1) if total else 0.0,
        },
        "by_status": _counter_to_rows(by_status, STATUS_LABELS),
        "by_priority": _counter_to_rows(
            by_priority,
            {**PRIORITY_LABELS, "unset": "未设置"},
        ),
        "by_owner": _counter_to_rows(by_owner, {}),
        "by_reporter": _counter_to_rows(by_reporter, {}),
        "recent_bugs": recent,
    }


def create_bug(
    *,
    title: str,
    description: str = "",
    priority_label: str = "",
    current_owner: str = "",
) -> dict[str, Any]:
    """创建 TAPD 缺陷，返回 {ok, bug_id, url, title, raw}。"""
    workspace_id = (os.getenv("TAPD_WORKSPACE_ID") or "").strip()
    if not workspace_id:
        return {"ok": False, "error": "未配置 TAPD_WORKSPACE_ID"}
    if not tapd_configured():
        return {
            "ok": False,
            "error": "未配置 TAPD 凭据（TAPD_API_USER + TAPD_API_PASSWORD 或 TAPD_ACCESS_TOKEN）",
        }

    t = (title or "").strip()
    if not t:
        return {"ok": False, "error": "缺陷标题不能为空"}

    payload: dict[str, str] = {
        "workspace_id": workspace_id,
        "title": t[:200],
    }
    desc = (description or "").strip()
    if desc:
        payload["description"] = desc[:8000]
    pl = (priority_label or "").strip()
    if pl:
        payload["priority_label"] = pl
    owner = (current_owner or "").strip()
    if owner:
        payload["current_owner"] = owner

    headers = {"Content-Type": "application/x-www-form-urlencoded", **_auth_headers()}
    auth = _auth_tuple()

    try:
        resp = requests.post(
            f"{TAPD_API_BASE}/bugs",
            data=payload,
            headers=headers,
            auth=auth,
            timeout=45,
        )
        data = resp.json() if resp.content else {}
    except Exception as e:
        logger.error("[tapd] create_bug failed: %s", e, exc_info=True)
        return {"ok": False, "error": f"TAPD 请求失败：{str(e)[:200]}"}

    if resp.status_code >= 400:
        msg = str(data.get("info") or data.get("message") or resp.text or resp.reason)
        return {"ok": False, "error": f"TAPD HTTP {resp.status_code}: {msg[:300]}"}

    status = data.get("status")
    if status not in (1, "1", True):
        msg = str(data.get("info") or data.get("message") or "TAPD 返回失败")
        return {"ok": False, "error": msg[:300], "raw": data}

    bug_obj = (data.get("data") or {}).get("Bug") or data.get("data") or {}
    if isinstance(bug_obj, list) and bug_obj:
        bug_obj = bug_obj[0]
    if not isinstance(bug_obj, dict):
        bug_obj = {}

    bug_id = str(bug_obj.get("id") or "").strip()
    if not bug_id:
        return {"ok": False, "error": "TAPD 未返回缺陷 ID", "raw": data}

    url = bug_view_url(workspace_id, bug_id)
    logger.info("[tapd] created bug %s %s", bug_id, t[:80])
    return {
        "ok": True,
        "bug_id": bug_id,
        "url": url,
        "title": str(bug_obj.get("title") or t),
        "raw": data,
    }


def upload_bug_attachment(
    *,
    bug_id: str,
    content: bytes,
    filename: str,
    content_type: str = "",
) -> dict[str, Any]:
    """上传单个缺陷附件到 TAPD。"""
    workspace_id = (os.getenv("TAPD_WORKSPACE_ID") or "").strip()
    if not workspace_id:
        return {"ok": False, "error": "未配置 TAPD_WORKSPACE_ID"}
    if not bug_id.strip():
        return {"ok": False, "error": "缺陷 ID 为空"}
    if not content:
        return {"ok": False, "error": "文件内容为空"}

    safe_name = (filename or "attachment.bin").strip()[:200]
    ctype = (content_type or "application/octet-stream").strip()
    data = {
        "workspace_id": workspace_id,
        "type": "bug",
        "entry_id": bug_id.strip(),
    }
    files = {"file": (safe_name, content, ctype)}
    headers = _auth_headers()
    auth = _auth_tuple()

    upload_urls = [
        f"{TAPD_UPLOAD_API_BASE}/files/upload_attachment",
        "https://api.tapd.cn/files/upload_attachment",
    ]
    last_err = ""
    for url in upload_urls:
        try:
            resp = requests.post(
                url,
                data=data,
                files=files,
                headers=headers,
                auth=auth,
                timeout=120,
            )
            body = resp.json() if resp.content else {}
        except Exception as e:
            last_err = str(e)[:200]
            continue

        if resp.status_code >= 400:
            last_err = str(body.get("info") or body.get("message") or resp.text)[:300]
            continue
        if body.get("status") not in (1, "1", True):
            last_err = str(body.get("info") or body.get("message") or "上传失败")[:300]
            continue

        att = (body.get("data") or {}).get("Attachment") or {}
        logger.info("[tapd] uploaded attachment %s for bug %s", safe_name, bug_id)
        return {
            "ok": True,
            "filename": str(att.get("filename") or safe_name),
            "attachment_id": str(att.get("id") or ""),
            "raw": body,
        }

    return {"ok": False, "error": last_err or "TAPD 附件上传失败"}


def upload_bug_attachments(
    bug_id: str,
    attachments: list[tuple[bytes, str, str]],
) -> tuple[list[dict[str, Any]], list[str]]:
    """批量上传附件，返回 (成功列表, 错误信息列表)。"""
    ok_rows: list[dict[str, Any]] = []
    errors: list[str] = []
    for content, filename, ctype in attachments:
        result = upload_bug_attachment(
            bug_id=bug_id,
            content=content,
            filename=filename,
            content_type=ctype,
        )
        if result.get("ok"):
            ok_rows.append(result)
        else:
            errors.append(f"{filename}: {result.get('error') or '上传失败'}")
    return ok_rows, errors


def build_feishu_mention_prefix(members: list[dict[str, str]]) -> str:
    parts: list[str] = []
    for m in members:
        oid = str(m.get("open_id") or "").strip()
        name = str(m.get("name") or oid or "成员").strip()
        if not oid:
            continue
        safe_name = re.sub(r"[<>]", "", name) or "成员"
        parts.append(f'<at user_id="{oid}">{safe_name}</at>')
    return " ".join(parts)


def notify_feishu_bug(
    *,
    chat_id: str,
    bug_title: str,
    bug_url: str,
    description: str = "",
    mentions: list[dict[str, str]],
    reporter_name: str = "",
    attachment_count: int = 0,
) -> tuple[bool, str]:
    from services.meal_feishu_lark_cli import send_chat_post, send_chat_text

    cid = (chat_id or "").strip()
    if not cid:
        return False, "请填写飞书群 chat_id"

    head = f"🐛 新缺陷：{bug_title.strip()}"
    if reporter_name.strip():
        head += f"\n提交人：{reporter_name.strip()}"

    excerpt = (description or "").strip()
    if excerpt:
        short = excerpt if len(excerpt) <= 400 else excerpt[:400] + "…"
        head += f"\n\n{short}"

    if attachment_count > 0:
        head += f"\n\n📎 附件 {attachment_count} 个（见 TAPD 缺陷详情）"

    valid_mentions = [
        m
        for m in mentions
        if str(m.get("open_id") or "").strip()
    ]

    if valid_mentions:
        content_rows: list[list[dict[str, str]]] = []
        at_row = []
        for m in valid_mentions:
            oid = str(m.get("open_id") or "").strip()
            name = re.sub(r"[<>]", "", str(m.get("name") or oid).strip()) or "成员"
            at_row.append({"tag": "at", "user_id": oid, "user_name": name})
        if at_row:
            content_rows.append(at_row)
        content_rows.append([{"tag": "text", "text": head + "\n"}])
        content_rows.append(
            [{"tag": "a", "text": "打开 TAPD 缺陷", "href": bug_url}],
        )
        post_body = {
            "zh_cn": {
                "title": "TAPD 缺陷通知",
                "content": content_rows,
            }
        }
        return send_chat_post(cid, post_body)

    text = f"{head}\n链接：{bug_url}"
    return send_chat_text(cid, text)


def notify_feishu_bug_chats(
    *,
    chat_ids: list[str],
    bug_title: str,
    bug_url: str,
    description: str = "",
    mentions: list[dict[str, str]],
    reporter_name: str = "",
    attachment_count: int = 0,
) -> tuple[bool, str, list[dict[str, Any]]]:
    """向多个飞书群发送缺陷通知，返回 (是否全部成功, 汇总错误, 各群结果)。"""
    ids = [str(c).strip() for c in chat_ids if str(c).strip().startswith("oc_")]
    if not ids:
        return False, "请至少选择一个有效的飞书群（oc_ 开头）", []

    results: list[dict[str, Any]] = []
    errors: list[str] = []
    for cid in ids:
        ok, err = notify_feishu_bug(
            chat_id=cid,
            bug_title=bug_title,
            bug_url=bug_url,
            description=description,
            mentions=mentions,
            reporter_name=reporter_name,
            attachment_count=attachment_count,
        )
        err_text = (err or "").strip()
        if not ok and err_text and _is_feishu_cli_noise(err_text):
            ok = True
            err_text = ""
        results.append({"chat_id": cid, "ok": ok, "error": err_text or None})
        if not ok:
            errors.append(f"{cid}: {err_text or '发送失败'}")

    all_ok = all(r.get("ok") for r in results) and len(results) > 0
    summary = "; ".join(errors[:5])
    if len(errors) > 5:
        summary += f" 等 {len(errors)} 个群失败"
    return all_ok, summary, results


def _is_feishu_cli_noise(text: str) -> bool:
    return bool(
        re.search(r"ev_poll_posix|FD from fork parent still in poll list", text, re.I)
    )
