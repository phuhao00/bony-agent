"""飞书自然语言自动 Jenkins 构建"""
from __future__ import annotations

import json
import time
from unittest.mock import MagicMock, patch

from services import feishu_ops_auto_build as auto


def test_maybe_deploy_keywords():
    assert auto._maybe_deploy_keywords("帮我把 main 部署一下")
    assert not auto._maybe_deploy_keywords("今天天气不错")
    assert not auto._maybe_deploy_keywords("运维状态")


def test_is_auto_build_allowed_requires_admin():
    cfg = {
        "ops_enabled": True,
        "ops_auto_jenkins_build": True,
        "ops_auto_jenkins_require_admin": True,
        "ops_admin_open_ids": ["ou_admin"],
        "jenkins": {"enabled": True, "url": "http://127.0.0.1:8080"},
    }
    with patch("services.feishu_ops_auto_build.load_config", return_value=cfg):
        with patch(
            "services.jenkins_service.get_jenkins_config",
            return_value={"enabled": True},
        ):
            ok, _ = auto.is_auto_build_allowed(
                "ou_admin", is_group=True, at_bot=True
            )
            assert ok
            ok2, reason = auto.is_auto_build_allowed(
                "ou_other", is_group=True, at_bot=True
            )
            assert not ok2
            assert "ops_admin" in reason


def test_try_auto_jenkins_triggers_on_deploy_intent():
    message_id = "om_test"
    fs = MagicMock()
    cfg = {
        "ops_enabled": True,
        "ops_auto_jenkins_build": True,
        "ops_auto_jenkins_require_admin": True,
        "ops_auto_jenkins_min_confidence": 0.5,
        "ops_auto_jenkins_cooldown_sec": 0,
        "ops_admin_open_ids": ["ou_admin"],
    }
    llm_result = {
        "is_deploy_request": True,
        "job_name": "deploy-agent-backend",
        "build_params": {"BRANCH": "main"},
        "confidence": 0.9,
        "summary": "部署 main",
    }
    trigger_result = {
        "ok": True,
        "job_name": "deploy-agent-backend",
        "build_number": 42,
        "url": "http://127.0.0.1:8080/job/x/42/",
    }

    with patch("services.feishu_ops_auto_build.load_config", return_value=cfg):
        with patch(
            "services.jenkins_service.get_jenkins_config",
            return_value={"enabled": True},
        ):
            with patch(
                "services.jenkins_service.is_job_allowed", return_value=True
            ):
                with patch.object(
                    auto, "_parse_deploy_intent_llm", return_value=llm_result
                ):
                    with patch.object(
                        auto,
                        "_execute_trigger",
                        return_value="✅ Jenkins 已触发 `deploy-agent-backend`\n构建 #42",
                    ) as ex:
                        with patch(
                            "services.meal_feishu_api.reply_text",
                            fs.reply_text,
                        ):
                            with patch.object(auto, "_load_log", return_value={"entries": [], "last_trigger_by_chat": {}}):
                                with patch.object(auto, "_save_log"):
                                    handled = auto.try_auto_jenkins_from_chat(
                                        "帮我把 main 部署一下",
                                        sender_open_id="ou_admin",
                                        sender_name="测试",
                                        chat_id="oc_group",
                                        message_id=message_id,
                                        is_group=True,
                                        at_bot=True,
                                    )
    assert handled is True
    ex.assert_called_once()
    fs.reply_text.assert_called_once()
    assert "42" in fs.reply_text.call_args[0][1]


def test_try_auto_jenkins_skips_non_deploy():
    with patch.object(
        auto,
        "_parse_deploy_intent_llm",
        return_value={"is_deploy_request": False, "confidence": 0.9},
    ):
        cfg = {
            "ops_enabled": True,
            "ops_auto_jenkins_build": True,
            "ops_auto_jenkins_require_admin": False,
            "ops_admin_open_ids": [],
            "ops_auto_jenkins_min_confidence": 0.5,
            "ops_auto_jenkins_cooldown_sec": 0,
        }
        with patch("services.feishu_ops_auto_build.load_config", return_value=cfg):
            with patch(
                "services.jenkins_service.get_jenkins_config",
                return_value={"enabled": True},
            ):
                with patch("services.jenkins_service.trigger_build") as trig:
                    handled = auto.try_auto_jenkins_from_chat(
                        "部署一下后端 main",
                        sender_open_id="ou_x",
                        sender_name="测试",
                        chat_id="oc_g",
                        message_id="om_x",
                        is_group=True,
                        at_bot=True,
                    )
    assert handled is False
    trig.assert_not_called()


def test_cooldown_blocks_second_trigger(tmp_path, monkeypatch):
    log_file = tmp_path / "log.json"
    monkeypatch.setattr(auto, "_LOG_PATH", log_file)
    log_file.write_text(
        json.dumps({"entries": [], "last_trigger_by_chat": {"oc_g": time.time()}}),
        encoding="utf-8",
    )
    cfg = {
        "enabled": True,
        "require_admin": True,
        "min_confidence": 0.5,
        "context_hours": 1.0,
        "cooldown_sec": 90,
    }
    with patch.object(auto, "_auto_cfg", return_value=cfg):
        msg = auto._check_cooldown("oc_g")
    assert msg and "稍后再试" in msg
