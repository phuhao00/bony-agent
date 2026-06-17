"""Tests for CodeGraph npx CLI resolution."""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import patch

import pytest

BACKEND_DIR = Path(__file__).parent.parent / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


def test_resolve_codegraph_argv_prefers_local_checkout(monkeypatch, tmp_path):
    from services import codegraph_service as cg

    cli_js = tmp_path / "dist" / "bin" / "codegraph.js"
    cli_js.parent.mkdir(parents=True)
    cli_js.write_text("// stub", encoding="utf-8")
    monkeypatch.setattr(cg, "DEFAULT_CODEGRAPH_HOME", tmp_path)
    monkeypatch.setenv("CODEGRAPH_HOME", str(tmp_path))
    monkeypatch.setattr(
        cg.shutil,
        "which",
        lambda name: "/usr/bin/node" if name == "node" else None,
    )

    argv = cg.resolve_codegraph_argv("status", "/proj", "-j")
    assert argv == ["/usr/bin/node", str(cli_js), "status", "/proj", "-j"]
    assert cg.resolve_codegraph_cli_mode() == "local"


def test_resolve_codegraph_argv_npx_when_no_global(monkeypatch):
    from services import codegraph_service as cg

    monkeypatch.setattr(cg, "_local_codegraph_cli", lambda: None)
    monkeypatch.setattr(cg.shutil, "which", lambda name: "/usr/bin/npx" if name == "npx" else None)

    argv = cg.resolve_codegraph_argv("serve", "--mcp", "-p", "/proj")
    assert argv[0] == "/usr/bin/npx"
    assert argv[1] == "-y"
    assert argv[2] == "@colbymchenry/codegraph"
    assert argv[3:] == ["serve", "--mcp", "-p", "/proj"]


def test_resolve_codegraph_argv_prefers_global(monkeypatch):
    from services import codegraph_service as cg

    monkeypatch.setattr(cg, "_local_codegraph_cli", lambda: None)

    def fake_which(name: str):
        if name == "codegraph":
            return "/usr/local/bin/codegraph"
        if name == "npx":
            return "/usr/bin/npx"
        return None

    monkeypatch.setattr(cg.shutil, "which", fake_which)

    argv = cg.resolve_codegraph_argv("status", "/proj", "-j")
    assert argv == ["/usr/local/bin/codegraph", "status", "/proj", "-j"]
    assert cg.resolve_codegraph_cli_mode() == "global"


def test_resolve_codegraph_argv_raises_without_node(monkeypatch):
    from services import codegraph_service as cg

    monkeypatch.setattr(cg.shutil, "which", lambda _name: None)

    with pytest.raises(RuntimeError, match="npx"):
        cg.resolve_codegraph_argv("init")


def test_get_codegraph_status_cli_missing(monkeypatch):
    from services import codegraph_service as cg

    monkeypatch.setattr(cg.shutil, "which", lambda _name: None)

    status = cg.get_codegraph_status()
    assert status["status"] == "cli_missing"
    assert status["cli_available"] is False
    assert status["cli_mode"] is None


def test_get_codegraph_status_not_indexed(monkeypatch, tmp_path):
    from services import codegraph_service as cg

    monkeypatch.setattr(cg.shutil, "which", lambda name: "/usr/bin/npx" if name == "npx" else None)
    monkeypatch.setattr(cg, "CODEGRAPH_DB", tmp_path / "missing.db")
    monkeypatch.setattr(cg, "is_indexed", lambda: False)

    status = cg.get_codegraph_status()
    assert status["status"] == "not_indexed"
    assert status["cli_mode"] == "npx"
    assert status["cli_available"] is True
    assert "npx" in status["hint"]
    assert "--path" not in status["hint"]


