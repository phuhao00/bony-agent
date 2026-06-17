"""餐费飞书配置 · 打包 storage 路径"""
from __future__ import annotations

from unittest.mock import patch

from services.meal_feishu_config import get_storage_dir, resolve_member_list_chat_id


def test_get_storage_dir_uses_env(monkeypatch, tmp_path):
    monkeypatch.setenv("STORAGE_DIR", str(tmp_path / "storage"))
    assert get_storage_dir() == tmp_path / "storage"


def test_resolve_member_list_chat_id_prefers_reminder():
    cfg = {"reminder_chat_id": "oc_reminder", "reminder_chat_name": "餐费群"}
    with patch("services.meal_feishu_config.load_config", return_value=cfg):
        cid, err, src = resolve_member_list_chat_id("")
    assert cid == "oc_reminder"
    assert err == ""
    assert src == "reminder"


def test_resolve_member_list_chat_id_fallback_first_group():
    with patch("services.meal_feishu_config.load_config", return_value={}):
        with patch("services.meal_feishu_lark_cli.is_installed", return_value=True):
            with patch(
                "services.meal_feishu_lark_cli.list_bot_group_chats",
                return_value=([{"chat_id": "oc_first", "name": "A"}], ""),
            ):
                cid, err, src = resolve_member_list_chat_id("")
    assert cid == "oc_first"
    assert src == "auto_first_group"
