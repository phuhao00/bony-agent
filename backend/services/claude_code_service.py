"""Claude Code integration — thin wrapper around claude-agent-sdk."""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import uuid
from dataclasses import asdict, is_dataclass
from pathlib import Path
from typing import Any, AsyncIterator, Dict, Optional

from utils.logger import setup_logger
from utils.workspace_root import PROJECT_ROOT, get_workspace_git_root

logger = setup_logger("claude_code_service")

STORAGE_DIR = PROJECT_ROOT / "storage" / "claude-code"

_pending_permissions: Dict[str, asyncio.Future] = {}


def _sdk_import_ok() -> tuple[bool, str]:
    try:
        import claude_agent_sdk

        return True, str(getattr(claude_agent_sdk, "__version__", ""))
    except Exception as exc:
        return False, str(exc)


def ensure_claude_code_runtime(*, install_sdk: bool = True) -> dict[str, Any]:
    """Ensure coding config + claude-agent-sdk are available in the active Python."""
    import subprocess
    import sys

    from core.coding_provider import ensure_coding_config_auto

    env_file = PROJECT_ROOT / "backend" / ".env"
    if not env_file.is_file():
        env_file = PROJECT_ROOT / ".env"
    bootstrap = ensure_coding_config_auto(
        env_file=str(env_file) if env_file.is_file() else None,
        persist=env_file.is_file(),
    )

    sdk_ok, sdk_detail = _sdk_import_ok()
    if not sdk_ok and install_sdk:
        try:
            subprocess.check_call(
                [
                    sys.executable,
                    "-m",
                    "pip",
                    "install",
                    "claude-agent-sdk>=0.2.97",
                    "-q",
                ],
                timeout=180,
            )
            sdk_ok, sdk_detail = _sdk_import_ok()
            bootstrap["sdk_installed"] = sdk_ok
        except Exception as exc:
            logger.warning("claude-agent-sdk auto-install failed: %s", exc)
            bootstrap["sdk_install_error"] = str(exc)

    cli = resolve_claude_cli_path()
    bootstrap["sdk_available"] = sdk_ok
    bootstrap["sdk_detail"] = sdk_detail
    bootstrap["claude_bin"] = str(cli) if cli else ""
    bootstrap["runtime_ready"] = bool(sdk_ok and cli and bootstrap.get("ready"))
    return bootstrap


def resolve_claude_cli_path() -> Optional[Path]:
    """Bundled SDK binary, CLAUDE_CODE_BIN override, then PATH."""
    override = os.environ.get("CLAUDE_CODE_BIN", "").strip()
    if override:
        p = Path(override).expanduser()
        if p.is_file():
            return p.resolve()

    try:
        import claude_agent_sdk

        bundled = Path(claude_agent_sdk.__file__).resolve().parent / "_bundled" / "claude"
        if bundled.is_file():
            return bundled
    except Exception:
        pass

    which = shutil.which("claude")
    if which:
        return Path(which).resolve()
    return None


def get_health_status(*, try_bootstrap: bool = True) -> dict[str, Any]:
    from core.coding_provider import get_coding_config_summary, resolve_coding_credentials

    if try_bootstrap:
        ensure_claude_code_runtime(install_sdk=True)

    cli = resolve_claude_cli_path()
    sdk_ok, version = _sdk_import_ok()
    if not sdk_ok:
        version = ""

    creds = resolve_coding_credentials()
    coding = get_coding_config_summary()
    installed = cli is not None and sdk_ok
    ready = installed and creds.ready

    not_ready_reason = ""
    if not creds.ready:
        not_ready_reason = "missing_api_key"
    elif not sdk_ok:
        not_ready_reason = "sdk_missing"
    elif cli is None:
        not_ready_reason = "cli_missing"

    return {
        "installed": installed,
        "ready": ready,
        "sdk_available": sdk_ok,
        "claude_bin": str(cli) if cli else "",
        "version": version,
        "auth": creds.auth_mode,
        "coding": coding["current"],
        "not_ready_reason": not_ready_reason,
    }


