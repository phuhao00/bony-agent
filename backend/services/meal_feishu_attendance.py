"""餐费统计 · 飞书考勤打卡（按 open_id + 日期查询上下班时间）"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from typing import Any, Optional
from zoneinfo import ZoneInfo

from services.meal_feishu_attendance_ids import (
    AttendanceIdType,
    batch_resolve_attendance_identities,
    name_to_open_id_map,
    remember_attendance_ids,
    resolve_record_open_id,
)
from services.meal_feishu_config import is_configured, uses_lark_cli

logger = logging.getLogger(__name__)

_CN_TZ = ZoneInfo("Asia/Shanghai")
_CHUNK = 50


def _is_feishu_open_id(employee_id: str) -> bool:
    return (employee_id or "").strip().startswith("ou_")


def _meal_date_to_int(meal_date: str) -> Optional[int]:
    s = (meal_date or "").strip().replace("-", "")
    if len(s) != 8 or not s.isdigit():
        return None
    return int(s)


def _format_check_time(raw: Any) -> str:
    if raw is None or raw == "":
        return ""
    try:
        ts = int(float(str(raw)))
    except (TypeError, ValueError):
        return ""
    if ts > 1_000_000_000_000:
        ts //= 1000
    try:
        return datetime.fromtimestamp(ts, tz=_CN_TZ).strftime("%H:%M")
    except (OSError, OverflowError, ValueError):
        return ""


def _shift_time_to_hhmm(raw: Any) -> str:
    s = str(raw or "").strip()
    if not s:
        return ""
    if len(s) >= 16 and s[10:11] in ("T", " "):
        try:
            return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(_CN_TZ).strftime(
                "%H:%M"
            )
        except ValueError:
            pass
    if len(s) >= 5 and s[2:3] == ":":
        return s[:5]
    return _format_check_time(raw)


def _clock_from_task(task: dict) -> tuple[str, str]:
    """从单日 user_task 解析上班/下班打卡时间（HH:MM）。"""
    clock_in = _shift_time_to_hhmm(task.get("check_in_shift_time"))
    clock_out = _shift_time_to_hhmm(task.get("check_out_shift_time"))
    for block in task.get("records") or []:
        if not isinstance(block, dict):
            continue
        cin = block.get("check_in_record") or {}
        cout = block.get("check_out_record") or {}
        t_in = _format_check_time(cin.get("check_time") if isinstance(cin, dict) else "")
        t_out = _format_check_time(cout.get("check_time") if isinstance(cout, dict) else "")
        if t_in and (not clock_in or t_in < clock_in):
            clock_in = t_in
        if t_out and (not clock_out or t_out > clock_out):
            clock_out = t_out
    return clock_in, clock_out


def _build_attendance_id_groups(
    open_ids: list[str],
) -> tuple[dict[str, str], dict[str, str], dict[str, str]]:
    """
    返回:
    - id_to_open_id: 考勤 API 入参 id -> open_id
    - open_id_note: 无法解析时的说明
    - id_type_by_id: 考勤 id -> employee_id | employee_no
    """
    resolved = batch_resolve_attendance_identities(open_ids)
    id_to_oid: dict[str, str] = {}
    oid_note: dict[str, str] = {}
    id_type: dict[str, AttendanceIdType] = {}
    for oid, (att_id, atype, note) in resolved.items():
        if att_id:
            id_to_oid[att_id] = oid
            id_type[att_id] = atype
        elif note:
            oid_note[oid] = note
    return id_to_oid, oid_note, id_type


def _query_user_tasks(
    user_ids: list[str],
    date_from: int,
    date_to: int,
    *,
    employee_type: AttendanceIdType = "employee_id",
) -> tuple[list[dict], str]:
    if not user_ids:
        return [], ""
    if not is_configured():
        return [], "飞书未配置"
    if not uses_lark_cli():
        return [], "考勤查询需使用 lark-cli 模式"

    from services import meal_feishu_lark_cli as lc

    merged: list[dict] = []
    err_last = ""
    for i in range(0, len(user_ids), _CHUNK):
        chunk = user_ids[i : i + _CHUNK]
        code, body, err = lc.api_request(
            "POST",
            "/open-apis/attendance/v1/user_tasks/query",
            params={
                "employee_type": employee_type,
                "ignore_invalid_users": True,
            },
            data={
                "user_ids": chunk,
                "check_date_from": date_from,
                "check_date_to": date_to,
                "include_terminated_user": False,
            },
            as_who="bot",
            timeout=90,
        )
        if code != 0 or not body or body.get("code") != 0:
            err_last = err or str((body or {}).get("msg") or "考勤 API 失败")
            logger.warning("[meal_attendance] query failed: %s", err_last[:200])
            continue
        data = body.get("data") if isinstance(body.get("data"), dict) else {}
        rows = data.get("user_task_results") or []
        if isinstance(rows, list):
            merged.extend([r for r in rows if isinstance(r, dict)])
    if merged:
        return merged, ""
    return [], err_last or "无考勤数据（请确认应用已开通 attendance:task:readonly）"


def fetch_attendance_map(
    user_ids: list[str],
    *,
    date_from: str = "",
    date_to: str = "",
) -> tuple[dict[tuple[str, str], dict[str, str]], dict[str, str]]:
    """
    批量拉取考勤。键为 (open_id, YYYY-MM-DD)，值为 clock_in / clock_out。
    第二项为 open_id -> 无法查询时的说明。
    """
    oids = sorted({u.strip() for u in user_ids if _is_feishu_open_id(u)})
    notes: dict[str, str] = {}
    if not oids:
        return {}, notes

    d0 = _meal_date_to_int(date_from)
    d1 = _meal_date_to_int(date_to or date_from)
    if d0 is None and d1 is None:
        return {}, notes
    if d0 is None:
        d0 = d1
    if d1 is None:
        d1 = d0
    if d0 > d1:
        d0, d1 = d1, d0

    id_to_oid, oid_note, id_type_map = _build_attendance_id_groups(oids)
    notes.update(oid_note)
    if not id_to_oid:
        return {}, notes

    by_type: dict[AttendanceIdType, list[str]] = {"employee_id": [], "employee_no": []}
    for att_id, atype in id_type_map.items():
        by_type[atype].append(att_id)

    tasks: list[dict] = []
    err_last = ""
    for atype, ids in by_type.items():
        if not ids:
            continue
        chunk_tasks, err = _query_user_tasks(ids, d0, d1, employee_type=atype)
        if chunk_tasks:
            tasks.extend(chunk_tasks)
        elif err:
            err_last = err

    if err_last and not tasks:
        logger.info("[meal_attendance] %s", err_last[:200])
        for oid in oids:
            if oid not in notes:
                notes[oid] = err_last[:200]

    out: dict[tuple[str, str], dict[str, str]] = {}
    for task in tasks:
        att_key = (task.get("user_id") or "").strip()
        oid = id_to_oid.get(att_key, "")
        if not oid:
            continue
        if id_type_map.get(att_key) == "employee_no":
            remember_attendance_ids(oid, employee_no=att_key)
        else:
            remember_attendance_ids(oid, user_id=att_key)
        day = task.get("day")
        if day is None:
            continue
        day_s = str(day).strip()
        if len(day_s) == 8 and day_s.isdigit():
            meal_date = f"{day_s[:4]}-{day_s[4:6]}-{day_s[6:8]}"
        else:
            continue
        cin, cout = _clock_from_task(task)
        key = (oid, meal_date)
        prev = out.get(key)
        if prev:
            if cin and (not prev.get("clock_in") or cin < prev["clock_in"]):
                prev["clock_in"] = cin
            if cout and (not prev.get("clock_out") or cout > prev["clock_out"]):
                prev["clock_out"] = cout
        else:
            out[key] = {"clock_in": cin, "clock_out": cout}
    return out, notes


def _date_span_from_records(records: list[dict], month: str = "") -> tuple[str, str]:
    dates = [r.get("meal_date") for r in records if r.get("meal_date")]
    if month and len(month) >= 7:
        try:
            y, m = month.split("-", 1)[:2]
            start = date(int(y), int(m), 1)
            if m == "12":
                end = date(int(y) + 1, 1, 1) - timedelta(days=1)
            else:
                end = date(int(y), int(m) + 1, 1) - timedelta(days=1)
            return start.isoformat(), end.isoformat()
        except ValueError:
            pass
    if not dates:
        today = date.today().isoformat()
        return today, today
    return min(dates), max(dates)


def attach_attendance(records: list[dict], *, month: str = "") -> list[dict]:
    """为餐费记录附加当日上班/下班打卡时间。"""
    if not records:
        return records

    name_map = name_to_open_id_map()
    open_ids: list[str] = []
    for r in records:
        oid = resolve_record_open_id(r, name_map)
        if _is_feishu_open_id(oid):
            open_ids.append(oid)

    if not open_ids:
        return [
            {
                **r,
                "clock_in": "",
                "clock_out": "",
                "attendance_note": "非飞书账号（请用飞书登录上传或从提醒群选择姓名）",
            }
            for r in records
        ]

    d_from, d_to = _date_span_from_records(records, month)
    amap, oid_notes = fetch_attendance_map(open_ids, date_from=d_from, date_to=d_to)

    out: list[dict] = []
    for r in records:
        row = dict(r)
        oid = resolve_record_open_id(row, name_map)
        md = (row.get("meal_date") or "").strip()
        if _is_feishu_open_id(oid) and md:
            att = amap.get((oid, md)) or {}
            row["clock_in"] = att.get("clock_in") or ""
            row["clock_out"] = att.get("clock_out") or ""
            if row["clock_in"] or row["clock_out"]:
                row["attendance_note"] = ""
            elif oid_notes.get(oid):
                row["attendance_note"] = oid_notes[oid][:200]
            else:
                row["attendance_note"] = "无打卡记录"
        else:
            row["clock_in"] = ""
            row["clock_out"] = ""
            eid = (row.get("employee_id") or "").strip()
            if eid.startswith("name:"):
                row["attendance_note"] = "姓名未匹配到飞书成员，无法查考勤"
            elif eid:
                row["attendance_note"] = "非飞书账号"
            else:
                row["attendance_note"] = ""
        out.append(row)
    return out


def get_daily_attendance(open_id: str, meal_date: str) -> dict[str, Any]:
    """单日考勤（供调试或单条查询）。"""
    if not _is_feishu_open_id(open_id):
        return {"ok": True, "clock_in": "", "clock_out": "", "skipped": True}
    amap, _ = fetch_attendance_map([open_id], date_from=meal_date, date_to=meal_date)
    att = amap.get((open_id.strip(), meal_date.strip()), {})
    return {
        "ok": True,
        "clock_in": att.get("clock_in") or "",
        "clock_out": att.get("clock_out") or "",
    }
