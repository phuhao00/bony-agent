"""Git / SSH / dev toolchain profiling for Programmer Agent."""

from __future__ import annotations

import os
import subprocess
from pathlib import Path
from typing import Any, Dict, List, Optional

from core.programmer_command_policy import current_platform, validate_programmer_shell_command
from utils.logger import setup_logger
from utils.workspace_root import get_workspace_git_root

logger = setup_logger("dev_environment")


def _run_git(args: List[str], *, cwd: Optional[Path] = None, timeout: int = 15) -> Dict[str, Any]:
    command = "git " + " ".join(args)
    try:
        policy = validate_programmer_shell_command(command, read_only=True)
        completed = subprocess.run(
            policy["argv"],
            cwd=str(cwd or get_workspace_git_root()),
            capture_output=True,
            text=True,
            timeout=timeout,
            shell=False,
            check=False,
            env={**os.environ, "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8"},
        )
        return {
            "success": completed.returncode == 0,
            "command": command,
            "stdout": (completed.stdout or "")[:8192],
            "stderr": (completed.stderr or "")[:2048],
        }
    except ValueError as exc:
        return {"success": False, "command": command, "error": str(exc)}


def _read_ssh_config() -> Dict[str, Any]:
    ssh_dir = Path.home() / ".ssh"
    config_path = ssh_dir / "config"
    hosts: List[Dict[str, str]] = []
    if config_path.is_file():
        current_host: Dict[str, str] = {}
        for line in config_path.read_text(encoding="utf-8", errors="replace").splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                continue
            if stripped.lower().startswith("host "):
                if current_host:
                    hosts.append(current_host)
                current_host = {"host": stripped.split(None, 1)[-1]}
            elif " " in stripped:
                key, _, val = stripped.partition(" ")
                current_host[key.lower()] = val.strip()
        if current_host:
            hosts.append(current_host)
    return {"config_path": str(config_path), "exists": config_path.is_file(), "hosts": hosts[:50]}


def _list_ssh_public_keys() -> List[Dict[str, str]]:
    ssh_dir = Path.home() / ".ssh"
    keys: List[Dict[str, str]] = []
    if not ssh_dir.is_dir():
        return keys
    for pub in sorted(ssh_dir.glob("*.pub")):
        try:
            content = pub.read_text(encoding="utf-8", errors="replace").strip()
            parts = content.split()
            keys.append({
                "path": str(pub),
                "type": parts[0] if parts else "unknown",
                "fingerprint_hint": parts[-1][:32] if len(parts) > 1 else "",
            })
        except OSError:
            continue
    return keys


def get_git_profile() -> Dict[str, Any]:
    root = get_workspace_git_root()
    is_repo = (root / ".git").exists()
    profile: Dict[str, Any] = {
        "workspace_root": str(root),
        "is_git_repo": is_repo,
        "platform": current_platform(),
    }
    if not is_repo:
        return profile

    for key, args in (
        ("branch", ["rev-parse", "--abbrev-ref", "HEAD"]),
        ("commit", ["rev-parse", "--short", "HEAD"]),
        ("remotes", ["remote", "-v"]),
        ("user_name", ["config", "user.name"]),
        ("user_email", ["config", "user.email"]),
        ("status_short", ["status", "--short"]),
    ):
        result = _run_git(args, cwd=root)
        profile[key] = result.get("stdout", "").strip() if result.get("success") else None
        if not result.get("success") and result.get("stderr"):
            profile.setdefault("errors", {})[key] = result["stderr"][:500]

    return profile


def get_ssh_profile() -> Dict[str, Any]:
    ssh_dir = Path.home() / ".ssh"
    return {
        "ssh_dir": str(ssh_dir),
        "ssh_dir_exists": ssh_dir.is_dir(),
        "public_keys": _list_ssh_public_keys(),
        "config": _read_ssh_config(),
        "known_hosts_exists": (ssh_dir / "known_hosts").is_file(),
        "agent_socket": os.environ.get("SSH_AUTH_SOCK"),
    }


def build_dev_environment_profile() -> Dict[str, Any]:
    git_profile = get_git_profile()
    ssh_profile = get_ssh_profile()
    tool_checks: List[Dict[str, Any]] = []
    for cmd in ("node --version", "python3 --version", "docker --version", "go version"):
        try:
            policy = validate_programmer_shell_command(cmd, read_only=True)
            completed = subprocess.run(
                policy["argv"],
                capture_output=True,
                text=True,
                timeout=10,
                shell=False,
                check=False,
            )
            tool_checks.append({
                "command": cmd,
                "success": completed.returncode == 0,
                "stdout": (completed.stdout or completed.stderr or "").strip()[:200],
            })
        except ValueError as exc:
            tool_checks.append({"command": cmd, "success": False, "error": str(exc)})

    return {
        "platform": current_platform(),
        "git": git_profile,
        "ssh": ssh_profile,
        "dev_tools": tool_checks,
    }
