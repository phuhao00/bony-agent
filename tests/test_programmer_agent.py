"""Tests for Programmer Agent service and recipes."""

from __future__ import annotations

import pytest


def test_list_programmer_recipes():
    from core.programmer_recipes import list_recipes

    recipes = list_recipes()
    ids = {r["id"] for r in recipes}
    assert "git.inspect" in ids
    assert "infra.scan_all" in ids
    assert "infra.start" in ids


def test_infra_component_catalog():
    from core.infra_components import list_components, probe_component

    catalog = list_components()
    ids = {c["id"] for c in catalog}
    assert "redis" in ids
    assert "mysql" in ids
    assert "mongodb" in ids
    assert "etcd" in ids
    assert "consul" in ids
    assert "nsq" in ids

    result = probe_component("redis")
    assert result["id"] == "redis"
    assert "installed" in result
    assert "likely_running" in result


def test_dev_environment_profile():
    from core.dev_environment import build_dev_environment_profile, get_ssh_profile

    profile = build_dev_environment_profile()
    assert "platform" in profile
    assert "git" in profile
    assert "ssh" in profile

    ssh = get_ssh_profile()
    assert "public_keys" in ssh
    assert isinstance(ssh["public_keys"], list)


def test_programmer_git_inspect_recipe():
    from services import programmer_service

    result = programmer_service.start_recipe("git.inspect")
    assert result.get("success") is True
    assert result.get("status") == "completed"
    assert "result" in result
    assert "git" in result["result"]
    assert "ssh" in result["result"]


def test_programmer_infra_scan_recipe():
    from services import programmer_service

    result = programmer_service.start_recipe("infra.scan_all")
    assert result.get("success") is True
    assert "components" in result["result"]


def test_programmer_agent_module_exports():
    from agents.programmer_agent import (
        AGENT_ID,
        AGENT_CAPABILITIES,
        get_programmer_base_agent,
    )

    assert AGENT_ID == "programmer_agent"
    assert "dev_infra_manage" in AGENT_CAPABILITIES
    agent = get_programmer_base_agent()
    assert agent.agent_id == "programmer_agent"


def test_programmer_command_policy_blocks_injection():
    from core.programmer_command_policy import validate_programmer_shell_command

    with pytest.raises(ValueError):
        validate_programmer_shell_command("git status; rm -rf /")

    policy = validate_programmer_shell_command("git status --short", read_only=True)
    assert policy["executable"] == "git"