def test_get_codegraph_status_ready(monkeypatch, tmp_path):
    from services import codegraph_service as cg

    db = tmp_path / "codegraph.db"
    db.touch()

    monkeypatch.setattr(cg.shutil, "which", lambda name: "/usr/bin/npx" if name == "npx" else None)
    monkeypatch.setattr(cg, "CODEGRAPH_DB", db)
    monkeypatch.setattr(cg, "is_indexed", lambda: True)

    def fake_run(argv, **kwargs):
        class Result:
            returncode = 0
            stdout = '{"nodeCount": 10, "fileCount": 5}'
            stderr = ""

        return Result()

    monkeypatch.setattr(cg.subprocess, "run", fake_run)

    status = cg.get_codegraph_status()
    assert status["status"] == "ready"
    assert status["nodeCount"] == 10
    assert status["fileCount"] == 5


def test_run_codegraph_init_argv_positional_path(monkeypatch):
    from services import codegraph_service as cg

    monkeypatch.setattr(cg.shutil, "which", lambda name: "/usr/bin/npx" if name == "npx" else None)
    monkeypatch.setattr(cg, "is_indexed", lambda: False)

    captured: list[list[str]] = []

    def fake_run(argv, **kwargs):
        captured.append(list(argv))

        class Result:
            returncode = 0
            stdout = "ok"
            stderr = ""

        return Result()

    monkeypatch.setattr(cg.subprocess, "run", fake_run)

    result = cg.run_codegraph_init(with_index=True)
    assert result["success"] is True
    assert captured
    inner = captured[0]
    assert "init" in inner
    assert "--path" not in inner
    assert str(cg.PROJECT_ROOT) in inner


def test_build_mcp_stdio_command_uses_resolve(monkeypatch):
    from services import codegraph_service as cg

    monkeypatch.setattr(cg.shutil, "which", lambda name: "/usr/bin/npx" if name == "npx" else None)

    cmd = cg.build_mcp_stdio_command()
    assert cmd[0] == "/usr/bin/npx"
    assert "serve" in cmd
    assert "--mcp" in cmd


def test_build_codegraph_graph_not_indexed(monkeypatch):
    from services import codegraph_service as cg

    monkeypatch.setattr(cg, "is_indexed", lambda: False)
    result = cg.build_codegraph_graph(symbol="foo")
    assert result["nodes"] == []
    assert result["error"] == "not_indexed"


def test_default_codegraph_home_is_vendor(monkeypatch):
    from services import codegraph_service as cg

    expected = cg.PROJECT_ROOT / "vendor" / "codegraph"
    assert cg.DEFAULT_CODEGRAPH_HOME == expected


def test_codegraph_home_prefers_vendor_dist(monkeypatch, tmp_path):
    from services import codegraph_service as cg

    vendor = tmp_path / "vendor" / "codegraph"
    cli_js = vendor / "dist" / "bin" / "codegraph.js"
    cli_js.parent.mkdir(parents=True)
    cli_js.write_text("// stub", encoding="utf-8")

    monkeypatch.setattr(cg, "PROJECT_ROOT", tmp_path)
    monkeypatch.setattr(cg, "DEFAULT_CODEGRAPH_HOME", vendor)
    monkeypatch.delenv("CODEGRAPH_HOME", raising=False)

    assert cg._codegraph_home() == vendor.resolve()


def test_build_codegraph_graph_uses_sdk(monkeypatch):
    from services import codegraph_service as cg

    monkeypatch.setattr(cg, "is_indexed", lambda: True)

    def fake_sdk(command, *args, **kwargs):
        assert command == "graph"
        payload = __import__("json").loads(args[0])
        assert payload["symbol"] == "alpha"
        return {
            "nodes": [{"id": "a", "name": "alpha", "kind": "function", "label": "alpha"}],
            "links": [],
            "center": "alpha",
            "sdk": "native",
        }

    monkeypatch.setattr(cg, "_run_sdk", fake_sdk)

    result = cg.build_codegraph_graph(symbol="alpha", hops=2, max_nodes=10)
    assert result["center"] == "alpha"
    assert result["sdk"] == "native"
    assert len(result["nodes"]) == 1
