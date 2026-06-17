"""Tests for coding provider credential resolution."""

import os
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1] / "backend"
sys.path.insert(0, str(BACKEND))

from core.coding_provider import (  # noqa: E402
    apply_coding_config_update,
    build_claude_code_subprocess_env,
    ensure_coding_config_auto,
    resolve_coding_credentials,
)


@pytest.fixture(autouse=True)
def _clear_coding_env(monkeypatch):
    for key in (
        "CODING_PROVIDER",
        "CODING_API_KEY",
        "CODING_BASE_URL",
        "CODING_MODEL",
        "ANTHROPIC_API_KEY",
        "OPENROUTER_API_KEY",
    ):
        monkeypatch.delenv(key, raising=False)


def test_resolve_dedicated_coding_key(monkeypatch):
    monkeypatch.setenv("CODING_API_KEY", "sk-coding")
    monkeypatch.setenv("CODING_BASE_URL", "https://proxy.example.com")
    monkeypatch.setenv("CODING_MODEL", "claude-opus-4-5")
    creds = resolve_coding_credentials()
    assert creds.api_key == "sk-coding"
    assert creds.base_url == "https://proxy.example.com"
    assert creds.model == "claude-opus-4-5"
    assert creds.key_source == "CODING_API_KEY"
    assert creds.ready is True


def test_default_provider_is_qwen_with_coder_plus(monkeypatch):
    monkeypatch.setenv("ALIBABA_API_KEY", "sk-dash")
    creds = resolve_coding_credentials()
    assert creds.provider_id == "qwen"
    assert creds.api_key == "sk-dash"
    assert creds.base_url == "https://dashscope.aliyuncs.com/apps/anthropic"
    assert creds.model == "qwen3-coder-next"
    assert creds.key_source == "ALIBABA_API_KEY"


def test_auto_falls_back_to_openrouter(monkeypatch):
    monkeypatch.setenv("CODING_PROVIDER", "auto")
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-key")
    creds = resolve_coding_credentials()
    assert creds.api_key == "sk-or-key"
    assert creds.base_url == "https://openrouter.ai/api"
    assert creds.key_source == "OPENROUTER_API_KEY"


def test_build_subprocess_env_maps_anthropic_vars(monkeypatch):
    monkeypatch.setenv("CODING_API_KEY", "sk-test")
    monkeypatch.setenv("CODING_BASE_URL", "https://dashscope.aliyuncs.com/apps/anthropic")
    monkeypatch.setenv("CODING_MODEL", "qwen3-coder-plus")
    env = build_claude_code_subprocess_env()
    assert env["ANTHROPIC_API_KEY"] == "sk-test"
    assert env["ANTHROPIC_AUTH_TOKEN"] == "sk-test"
    assert env["ANTHROPIC_BASE_URL"] == "https://dashscope.aliyuncs.com/apps/anthropic"
    assert env["ANTHROPIC_MODEL"] == "qwen3-coder-plus"


def test_ensure_coding_config_auto_from_alibaba(monkeypatch, tmp_path):
    monkeypatch.setenv("ALIBABA_API_KEY", "sk-alibaba")
    monkeypatch.setenv("LLM_PROVIDER", "alibaba")
    env_file = tmp_path / ".env"
    env_file.write_text("LLM_PROVIDER=alibaba\nALIBABA_API_KEY=sk-alibaba\n", encoding="utf-8")

    result = ensure_coding_config_auto(env_file=str(env_file), persist=True)
    assert result["bootstrapped"] is True
    assert result["ready"] is True
    assert result["provider"] == "qwen"
    assert result["model"] == "qwen3-coder-next"
    assert "CODING_PROVIDER=qwen" in env_file.read_text(encoding="utf-8")


def test_apply_and_persist_update(monkeypatch):
    changes = apply_coding_config_update(
        provider="openrouter",
        api_key="sk-new",
        model="anthropic/claude-sonnet-4",
    )
    assert any("CODING_PROVIDER=openrouter" in c for c in changes)
    assert os.environ.get("CODING_API_KEY") == "sk-new"
    assert os.environ.get("CODING_MODEL") == "anthropic/claude-sonnet-4"
