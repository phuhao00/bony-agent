"""Jenkins 运维服务"""
from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pytest


@pytest.fixture
def jenkins_config(tmp_path, monkeypatch):
    cfg_dir = tmp_path / "storage" / "meal"
    cfg_dir.mkdir(parents=True)
    cfg = {
        "jenkins": {
            "enabled": True,
            "url": "https://jenkins.test",
            "username": "ci",
            "allowed_jobs": [
                {
                    "name": "deploy-backend",
                    "label": "部署后端",
                    "parameters": [{"name": "BRANCH", "default": "main"}],
                }
            ],
        }
    }
    (cfg_dir / "feishu_config.json").write_text(
        json.dumps(cfg), encoding="utf-8"
    )
    monkeypatch.setenv("JENKINS_API_TOKEN", "secret-token")
    monkeypatch.setattr(
        "services.meal_feishu_config._CONFIG_PATH",
        cfg_dir / "feishu_config.json",
    )
    monkeypatch.setattr(
        "services.jenkins_service._CRUMB_CACHE",
        {},
    )


def test_is_job_allowed(jenkins_config):
    from services.jenkins_service import is_job_allowed

    assert is_job_allowed("deploy-backend")
    assert not is_job_allowed("evil-job")


def test_sanitize_build_params_defaults(jenkins_config):
    from services.jenkins_service import _sanitize_build_params

    out = _sanitize_build_params("deploy-backend", {})
    assert out.get("BRANCH") == "main"


def test_trigger_build_rejects_unknown_job(jenkins_config):
    from services.jenkins_service import trigger_build

    r = trigger_build("not-in-list")
    assert r["ok"] is False
    assert "白名单" in r["error"]


def test_health_check_ok(jenkins_config):
    from services import jenkins_service as js

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {"mode": "NORMAL"}

    with patch.object(js._SESSION, "request", return_value=mock_resp):
        with patch.object(js, "_get_crumb", return_value=("", "")):
            r = js.health_check()
    assert r["ok"] is True


def test_trigger_build_success(jenkins_config):
    from services import jenkins_service as js

    post_resp = MagicMock()
    post_resp.status_code = 201
    post_resp.headers = {"Location": "https://jenkins.test/queue/item/1/"}
    post_resp.text = ""

    queue_resp = MagicMock()
    queue_resp.status_code = 200
    queue_resp.json.return_value = {
        "executable": {"number": 42, "url": "https://jenkins.test/job/x/42/"}
    }

    build_resp = MagicMock()
    build_resp.status_code = 200
    build_resp.json.return_value = {
        "number": 42,
        "url": "https://jenkins.test/job/deploy-backend/42/",
        "result": None,
        "building": True,
    }

    console_resp = MagicMock()
    console_resp.status_code = 200
    console_resp.text = "BUILD SUCCESS"

    def fake_request(method, url, **kwargs):
        if method == "POST" and "build" in url:
            return post_resp
        if "queue" in url:
            return queue_resp
        if "consoleText" in url:
            return console_resp
        return build_resp

    with patch.object(js._SESSION, "request", side_effect=fake_request):
        with patch.object(js._SESSION, "get", return_value=queue_resp):
            with patch.object(js, "_get_crumb", return_value=("crumb", "Jenkins-Crumb")):
                with patch.object(js, "_poll_queue_for_build", return_value=42):
                    r = js.trigger_build("deploy-backend", {"BRANCH": "main"})
    assert r["ok"] is True
    assert r["build_number"] == 42
