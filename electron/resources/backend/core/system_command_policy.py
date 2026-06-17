"""Platform-aware shell command policy for System Assistant recipes."""

from __future__ import annotations

import re
import shlex
import sys
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Set

MAX_SYSTEM_SHELL_COMMAND_LENGTH = 4096
MAX_SYSTEM_SHELL_ARGS = 32
MAX_SYSTEM_SHELL_ARG_LENGTH = 1024

SHELL_BLOCKED_TOKENS = (";", "&", "|", ">", "<", "`", "$", "(", ")", "\n", "\r")


@dataclass(frozen=True)
class SystemCommandSpec:
    executable: str
    tier: int  # 0 = read-only diagnostic, 1 = mutating
    platforms: Set[str]  # darwin, win32, linux
    timeout_seconds: int
    risk_level: str
    read_only: bool
    max_args: int = MAX_SYSTEM_SHELL_ARGS


# Tier 0: diagnostics (may skip approval when invoked via system_assistant)
SYSTEM_COMMAND_SPECS: Dict[str, SystemCommandSpec] = {
    "ping": SystemCommandSpec("ping", 0, {"darwin", "win32", "linux"}, 15, "low", True),
    "nslookup": SystemCommandSpec("nslookup", 0, {"darwin", "win32"}, 15, "low", True),
    "scutil": SystemCommandSpec("scutil", 0, {"darwin"}, 15, "low", True),
    "networksetup": SystemCommandSpec("networksetup", 0, {"darwin"}, 15, "low", True),
    "brew": SystemCommandSpec("brew", 0, {"darwin"}, 120, "medium", False),
    "winget": SystemCommandSpec("winget", 0, {"win32"}, 300, "medium", False),
    "choco": SystemCommandSpec("choco", 0, {"win32"}, 300, "medium", False),
    "which": SystemCommandSpec("which", 0, {"darwin", "linux"}, 5, "low", True),
    "where": SystemCommandSpec("where", 0, {"win32"}, 5, "low", True),
    "curl": SystemCommandSpec("curl", 0, {"darwin", "win32", "linux"}, 30, "low", True),
    "node": SystemCommandSpec("node", 0, {"darwin", "win32", "linux"}, 10, "low", True),
    "python3": SystemCommandSpec("python3", 0, {"darwin", "linux"}, 10, "low", True),
    "python": SystemCommandSpec("python", 0, {"win32"}, 10, "low", True),
    "git": SystemCommandSpec("git", 0, {"darwin", "win32", "linux"}, 15, "low", True),
    "dscacheutil": SystemCommandSpec("dscacheutil", 1, {"darwin"}, 15, "medium", False),
    "ipconfig": SystemCommandSpec("ipconfig", 1, {"win32"}, 15, "medium", False),
}

# Subcommand allowlists per executable
SYSTEM_SUBCOMMAND_ALLOWLIST: Dict[str, Set[str]] = {
    "brew": {"list", "info", "install", "uninstall", "upgrade", "search", "--version"},
    "winget": {"list", "install", "uninstall", "search", "show", "upgrade", "--version"},
    "choco": {"list", "install", "uninstall", "search", "upgrade", "--version"},
    "scutil": {"--dns", "--proxy"},
    "networksetup": {"-listallnetworkservices", "-getwebproxy", "-getsecurewebproxy"},
    "git": {"--version", "config", "status"},
    "curl": {"-I", "-s", "-o", "-L", "-m", "--max-time"},
    "node": {"--version", "-v"},
    "python3": {"--version", "-V"},
    "python": {"--version", "-V"},
    "dscacheutil": {"-flushcache"},
    "ipconfig": {"/flushdns", "/all", "/displaydns"},
}

# ping/nslookup args are validated loosely
_PING_ARG_PATTERN = re.compile(r"^[\w.\-:/]+$")
_PACKAGE_NAME_PATTERN = re.compile(r"^[\w.\-+:/]+$")


def current_platform() -> str:
    if sys.platform == "darwin":
        return "darwin"
    if sys.platform == "win32":
        return "win32"
    return "linux"


def validate_system_shell_command(
    command: str,
    *,
    platform: Optional[str] = None,
    recipe_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Validate a shell command against System Assistant policy."""
    platform = platform or current_platform()
    command = command.strip()
    if not command:
        raise ValueError("shell command is required")
    if len(command) > MAX_SYSTEM_SHELL_COMMAND_LENGTH:
        raise ValueError("shell command is too long")
    if any(token in command for token in SHELL_BLOCKED_TOKENS):
        raise ValueError("shell command contains blocked shell control characters")

    try:
        parts = shlex.split(command, posix=(platform != "win32"))
    except ValueError as exc:
        raise ValueError(f"shell command cannot be parsed: {exc}") from exc

    if not parts:
        raise ValueError("shell command is required")
    if len(parts) > MAX_SYSTEM_SHELL_ARGS:
        raise ValueError("shell command has too many arguments")

    executable = parts[0].lower()
    if executable.endswith(".exe"):
        executable = executable[:-4]

    spec = SYSTEM_COMMAND_SPECS.get(executable)
    if spec is None:
        raise ValueError(f"system command is not allowlisted: {executable}")
    if platform not in spec.platforms:
        raise ValueError(f"command {executable} is not allowed on platform {platform}")

    _validate_subcommands(executable, parts[1:])

    tier = spec.tier
    # install/uninstall always tier 1
    if executable in {"brew", "winget", "choco"} and parts[1:2]:
        sub = parts[1].lower()
        if sub in {"install", "uninstall", "upgrade"}:
            tier = 1
            _validate_package_args(parts[2:])

    return {
        "executable": executable,
        "argv": parts,
        "tier": tier,
        "timeout_seconds": spec.timeout_seconds,
        "risk_level": spec.risk_level,
        "read_only": tier == 0 and spec.read_only,
        "requires_approval": tier >= 1 or not spec.read_only,
        "platform": platform,
        "recipe_id": recipe_id,
        "allowlisted": True,
    }


def _validate_subcommands(executable: str, args: List[str]) -> None:
    allowed = SYSTEM_SUBCOMMAND_ALLOWLIST.get(executable)
    if not allowed:
        return
    if not args:
        return
    first = args[0]
    if first.startswith("-"):
        return
    if first not in allowed:
        raise ValueError(f"subcommand not allowlisted for {executable}: {first}")


def _validate_package_args(args: List[str]) -> None:
    for arg in args:
        if arg.startswith("-"):
            continue
        if not _PACKAGE_NAME_PATTERN.match(arg):
            raise ValueError(f"invalid package name: {arg}")