def _extract_text_from_payload(payload: dict[str, Any]) -> str:
    """Pull display text from SDK message payloads (content blocks, strings)."""
    if isinstance(payload.get("text"), str) and payload["text"].strip():
        return payload["text"].strip()

    content = payload.get("content")
    if isinstance(content, str) and content.strip():
        return content.strip()

    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, dict):
                text = block.get("text") or block.get("thinking")
                if isinstance(text, str) and text.strip():
                    parts.append(text.strip())
            elif is_dataclass(block) and not isinstance(block, type):
                try:
                    block_dict = asdict(block)
                    text = block_dict.get("text") or block_dict.get("thinking")
                    if isinstance(text, str) and text.strip():
                        parts.append(text.strip())
                except Exception:
                    continue
        return "\n".join(parts).strip()

    for key in ("result", "message"):
        val = payload.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
    return ""


def _serialize_message(msg: Any) -> dict[str, Any]:
    if is_dataclass(msg) and not isinstance(msg, type):
        try:
            payload = {"_type": type(msg).__name__, **asdict(msg)}
            payload["text"] = _extract_text_from_payload(payload)
            return payload
        except Exception:
            pass
    if isinstance(msg, dict):
        out = dict(msg)
        out["text"] = _extract_text_from_payload(out)
        return out
    return {"_type": type(msg).__name__, "content": str(msg), "text": str(msg)}


def respond_permission(permission_id: str, allow: bool, message: str = "") -> bool:
    from claude_agent_sdk.types import PermissionResultAllow, PermissionResultDeny

    fut = _pending_permissions.get(permission_id)
    if fut is None or fut.done():
        return False
    if allow:
        fut.set_result(PermissionResultAllow())
    else:
        fut.set_result(PermissionResultDeny(message=message or "Denied by user"))
    return True


class PermissionBroker:
    def __init__(self, run_id: str) -> None:
        self.run_id = run_id
        self.events: asyncio.Queue[dict[str, Any]] = asyncio.Queue()

    async def can_use_tool(
        self,
        tool_name: str,
        tool_input: dict[str, Any],
        context: Any,
    ) -> Any:
        from claude_agent_sdk.types import PermissionResultDeny

        permission_id = str(uuid.uuid4())
        loop = asyncio.get_running_loop()
        fut: asyncio.Future = loop.create_future()
        _pending_permissions[permission_id] = fut

        ctx_dict: dict[str, Any] = {}
        if is_dataclass(context):
            try:
                ctx_dict = asdict(context)
            except Exception:
                ctx_dict = {"raw": str(context)}

        await self.events.put(
            {
                "type": "permission_request",
                "run_id": self.run_id,
                "permission_id": permission_id,
                "tool_name": tool_name,
                "tool_input": tool_input,
                "context": ctx_dict,
                "title": getattr(context, "title", None),
                "description": getattr(context, "description", None),
                "display_name": getattr(context, "display_name", None),
            }
        )

        try:
            return await asyncio.wait_for(fut, timeout=600.0)
        except asyncio.TimeoutError:
            _pending_permissions.pop(permission_id, None)
            return PermissionResultDeny(message="Permission request timed out")
        finally:
            _pending_permissions.pop(permission_id, None)


_SCOPE_LABELS = {
    "workspace": "工作区",
    "project": "项目",
    "folder": "文件夹",
    "file": "文件",
}


