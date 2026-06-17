"""Validate CLI commands for desktop app automation."""

from __future__ import annotations

import glob
import os
import shlex
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

from core.system_command_policy import current_platform

SHELL_BLOCKED_TOKENS = (";", "&", "|", ">", "<", "`", "$", "(", ")", "\n", "\r")

_EXECUTABLE_CACHE: Dict[str, Any] = {"ts": 0.0, "data": None}
_CACHE_TTL = 300

APP_EXECUTABLE_HINTS: Dict[str, List[str]] = {
    "blender": ["blender", "/Applications/Blender.app/Contents/MacOS/Blender"],
    "photoshop": ["Photoshop", "/Applications/Adobe Photoshop 2024/Adobe Photoshop 2024.app/Contents/MacOS/Adobe Photoshop 2024"],
    "unity": ["Unity", "/Applications/Unity/Hub/Editor"],
    "unreal": ["UnrealEditor-Cmd", "UnrealEditor"],
    "figma": [
        "/Applications/Figma.app/Contents/MacOS/Figma",
        "~/Applications/Figma.app/Contents/MacOS/Figma",
        r"%LOCALAPPDATA%\Figma\Figma.exe",
        r"C:\Users\*\AppData\Local\Figma\Figma.exe",
    ],
}

BLENDER_FLAGS: Set[str] = {"-b", "-P", "-o", "-F", "-x", "-a", "-E", "-f", "--background"}
UNITY_FLAGS: Set[str] = {"-batchmode", "-quit", "-projectPath", "-executeMethod", "-buildTarget", "-logFile"}
UNREAL_FLAGS: Set[str] = {"-run=pythonscript", "-script="}
PHOTOSHOP_FLAGS: Set[str] = {"-r"}

TIMEOUT_BY_MODE: Dict[str, int] = {
    "blender_batch_render": 600,
    "batch_render": 600,
    "render": 600,
    "blender_batch_python": 600,
    "batch_python": 600,
    "python": 600,
    "photoshop_extendscript": 120,
    "jsx": 120,
    "extendscript": 120,
    "unity_batch_method": 600,
    "unreal_editor_headless": 600,
}


def _which(executable: str) -> Optional[str]:
    try:
        if sys.platform == "win32":
            cmd = ["where", executable]
        else:
            cmd = ["which", executable]
        completed = subprocess.run(cmd, capture_output=True, text=True, timeout=5, check=False)
        if completed.returncode == 0 and (completed.stdout or "").strip():
            return (completed.stdout or "").strip().splitlines()[0].strip()
    except (subprocess.TimeoutExpired, OSError):
        return None
    return None


def _resolve_executable_path(app_id: str) -> Optional[str]:
    aid = (app_id or "").strip().lower()
    hints = APP_EXECUTABLE_HINTS.get(aid, [aid])
    for hint in hints:
        if hint.startswith("/") or "\\" in hint:
            expanded = os.path.expandvars(hint)
            if "*" in expanded or "?" in expanded:
                for match in glob.glob(expanded):
                    path = Path(match)
                    if path.is_file():
                        return str(path.resolve())
                continue
            path = Path(expanded).expanduser()
            if path.is_file():
                return str(path.resolve())
            if path.is_dir():
                for exe in path.rglob("*"):
                    if exe.is_file() and exe.suffix.lower() in {".app", ""}:
                        return str(exe.resolve())
        found = _which(hint)
        if found:
            return found
    return None


def probe_app_executables(*, use_cache: bool = True) -> Dict[str, Optional[str]]:
    now = time.time()
    if use_cache and _EXECUTABLE_CACHE["data"] is not None and now - _EXECUTABLE_CACHE["ts"] < _CACHE_TTL:
        return dict(_EXECUTABLE_CACHE["data"])

    result = {app_id: _resolve_executable_path(app_id) for app_id in APP_EXECUTABLE_HINTS}
    _EXECUTABLE_CACHE["ts"] = now
    _EXECUTABLE_CACHE["data"] = result
    return dict(result)


def _validate_paths_in_plan(plan: Dict[str, Any], allowed_roots: Optional[List[Path]] = None) -> None:
    if not allowed_roots:
        return
    path_keys = ("blend_file", "script_path", "project_path", "uproject_file", "output_dir", "output_dir_hint")
    for key in path_keys:
        value = plan.get(key) or ""
        if not value or not isinstance(value, str):
            continue
        if value.startswith("//"):
            continue
        target = Path(value).expanduser().resolve()
        ok = any(target == root or root in target.parents for root in allowed_roots)
        if not ok:
            raise ValueError(f"path outside allowed roots: {key}={value}")


def _validate_argv_flags(app_id: str, argv: List[str]) -> None:
    aid = (app_id or "").strip().lower()
    flags_present = {arg.split("=", 1)[0] for arg in argv if arg.startswith("-")}
    if aid == "blender":
        for flag in flags_present:
            if flag not in BLENDER_FLAGS and not flag.startswith("-"):
                raise ValueError(f"blender flag not allowlisted: {flag}")
    elif aid == "unity":
        for flag in flags_present:
            if flag not in UNITY_FLAGS:
                raise ValueError(f"unity flag not allowlisted: {flag}")
    elif aid == "photoshop":
        for flag in flags_present:
            if flag not in PHOTOSHOP_FLAGS:
                raise ValueError(f"photoshop flag not allowlisted: {flag}")


def resolve_argv_from_plan(plan: Dict[str, Any]) -> List[str]:
    argv = list(plan.get("argv_template") or [])
    if not argv:
        raise ValueError("automation plan has no argv_template")
    app_id = (plan.get("app_id") or "").strip().lower()
    resolved = probe_app_executables().get(app_id)
    if resolved and argv:
        argv = [resolved] + argv[1:]
    return argv


def validate_app_command(
    command: str,
    *,
    plan: Optional[Dict[str, Any]] = None,
    allowed_roots: Optional[List[Path]] = None,
) -> Dict[str, Any]:
    command = (command or "").strip()
    if not command:
        raise ValueError("shell command is required")
    if any(token in command for token in SHELL_BLOCKED_TOKENS):
        raise ValueError("shell command contains blocked shell control characters")

    automation_plan = plan or {}
    app_id = (automation_plan.get("app_id") or "").strip().lower()
    mode = (automation_plan.get("mode") or "").strip().lower()

    try:
        parts = shlex.split(command, posix=(sys.platform != "win32"))
    except ValueError as exc:
        raise ValueError(f"shell command cannot be parsed: {exc}") from exc
    if not parts:
        raise ValueError("shell command is required")

    expected_argv = resolve_argv_from_plan(automation_plan) if automation_plan.get("argv_template") else parts
    if automation_plan.get("argv_template"):
        if len(parts) != len(expected_argv):
            raise ValueError("shell command argv length does not match automation plan")
        if parts[1:] != expected_argv[1:]:
            raise ValueError("shell command argv does not match automation plan")

    _validate_argv_flags(app_id, parts)
    _validate_paths_in_plan(automation_plan, allowed_roots)

    timeout = TIMEOUT_BY_MODE.get(mode, 300)
    return {
        "executable": parts[0],
        "argv": parts,
        "timeout_seconds": timeout,
        "read_only": False,
        "app_automation": True,
        "creative_app": True,
        "app_id": app_id,
        "mode": mode,
        "platform": current_platform(),
    }
