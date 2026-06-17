"""CORS origin configuration for FastAPI."""

from __future__ import annotations

import os


def get_cors_origins() -> list[str]:
    """Return allowed CORS origins from CORS_ALLOW_ORIGINS (comma-separated).

    Defaults to local dev origins. Set CORS_ALLOW_ORIGINS=* to allow all (not
    recommended for production).
    """
    raw = (os.getenv("CORS_ALLOW_ORIGINS") or "").strip()
    if raw == "*":
        return ["*"]
    if raw:
        return [origin.strip() for origin in raw.split(",") if origin.strip()]
    return [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "https://www.figma.com",
    ]
