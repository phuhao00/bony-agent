"""Tests for code analysis tools and routing."""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import patch

import pytest

BACKEND_DIR = Path(__file__).parent.parent / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


def test_resolve_workspace_path_blocks_traversal(tmp_path, monkeypatch):
    from utils import workspace_root as wr

    monkeypatch.setattr(wr, "get_workspace_git_root", lambda: tmp_path)
    from tools import code_analysis_tools as cat

    monkeypatch.setattr(cat, "get_workspace_git_root", lambda: tmp_path)
    target = tmp_path / "backend" / "foo.py"
    target.parent.mkdir(parents=True)
    target.write_text("x = 1\n", encoding="utf-8")

    with pytest.raises(ValueError):
        cat._resolve_workspace_path("../etc/passwd")

    resolved = cat._resolve_workspace_path("backend/foo.py")
    assert resolved == target.resolve()


def test_read_workspace_file_returns_numbered_lines(tmp_path, monkeypatch):
    from utils import workspace_root as wr

    monkeypatch.setattr(wr, "get_workspace_git_root", lambda: tmp_path)
    from tools import code_analysis_tools as cat

    monkeypatch.setattr(cat, "get_workspace_git_root", lambda: tmp_path)
    f = tmp_path / "sample.py"
    f.write_text("line1\nline2\nline3\n", encoding="utf-8")

    out = cat.read_workspace_file.invoke({"path": "sample.py", "start_line": 2, "max_lines": 2})
    assert "line2" in out
    assert "line3" in out
    assert "lines 2-3" in out


def test_search_code_symbols_not_indexed(monkeypatch):
    from tools import code_analysis_tools as cat

    monkeypatch.setattr(
        "services.codegraph_service.get_codegraph_status",
        lambda: {"cli_available": True, "hint": "run init"},
    )
    monkeypatch.setattr("services.codegraph_service.is_indexed", lambda: False)

    out = cat.search_code_symbols.invoke({"query": "FooBar"})
    assert "尚未索引" in out or "init" in out.lower()


def test_search_code_symbols_returns_hits(monkeypatch):
    from tools import code_analysis_tools as cat

    monkeypatch.setattr("services.codegraph_service.is_indexed", lambda: True)
    monkeypatch.setattr(
        "services.codegraph_service.search_codegraph_symbols",
        lambda q, limit=16: [
            {
                "kind": "function",
                "name": "browser_runner",
                "qualifiedName": "browser_runner",
                "filePath": "backend/services/agent_s/browser_runner.py",
                "line": 10,
                "score": 0.9,
            }
        ],
    )

    out = cat.search_code_symbols.invoke({"query": "browser_runner"})
    assert "browser_runner" in out
    assert "backend/services/agent_s/browser_runner.py" in out


def test_router_keyword_code_review():
    from agents.router import IntentRouter

    router = IntentRouter(available_agent_ids=["code_analyst_agent", "creative_agent"])
    result = router._keyword_route("帮我 code review 这段代码")
    assert result is not None
    assert result.agent_id == "code_analyst_agent"
    assert result.confidence >= 0.9


def test_router_keyword_architecture():
    from agents.router import IntentRouter

    router = IntentRouter(available_agent_ids=["code_analyst_agent", "architect_agent"])
    result = router._keyword_route("分析一下项目目录结构")
    assert result is not None
    assert result.agent_id == "code_analyst_agent"


def test_augment_input_with_workspace():
    from agents.workspace_context import augment_input_with_workspace

    text = augment_input_with_workspace(
        "review this",
        {"attached_files": ["backend/main.py"], "branch": "main"},
    )
    assert "@backend/main.py" in text
    assert "main" in text
    assert "review this" in text


def test_augment_input_with_workspace_root_only():
    from agents.workspace_context import augment_input_with_workspace

    text = augment_input_with_workspace(
        "帮我分析下代码",
        {"root": "/tmp/my-repo", "branch": "main"},
    )
    assert "/tmp/my-repo" in text
    assert "禁止要求用户补充文件路径" in text
    assert "帮我分析下代码" in text


def test_router_keyword_analyze_code():
    from agents.router import IntentRouter

    router = IntentRouter(available_agent_ids=["code_analyst_agent", "creative_agent"])
    result = router._keyword_route("帮我分析下代码")
    assert result is not None
    assert result.agent_id == "code_analyst_agent"


def test_workspace_context_from_raw():
    from agents.chat_request import WorkspaceContext

    ctx = WorkspaceContext.from_raw(
        {"attachedFiles": ["web/app/page.tsx"], "branch": "dev"}
    )
    assert ctx.attached_files == ["web/app/page.tsx"]
    assert ctx.branch == "dev"
