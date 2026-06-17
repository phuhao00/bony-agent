"""飞书运维部署计划"""
from __future__ import annotations

from unittest.mock import patch

from services.feishu_chat_pull import _message_body_plain, message_to_line
from services.feishu_ops_deploy import ACTION_CATALOG, _parse_llm_json


def test_parse_llm_json():
    raw = '```json\n{"summary":"test","actions":[],"confidence":0.9}\n```'
    d = _parse_llm_json(raw)
    assert d.get("summary") == "test"
    assert d.get("confidence") == 0.9


def test_message_line():
    m = {
        "sender": {"sender_name": "张三"},
        "create_time": "1710000000",
        "content": '{"text":"请重启一下机器人"}',
    }
    line = message_to_line(m)
    assert "张三" in line
    assert "重启" in _message_body_plain(m)


def test_action_catalog_has_safe_actions():
    assert "status_snapshot" in ACTION_CATALOG
    assert "feishu_reconnect" in ACTION_CATALOG
    assert "run_shell" not in ACTION_CATALOG
    assert "jenkins_trigger_build" in ACTION_CATALOG
    assert ACTION_CATALOG["jenkins_trigger_build"]["risk"] == "high"


def test_validate_jenkins_step_rejects_unknown_job():
    from services.feishu_ops_deploy import _validate_jenkins_step

    with patch("services.jenkins_service.is_job_allowed", return_value=False):
        assert not _validate_jenkins_step(
            "jenkins_trigger_build", {"job_name": "evil"}
        )


def test_validate_jenkins_step_accepts_allowed_job():
    from services.feishu_ops_deploy import _validate_jenkins_step

    with patch("services.jenkins_service.is_job_allowed", return_value=True):
        assert _validate_jenkins_step(
            "jenkins_trigger_build",
            {"job_name": "deploy-backend", "build_params": {"BRANCH": "main"}},
        )


