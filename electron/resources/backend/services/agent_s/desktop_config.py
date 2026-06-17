"""Native desktop GUI automation (PC apps) configuration."""

from __future__ import annotations

import os
from dataclasses import dataclass


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
class NativeDesktopConfig:
    engine: str
    max_steps: int
    enable_reflection: bool
    focus_retries: int
    focus_wait_s: float
    auto_focus: bool
    launch_wait_s: float
    locate_retries: int
    locate_wait_s: float
    activate_wait_s: float
    step_delay_s: float

    @classmethod
    def from_env(cls) -> "NativeDesktopConfig":
        return cls(
            engine=(os.getenv("NATIVE_USE_ENGINE") or "agent_s").strip().lower(),
            max_steps=_env_int("NATIVE_USE_MAX_STEPS", 15),
            enable_reflection=_env_bool("NATIVE_USE_ENABLE_REFLECTION", True),
            focus_retries=_env_int("NATIVE_USE_FOCUS_RETRIES", 3),
            focus_wait_s=float(os.getenv("NATIVE_USE_FOCUS_WAIT_S") or "1.0"),
            auto_focus=_env_bool("NATIVE_USE_AUTO_FOCUS", False),
            launch_wait_s=float(os.getenv("NATIVE_USE_LAUNCH_WAIT_S") or "2.5"),
            locate_retries=_env_int("NATIVE_USE_LOCATE_RETRIES", 12),
            locate_wait_s=float(os.getenv("NATIVE_USE_LOCATE_WAIT_S") or "0.8"),
            activate_wait_s=float(os.getenv("NATIVE_USE_ACTIVATE_WAIT_S") or "1.5"),
            step_delay_s=float(os.getenv("NATIVE_USE_STEP_DELAY_S") or "0.5"),
        )


def get_native_engine() -> str:
    return NativeDesktopConfig.from_env().engine
