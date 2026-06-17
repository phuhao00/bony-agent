"""餐费 · 飞书考勤解析单元测试"""
from __future__ import annotations

from services.meal_feishu_attendance import _clock_from_task, _format_check_time, _shift_time_to_hhmm
from services.meal_feishu_attendance_ids import resolve_record_open_id


def test_shift_time_hhmm():
    assert _shift_time_to_hhmm("09:30") == "09:30"


def test_clock_from_task_shift_only():
    task = {
        "check_in_shift_time": "09:15",
        "check_out_shift_time": "18:30",
        "records": [],
    }
    assert _clock_from_task(task) == ("09:15", "18:30")


def test_aggregate_upload_merchant_and_pending():
    from routers.meal_receipt_router import aggregate_upload_recognitions

    amount, _, md, merchant, pending, note, _ = aggregate_upload_recognitions(
        [
            {"ok": True, "date": "2026-06-01", "amount": 10, "merchant": "甲"},
            {"ok": True, "date": "2026-06-01", "amount": 20, "merchant": "乙"},
        ],
        meal_date_override="2026-06-03",
    )
    assert amount == 30.0
    assert merchant == "甲，乙"
    assert md == "2026-06-03"
    assert pending is True
    assert "不符" in note

    _, _, md2, _, pending2, note2, _ = aggregate_upload_recognitions(
        [{"ok": True, "date": None, "amount": 8, "merchant": "丙"}],
        meal_date_override="",
    )
    assert pending2 is True
    assert "未识别到日期" in note2
    assert md2  # defaults to today


def test_employee_ids_for_lookup_merges_name_hash():
    from routers.meal_receipt_router import employee_id_from_name, employee_ids_for_lookup

    assert employee_id_from_name("图图") == "name:e51f7bb37b97d517"
    ids = employee_ids_for_lookup("ou_test", "图图")
    assert "ou_test" in ids
    assert "name:e51f7bb37b97d517" in ids


def test_dedupe_upload_files_by_content():
    from routers.meal_receipt_router import dedupe_upload_files

    blob = b"same-image-bytes"
    files = [(blob, "a.jpg"), (blob, "b.png"), (b"other", "c.jpg")]
    deduped, skipped = dedupe_upload_files(files)
    assert skipped == 1
    assert len(deduped) == 2


def test_dedupe_by_meal_date_prefers_open_id():
    from routers.meal_receipt_router import _dedupe_by_meal_date

    rows = _dedupe_by_meal_date(
        [
            {
                "meal_date": "2026-06-03",
                "employee_id": "name:aaa",
                "amount": 10,
                "updated_at": "2026-06-03T10:00:00",
            },
            {
                "meal_date": "2026-06-03",
                "employee_id": "ou_bbb",
                "amount": 49.7,
                "updated_at": "2026-06-03T09:00:00",
            },
        ]
    )
    assert len(rows) == 1
    assert rows[0]["employee_id"] == "ou_bbb"
    assert rows[0]["amount"] == 49.7


def test_resolve_record_open_id_name_map():
    name_map = {"图图": "ou_abc"}
    row = {"employee_id": "name:deadbeef", "employee_name": "图图"}
    assert resolve_record_open_id(row, name_map) == "ou_abc"
    row2 = {"employee_id": "ou_real", "employee_name": "图图"}
    assert resolve_record_open_id(row2, name_map) == "ou_real"
