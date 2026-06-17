"""Optional auth dependencies for protected API routes."""

from __future__ import annotations

import os
from typing import Optional

from fastapi import Depends, HTTPException, status

from utils.auth import get_current_user, optional_current_user, _credentials_exception


def _auth_required() -> bool:
    return os.getenv("AUTH_REQUIRED", "false").strip().lower() in ("1", "true", "yes")


def require_auth_when_enabled(
    current_user: Optional[dict] = Depends(optional_current_user),
) -> Optional[dict]:
    """Require Bearer auth when AUTH_REQUIRED=true; otherwise allow anonymous."""
    if _auth_required() and not current_user:
        raise _credentials_exception("未提供认证令牌或令牌无效")
    return current_user
