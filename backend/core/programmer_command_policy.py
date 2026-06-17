"""Shell command policy for Programmer Agent (git, docker, infra CLIs)."""

from __future__ import annotations

import re
import shlex
import sys
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Set

MAX_COMMAND_LENGTH = 4096
MAX_ARGS = 48
MAX_ARG_LENGTH = 1024
SHELL_BLOCKED_TOKENS = (";", "&", "|", ">", "<", "`", "$", "(", ")", "\n", "\r")


@dataclass(frozen=True)
class ProgrammerCommandSpec:
    executable: str
    read_only: bool
    platforms: Set[str]
    timeout_seconds: int = 30
    risk_level: str = "low"


PROGRAMMER_COMMAND_SPECS: Dict[str, ProgrammerCommandSpec] = {
    "git": ProgrammerCommandSpec("git", True, {"darwin", "win32", "linux"}, 30, "low"),
    "docker": ProgrammerCommandSpec("docker", False, {"darwin", "win32", "linux"}, 120, "high"),
    "brew": ProgrammerCommandSpec("brew", False, {"darwin"}, 120, "medium"),
    "redis-cli": ProgrammerCommandSpec("redis-cli", True, {"darwin", "win32", "linux"}, 10, "low"),
    "mysqladmin": ProgrammerCommandSpec("mysqladmin", True, {"darwin", "win32", "linux"}, 15, "low"),
    "mongosh": ProgrammerCommandSpec("mongosh", True, {"darwin", "win32", "linux"}, 20, "low"),
    "mongo": ProgrammerCommandSpec("mongo", True, {"darwin", "win32", "linux"}, 20, "low"),
    "etcdctl": ProgrammerCommandSpec("etcdctl", True, {"darwin", "win32", "linux"}, 15, "low"),
    "consul": ProgrammerCommandSpec("consul", True, {"darwin", "win32", "linux"}, 15, "low"),
    "pg_isready": ProgrammerCommandSpec("pg_isready", True, {"darwin", "win32", "linux"}, 10, "low"),
    "rabbitmqctl": ProgrammerCommandSpec("rabbitmqctl", True, {"darwin", "win32", "linux"}, 20, "low"),
    "curl": ProgrammerCommandSpec("curl", True, {"darwin", "win32", "linux"}, 15, "low"),
    "node": ProgrammerCommandSpec("node", True, {"darwin", "win32", "linux"}, 10, "low"),
    "python3": ProgrammerCommandSpec("python3", True, {"darwin", "win32", "linux"}, 60, "low"),
    "python": ProgrammerCommandSpec("python", True, {"win32"}, 60, "low"),
    "pytest": ProgrammerCommandSpec("pytest", True, {"darwin", "win32", "linux"}, 300, "low"),
    "which": ProgrammerCommandSpec("which", True, {"darwin", "linux"}, 5, "low"),
    "where": ProgrammerCommandSpec("where", True, {"win32"}, 5, "low"),
    "ssh": ProgrammerCommandSpec("ssh", True, {"darwin", "win32", "linux"}, 20, "medium"),
}

READ_ONLY_SUBCOMMANDS: Dict[str, Set[str]] = {
    "git": {
        "status", "diff", "log", "branch", "remote", "rev-parse", "config", "show",
        "stash", "tag", "--version", "-v",
    },
    "docker": {"ps", "inspect", "logs", "images", "version", "info"},
    "brew": {"services", "list", "info", "--version"},
    "redis-cli": {"ping", "info", "get", "keys"},
    "curl": {"-s", "-I", "-L", "-m", "--max-time"},
    "consul": {"members", "info", "catalog"},
    "etcdctl": {"endpoint", "get", "member"},
    "mongosh": {"--eval", "--version"},
    "mongo": {"--eval", "--version"},
    "mysqladmin": {"ping", "status"},
    "pg_isready": set(),
    "rabbitmqctl": {"status", "list_queues"},
    "node": {"--version", "-v"},
    "python3": {"--version", "-m"},
    "python": {"--version", "-m"},
    "pytest": {"--version", "-v", "--collect-only"},
    "ssh": {"-T", "-o"},
}

MUTATING_SUBCOMMANDS: Dict[str, Set[str]] = {
    "docker": {"start", "stop", "restart", "run", "rm"},
    "brew": {"services"},
    "git": {"add", "commit", "push", "pull", "checkout", "merge", "rebase"},
}


def current_platform() -> str:
    if sys.platform == "darwin":
        return "darwin"
    if sys.platform == "win32":
        return "win32"
    return "linux"


def validate_programmer_shell_command(
    command: str,
    *,
    platform: Optional[str] = None,
    read_only: bool = False,
) -> Dict[str, Any]:
    platform = platform or current_platform()
    command = command.strip()
    if not command:
        raise ValueError("shell command is required")
    if len(command) > MAX_COMMAND_LENGTH:
        raise ValueError("shell command is too long")
    if any(token in command for token in SHELL_BLOCKED_TOKENS):
        raise ValueError("shell command contains blocked shell control characters")

    try:
        parts = shlex.split(command, posix=(platform != "win32"))
    except ValueError as exc:
        raise ValueError(f"shell command cannot be parsed: {exc}") from exc

    if not parts or len(parts) > MAX_ARGS:
        raise ValueError("invalid shell command argument count")

    exe = parts[0].split("/")[-1].lower()
    if exe.endswith(".exe"):
        exe = exe[:-4]

    spec = PROGRAMMER_COMMAND_SPECS.get(exe)
    if not spec:
        raise ValueError(f"executable not allowed: {exe}")
    if platform not in spec.platforms:
        raise ValueError(f"executable {exe} is not allowed on {platform}")

    for arg in parts[1:]:
        if len(arg) > MAX_ARG_LENGTH:
            raise ValueError("shell argument is too long")

    sub = parts[1] if len(parts) > 1 else ""
    if read_only and not spec.read_only:
        allowed = READ_ONLY_SUBCOMMANDS.get(exe, set())
        if sub not in allowed and exe not in {"curl", "pg_isready", "pytest"}:
            raise ValueError(f"read-only mode: subcommand not allowed for {exe}: {sub}")

    if read_only and exe in MUTATING_SUBCOMMANDS:
        mut = MUTATING_SUBCOMMANDS[exe]
        if sub in mut:
            raise ValueError(f"read-only mode: mutating subcommand blocked: {exe} {sub}")

    return {
        "argv": parts,
        "executable": exe,
        "read_only": read_only or spec.read_only,
        "risk_level": spec.risk_level,
        "timeout_seconds": spec.timeout_seconds,
    }
