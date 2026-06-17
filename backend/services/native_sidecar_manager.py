"""Ensure localhost native desktop sidecar is running."""

from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Dict, Optional

from utils.logger import setup_logger

logger = setup_logger("native_sidecar_manager")

PROJECT_ROOT = Path(__file__).resolve().parents[2]
SIDECAR_SCRIPT = PROJECT_ROOT / "backend" / "services" / "native_sidecar_server.py"

_sidecar_proc: Optional[subprocess.Popen] = None


def _clear_sidecar_files() -> None:
    from services.native_bridges.sidecar_client import SIDECAR_PORT_FILE, SIDECAR_TOKEN_FILE

    for path in (SIDECAR_PORT_FILE, SIDECAR_TOKEN_FILE):
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass


def _kill_listener_on_port(port: int) -> None:
    try:
        completed = subprocess.run(
            ["lsof", "-ti", f":{port}"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        for pid in (completed.stdout or "").split():
            pid = pid.strip()
            if pid.isdigit():
                subprocess.run(["kill", pid], timeout=3, check=False)
    except (subprocess.TimeoutExpired, OSError):
        pass


def _restart_sidecar(*, reason: str) -> None:
    global _sidecar_proc
    from services.native_bridges.sidecar_client import SIDECAR_PORT_FILE, sidecar_health

    logger.warning("Restarting native sidecar: %s", reason)
    health = sidecar_health()
    port = health.get("port")
    if isinstance(port, int) and port > 0:
        _kill_listener_on_port(port)

    if _sidecar_proc is not None and _sidecar_proc.poll() is None:
        try:
            _sidecar_proc.terminate()
        except OSError:
            pass
    _sidecar_proc = None
    _clear_sidecar_files()


def ensure_sidecar_running(*, timeout: float = 8.0) -> Dict[str, Any]:
    """Start native_sidecar_server.py when health check fails or Sidecar is outdated."""
    from services.native_bridges.sidecar_client import (
        sidecar_has_foreground,
        sidecar_has_open_locate,
        sidecar_health,
    )

    health = sidecar_health()
    if health.get("ok") and (not sidecar_has_foreground() or not sidecar_has_open_locate()):
        missing = []
        if not sidecar_has_foreground():
            missing.append("/foreground")
        if not sidecar_has_open_locate():
            missing.append("/app/open-locate")
        _restart_sidecar(reason=f"missing endpoints: {', '.join(missing)}")
        health = {"ok": False, "reason": "outdated_sidecar"}

    if health.get("ok"):
        health["has_foreground"] = sidecar_has_foreground()
        health["has_open_locate"] = sidecar_has_open_locate()
        return health

    global _sidecar_proc

    if health.get("reason") == "unreachable":
        _clear_sidecar_files()
        if _sidecar_proc is not None and _sidecar_proc.poll() is None:
            try:
                _sidecar_proc.terminate()
            except OSError:
                pass
            _sidecar_proc = None

    if not SIDECAR_SCRIPT.is_file():
        return {"ok": False, "reason": "sidecar_script_missing"}

    if _sidecar_proc is None or _sidecar_proc.poll() is not None:
        try:
            log_path = PROJECT_ROOT / "logs" / "native-sidecar.log"
            log_path.parent.mkdir(parents=True, exist_ok=True)
            log_fd = open(log_path, "a", encoding="utf-8")
            _sidecar_proc = subprocess.Popen(
                [sys.executable, str(SIDECAR_SCRIPT)],
                cwd=str(PROJECT_ROOT),
                stdout=log_fd,
                stderr=log_fd,
            )
            logger.info("Started native sidecar (pid=%s)", _sidecar_proc.pid)
        except OSError as exc:
            logger.warning("Failed to start native sidecar: %s", exc)
            return {"ok": False, "reason": "start_failed", "error": str(exc)}

    deadline = time.time() + max(0.5, timeout)
    while time.time() < deadline:
        health = sidecar_health()
        if health.get("ok"):
            return health
        time.sleep(0.2)

    return sidecar_health()