def _build_scoped_prompt(
    prompt: str,
    *,
    scope_type: str,
    scope_path: Optional[str],
    scope_label: Optional[str],
    workspace_root: str,
    session_id: Optional[str] = None,
) -> str:
    if session_id:
        return prompt

    st = (scope_type or "workspace").strip().lower()
    sp = (scope_path or "").strip().replace("\\", "/")
    if st in {"", "workspace"} or not sp:
        return prompt

    kind = _SCOPE_LABELS.get(st, st)
    label = (scope_label or sp).strip()
    rel = sp.lstrip("/")
    prefix = (
        f"【Coding 范围】请严格限定在以下{kind}内分析与修改代码。\n"
        f"- 范围类型: {kind}\n"
        f"- 目标路径: {rel}\n"
        f"- 显示名称: {label}\n"
        f"- 工作区根目录: {workspace_root}\n\n"
        "除非任务明确要求，否则不要修改范围外的文件。\n\n"
        "---\n\n"
    )
    return prefix + prompt


async def stream_claude_code(
    *,
    prompt: str,
    workspace_root: Optional[str] = None,
    scope_type: str = "workspace",
    scope_path: Optional[str] = None,
    scope_label: Optional[str] = None,
    session_id: Optional[str] = None,
    permission_mode: str = "default",
    model: Optional[str] = None,
) -> AsyncIterator[dict[str, Any]]:
    """Run one Claude Code turn and stream SDK messages."""
    from claude_agent_sdk import ClaudeAgentOptions, ClaudeSDKClient

    health = get_health_status()
    if not health.get("installed"):
        yield {"type": "error", "detail": "Claude Code CLI/SDK not installed"}
        return
    if not health.get("ready"):
        yield {
            "type": "error",
            "detail": (
                "Coding 引擎未配置密钥 — 请在设置中配置 CODING_API_KEY，"
                "或设置 /config/coding（支持 Anthropic / OpenRouter / 自定义网关），"
                "或运行 `claude login`"
            ),
        }
        return

    st = (scope_type or "workspace").strip().lower()
    sp = (scope_path or "").strip()

    cwd = Path(workspace_root or get_workspace_git_root()).expanduser().resolve()
    if st == "project" and sp:
        proj = Path(sp).expanduser().resolve()
        if proj.is_dir():
            cwd = proj
    if not cwd.is_dir():
        yield {"type": "error", "detail": f"Workspace not found: {cwd}"}
        return
    if st in {"folder", "file"} and sp:
        target = (cwd / sp.lstrip("/")).resolve()
        try:
            target.relative_to(cwd)
        except ValueError:
            yield {"type": "error", "detail": f"Scope path outside workspace: {sp}"}
            return
        if st == "file" and not target.is_file():
            yield {"type": "error", "detail": f"File not found: {sp}"}
            return
        if st == "folder" and not target.is_dir():
            yield {"type": "error", "detail": f"Folder not found: {sp}"}
            return

    effective_prompt = _build_scoped_prompt(
        prompt,
        scope_type=st,
        scope_path=sp,
        scope_label=scope_label,
        workspace_root=str(cwd),
        session_id=session_id,
    )

    from core.coding_provider import (
        build_claude_code_subprocess_env,
        resolve_coding_credentials,
    )

    run_id = str(uuid.uuid4())
    broker = PermissionBroker(run_id)
    cli_path = resolve_claude_cli_path()
    creds = resolve_coding_credentials()
    subprocess_env = build_claude_code_subprocess_env(creds)
    effective_model = (model or creds.model or "").strip() or None

    options = ClaudeAgentOptions(
        cwd=str(cwd),
        cli_path=str(cli_path) if cli_path else None,
        permission_mode=permission_mode,  # type: ignore[arg-type]
        can_use_tool=broker.can_use_tool,
        resume=session_id,
        include_partial_messages=True,
        env=subprocess_env,
    )
    if effective_model:
        options.model = effective_model

    yield {
        "type": "start",
        "run_id": run_id,
        "cwd": str(cwd),
        "session_id": session_id,
        "permission_mode": permission_mode,
        "scope_type": st,
        "scope_path": sp,
        "scope_label": scope_label or "",
    }

    accumulated_response = ""
    active_session_id = session_id

    try:
        async with ClaudeSDKClient(options=options) as client:
            await client.query(effective_prompt)
            async for message in client.receive_response():
                while not broker.events.empty():
                    yield await broker.events.get()
                serialized = _serialize_message(message)
                sid = serialized.get("session_id")
                if isinstance(sid, str) and sid.strip():
                    active_session_id = sid.strip()
                text = serialized.get("text") or ""
                if text and serialized.get("_type") == "AssistantMessage":
                    accumulated_response = (
                        f"{accumulated_response}\n{text}".strip()
                        if accumulated_response
                        else text
                    )
                yield {
                    "type": "message",
                    "run_id": run_id,
                    "session_id": active_session_id,
                    "payload": serialized,
                    "text": text,
                }
            while not broker.events.empty():
                yield await broker.events.get()
            yield {
                "type": "final",
                "run_id": run_id,
                "session_id": active_session_id,
                "response": accumulated_response,
            }
    except Exception as exc:
        logger.error("Claude Code stream failed: %s", exc, exc_info=True)
        yield {"type": "error", "detail": str(exc), "run_id": run_id}


