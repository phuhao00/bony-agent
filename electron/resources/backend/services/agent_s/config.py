"""Computer Use / Agent-S configuration from environment."""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional


def _env_bool(name: str, default: bool) -> bool:
    raw = (os.getenv(name) or "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    raw = (os.getenv(name) or "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


@dataclass(frozen=True)
class AgentSConfig:
    engine: str
    max_steps: int
    enable_reflection: bool
    enable_local_env: bool
    viewport_width: int
    viewport_height: int
    ground_url: str
    ground_model: str
    ground_width: int
    ground_height: int
    ground_api_key: str

    @classmethod
    def from_env(cls) -> "AgentSConfig":
        return cls(
            engine=(os.getenv("COMPUTER_USE_ENGINE") or "agent_s").strip().lower(),
            max_steps=_env_int("COMPUTER_USE_MAX_STEPS", 15),
            enable_reflection=_env_bool("COMPUTER_USE_ENABLE_REFLECTION", True),
            enable_local_env=_env_bool("COMPUTER_USE_ENABLE_LOCAL_ENV", False),
            viewport_width=_env_int("COMPUTER_USE_VIEWPORT_WIDTH", 1280),
            viewport_height=_env_int("COMPUTER_USE_VIEWPORT_HEIGHT", 800),
            ground_url=(os.getenv("COMPUTER_USE_GROUND_URL") or "").strip(),
            ground_model=(os.getenv("COMPUTER_USE_GROUND_MODEL") or "ui-tars-1.5-7b").strip(),
            ground_width=_env_int("COMPUTER_USE_GROUND_WIDTH", 1920),
            ground_height=_env_int("COMPUTER_USE_GROUND_HEIGHT", 1080),
            ground_api_key=(os.getenv("COMPUTER_USE_GROUND_API_KEY") or "").strip(),
        )

    def grounding_enabled(self) -> bool:
        return bool(self.ground_url)


def get_engine() -> str:
    return AgentSConfig.from_env().engine


def resolve_require_approval(requested: bool) -> bool:
    """环境变量可强制开关审批：COMPUTER_USE_REQUIRE_APPROVAL=false 则始终全自动。"""
    raw = (os.getenv("COMPUTER_USE_REQUIRE_APPROVAL") or "").strip().lower()
    if raw in {"0", "false", "no", "off"}:
        return False
    if raw in {"1", "true", "yes", "on"}:
        return True
    return bool(requested)
