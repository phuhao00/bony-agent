"""Jenkins 配置存储与校验"""
from __future__ import annotations

from services.jenkins_config_store import normalize_allowed_jobs


def test_normalize_allowed_jobs_full():
    jobs, err = normalize_allowed_jobs(
        [
            {
                "name": "deploy-agent-backend",
                "label": "部署后端",
                "risk": "high",
                "parameters": [
                    {"name": "BRANCH", "default": "main", "choices": ["main", "dev"]},
                ],
            }
        ]
    )
    assert err is None
    assert len(jobs) == 1
    assert jobs[0]["name"] == "deploy-agent-backend"
    assert jobs[0]["parameters"][0]["choices"] == ["main", "dev"]


def test_normalize_rejects_duplicate_names():
    jobs, err = normalize_allowed_jobs(
        [{"name": "a", "label": "A"}, {"name": "a", "label": "B"}]
    )
    assert jobs == []
    assert "重复" in (err or "")


def test_normalize_string_job():
    jobs, err = normalize_allowed_jobs(["my-job"])
    assert err is None
    assert jobs[0]["name"] == "my-job"
