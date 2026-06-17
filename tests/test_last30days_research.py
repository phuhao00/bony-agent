"""Tests for last30days research integration."""

from __future__ import annotations

import json
from unittest.mock import patch

from core.last30days_artifact import (
    build_summary_from_report,
    collect_research_items,
    last30days_report_to_artifact,
)
from services.last30days_service import (
    _build_subprocess_env,
    create_last30days_research_task,
    get_last30days_task_response,
    run_last30days_research_task,
)


SAMPLE_REPORT = {
    "topic": "OpenClaw",
    "range_from": "2026-05-01",
    "range_to": "2026-06-01",
    "generated_at": "2026-06-01T12:00:00Z",
    "clusters": [
        {
            "cluster_id": "c1",
            "title": "Agent tooling momentum",
            "candidate_ids": ["a"],
            "representative_ids": ["a"],
            "sources": ["reddit", "github"],
            "score": 0.91,
        }
    ],
    "ranked_candidates": [
        {
            "candidate_id": "a",
            "source": "reddit",
            "title": "OpenClaw is changing local agents",
            "url": "https://reddit.com/r/test/comments/abc",
            "snippet": "Community says adoption is accelerating.",
            "engagement": {"upvotes": 1200, "comments": 88},
            "final_score": 0.95,
            "explanation": "High-signal thread",
            "cluster_id": "c1",
        },
        {
            "candidate_id": "b",
            "source": "hackernews",
            "title": "Show HN: OpenClaw fork",
            "url": "https://news.ycombinator.com/item?id=1",
            "snippet": "Developer discussion",
            "engagement": {"points": 420},
            "final_score": 0.72,
        },
    ],
    "items_by_source": {
        "reddit": [
            {
                "item_id": "r1",
                "source": "reddit",
                "title": "Reddit backup item",
                "body": "body",
                "url": "https://reddit.com/r/backup",
                "engagement": {"upvotes": 10},
            }
        ]
    },
    "errors_by_source": {"x": "auth missing"},
    "warnings": ["thin evidence on tiktok"],
}


class TestLast30DaysArtifact:
    def test_build_summary_contains_clusters(self):
        summary = build_summary_from_report(SAMPLE_REPORT)
        assert "OpenClaw" in summary
        assert "Agent tooling momentum" in summary
        assert "thin evidence on tiktok" in summary

    def test_collect_research_items_dedupes_urls(self):
        items = collect_research_items(SAMPLE_REPORT, max_items=10)
        urls = [it.get("url") for it in items if it.get("url")]
        assert len(urls) == len(set(urls))
        assert any(it.get("extra", {}).get("source") == "reddit" for it in items)

    def test_last30days_report_to_artifact(self):
        artifact = last30days_report_to_artifact(
            SAMPLE_REPORT,
            query="OpenClaw",
            mode="quick",
            platform="douyin",
        )
        assert artifact["source"] == "custom"
        assert artifact["query"] == "OpenClaw"
        assert artifact["summary"]
        assert len(artifact["items"]) >= 2
        assert artifact["raw"]["engine"] == "last30days"
        assert artifact["raw"]["mode"] == "quick"


class TestLast30DaysService:
    @patch("services.last30days_service._resolve_dashscope_config")
    def test_build_subprocess_env_injects_dashscope(self, mock_dash, monkeypatch):
        import services.last30days_service as svc

        root = "/tmp/test-last30days"
        monkeypatch.setattr(svc, "RESEARCH_ROOT", type("P", (), {"__str__": lambda s: root})())
        mock_dash.return_value = {
            "configured": True,
            "provider": "dashscope",
            "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1/",
            "planner_model": "qwen-plus",
            "rerank_model": "qwen-plus",
        }
        with patch("tools.media_common._get_provider_api_key", return_value="sk-test-dash"):
            env = _build_subprocess_env()
        assert env["DASHSCOPE_API_KEY"] == "sk-test-dash"
        assert env["LAST30DAYS_REASONING_PROVIDER"] == "dashscope"
        assert env["LAST30DAYS_PLANNER_MODEL"] == "qwen-plus"
        assert "compatible-mode" in env["DASHSCOPE_BASE_URL"]

    @patch("services.last30days_service.is_last30days_available", return_value=True)
    @patch("services.last30days_service.get_last30days_status")
    def test_create_task(self, mock_status, _mock_avail):
        mock_status.return_value = {"python_ok": True, "python_version": "3.13"}
        task_id = create_last30days_research_task(
            query="test topic",
            mode="quick",
            platform="bilibili",
            goal="脚本选题",
        )
        assert task_id
        payload = get_last30days_task_response(task_id)
        assert payload is not None
        assert payload["status"] == "pending"
        assert payload["query"] == "test topic"

    @patch("services.last30days_service._run_cli")
    @patch("services.last30days_service.is_last30days_available", return_value=True)
    @patch("services.last30days_service.get_last30days_status")
    def test_run_task_mock_cli(self, mock_status, _mock_avail, mock_cli, tmp_path, monkeypatch):
        import services.last30days_service as svc

        root = tmp_path / "l30"
        monkeypatch.setattr(svc, "RESEARCH_ROOT", root)
        monkeypatch.setattr(svc, "HISTORY_PATH", root / "index.json")
        mock_status.return_value = {"python_ok": True, "python_version": "3.13"}
        mock_cli.return_value = (
            SAMPLE_REPORT,
            {"json": str(tmp_path / "out.json")},
            "",
        )

        task_id = create_last30days_research_task(query="OpenClaw", mode="quick")
        run_last30days_research_task(task_id, query="OpenClaw", mode="quick", mock=True)

        payload = get_last30days_task_response(task_id)
        assert payload is not None
        assert payload["status"] == "completed"
        assert payload["artifact"]["query"] == "OpenClaw"
        assert payload["item_count"] >= 2

        history_path = root / "index.json"
        assert history_path.is_file()
        history = json.loads(history_path.read_text(encoding="utf-8"))
        assert history[0]["query"] == "OpenClaw"
