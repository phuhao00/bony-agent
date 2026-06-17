"""飞书运维指令"""
from __future__ import annotations

from services.feishu_ops import (
    _extract_ops_command,
    format_ops_status_markdown,
    is_ops_command,
    is_ops_allowed,
)


def test_is_ops_command():
    assert is_ops_command("运维状态")
    assert is_ops_command("运维 日志 30")
    assert not is_ops_command("餐费统计")


def test_extract_ops_command():
    assert _extract_ops_command("运维帮助") == ("运维帮助", "")
    assert _extract_ops_command("运维日志 25") == ("运维日志", "25")
    assert _extract_ops_command("运维状态") == ("运维状态", "")


def test_ops_allowed_admin_list(monkeypatch):
    from services import feishu_ops

    monkeypatch.setattr(
        feishu_ops,
        "load_config",
        lambda: {
            "ops_enabled": True,
            "ops_admin_open_ids": ["ou_admin"],
        },
    )
    assert is_ops_allowed("ou_admin", is_group=True, at_bot=True)
    assert not is_ops_allowed("ou_other", is_group=True, at_bot=True)
    assert not is_ops_allowed("ou_other", is_group=False, at_bot=False)


def test_format_ops_status_markdown_minimal():
    md = format_ops_status_markdown(
        {
            "checked_at": "2026-06-03 12:00:00",
            "ports": {
                "backend": {"port": 8000, "open": True},
                "web": {"port": 3000, "open": False},
            },
            "feishu": {"configured": True, "ws_connected": True, "connection_mode": "lark-cli"},
            "meal": {"record_count": 3, "db_mb": 0.1, "reminder_enabled": False},
            "disk_free_gb": 100,
            "storage_mb": {"storage": 12.5},
        }
    )
    assert "运维快照" in md
    assert "8000" in md
