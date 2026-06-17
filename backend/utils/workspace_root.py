"""Resolve Git workspace root (aligned with web/lib/server/workspace-git-root.ts)."""

from __future__ import annotations

import contextvars
import os
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator, Optional

PROJECT_ROOT = Path(__file__).resolve().parents[2]

_request_workspace_root: contextvars.ContextVar[Optional[Path]] = contextvars.ContextVar(
    "request_workspace_root",
    default=None,
)


def get_workspace_git_root() -> Path:
    """Return the Git working copy root for code analysis and workspace file reads."""
    override = _request_workspace_root.get()
    if override is not None:
        return override
    raw = os.environ.get("WORKSPACE_GIT_ROOT", "").strip()
    if raw:
        return Path(raw).expanduser().resolve()
    return PROJECT_ROOT.resolve()


@contextmanager
def workspace_root_scope(root: Optional[str]) -> Iterator[None]:
    """Temporarily override workspace root for a single chat/orchestrator request."""
    token = None
    if root and str(root).strip():
        token = _request_workspace_root.set(Path(str(root).strip()).expanduser().resolve())
    try:
        yield
    finally:
        if token is not None:
            _request_workspace_root.reset(token)