def _read_command_description(path: Path) -> str:
    try:
        text = path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return path.stem
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if stripped.startswith("---"):
            continue
        return stripped[:160]
    return path.stem


def _parse_skill_frontmatter(path: Path) -> tuple[str, str]:
    try:
        text = path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return path.parent.name, path.parent.name
    if not text.startswith("---"):
        return path.parent.name, path.parent.name
    end = text.find("\n---", 3)
    if end < 0:
        return path.parent.name, path.parent.name
    block = text[3:end]
    name = path.parent.name
    description = name
    for line in block.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if ":" not in stripped:
            continue
        key, val = stripped.split(":", 1)
        key = key.strip().lower()
        val = val.strip().strip('"').strip("'")
        if key == "name" and val:
            name = val
        elif key == "description" and val:
            description = val
    return name, description[:160]


def _discover_markdown_commands(
    commands_dir: Path,
    *,
    category: str,
) -> list[dict[str, str]]:
    if not commands_dir.is_dir():
        return []
    out: list[dict[str, str]] = []
    for path in sorted(commands_dir.rglob("*.md")):
        if not path.is_file():
            continue
        rel = path.relative_to(commands_dir)
        name = "/".join(rel.with_suffix("").parts)
        if not name:
            continue
        out.append(
            {
                "name": name,
                "description": _read_command_description(path),
                "scope": "sdk",
                "category": category,
            }
        )
    return out


def _discover_skill_commands(skills_dir: Path) -> list[dict[str, str]]:
    if not skills_dir.is_dir():
        return []
    out: list[dict[str, str]] = []
    for path in sorted(skills_dir.glob("*/SKILL.md")):
        if not path.is_file():
            continue
        name, description = _parse_skill_frontmatter(path)
        if not name:
            continue
        out.append(
            {
                "name": name,
                "description": description or f"Skill: {name}",
                "scope": "sdk",
                "category": "skill",
            }
        )
    return out


def list_workspace_slash_commands(workspace_root: Optional[str]) -> list[dict[str, str]]:
    """Discover project slash commands from .claude/commands, skills, and .cursor/commands."""
    root = (workspace_root or "").strip()
    if not root:
        return []
    base = Path(root).expanduser().resolve()
    if not base.is_dir():
        return []

    seen: set[str] = set()
    out: list[dict[str, str]] = []

    def _append(items: list[dict[str, str]]) -> None:
        for item in items:
            key = str(item.get("name", "")).lower()
            if not key or key in seen:
                continue
            seen.add(key)
            out.append(item)

    _append(_discover_markdown_commands(base / ".claude" / "commands", category="custom"))
    _append(_discover_markdown_commands(base / ".cursor" / "commands", category="custom"))
    _append(_discover_skill_commands(base / ".agent" / "skills"))
    _append(_discover_skill_commands(base / ".agents" / "skills"))
    return out
