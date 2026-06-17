"""Sidecar HTTP client for native desktop automation."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, Optional

PROJECT_ROOT = Path(__file__).resolve().parents[3]
SIDECAR_PORT_FILE = PROJECT_ROOT / "storage" / "temp" / "sidecar.port"
SIDECAR_TOKEN_FILE = PROJECT_ROOT / "storage" / "temp" / "sidecar.token"

# Sidecar binds 127.0.0.1 only. urllib honors macOS/Clash system proxies by default,
# which routes localhost to 127.0.0.1:7890 and yields 502 even when Sidecar is healthy.
_SIDECAR_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def _open_sidecar_request(req: urllib.request.Request, *, timeout: float) -> Any:
    return _SIDECAR_OPENER.open(req, timeout=timeout)


def _read_sidecar_config() -> Dict[str, Any]:
    port = None
    token = ""
    if SIDECAR_PORT_FILE.is_file():
        try:
            port = int(SIDECAR_PORT_FILE.read_text(encoding="utf-8").strip())
        except ValueError:
            port = None
    if SIDECAR_TOKEN_FILE.is_file():
        token = SIDECAR_TOKEN_FILE.read_text(encoding="utf-8").strip()
    return {"port": port, "token": token}


def sidecar_probe(path: str, *, fail_open: bool = False) -> Dict[str, Any]:
    """Lightweight GET probe (returns empty dict on 404 when fail_open)."""
    cfg = _read_sidecar_config()
    port = cfg.get("port")
    if not port:
        return {} if fail_open else {"ok": False, "reason": "no_port_file"}
    url = f"http://127.0.0.1:{port}{path}"
    headers: Dict[str, str] = {}
    token = cfg.get("token") or ""
    if token:
        headers["X-Sidecar-Token"] = token
    req = urllib.request.Request(url, method="GET", headers=headers)
    try:
        with _open_sidecar_request(req, timeout=2) as resp:
            if resp.status >= 400:
                if fail_open:
                    return {}
                return {"ok": False, "status": resp.status}
            body = resp.read().decode("utf-8")
            if not body.strip():
                return {}
            return json.loads(body)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError):
        if fail_open:
            return {}
        return {"ok": False, "reason": "unreachable"}


def sidecar_has_open_locate() -> bool:
    """True when Sidecar exposes POST /app/open-locate."""
    cfg = _read_sidecar_config()
    port = cfg.get("port")
    if not port:
        return False
    url = f"http://127.0.0.1:{port}/app/open-locate"
    headers: Dict[str, str] = {"Content-Type": "application/json"}
    token = cfg.get("token") or ""
    if token:
        headers["X-Sidecar-Token"] = token
    req = urllib.request.Request(
        url, data=b"{}", method="POST", headers=headers,
    )
    try:
        with _open_sidecar_request(req, timeout=2) as resp:
            return resp.status != 404
    except (urllib.error.URLError, TimeoutError, OSError):
        return False


def sidecar_has_foreground() -> bool:
    """True when running Sidecar exposes GET /foreground (not legacy 404)."""
    cfg = _read_sidecar_config()
    port = cfg.get("port")
    if not port:
        return False
    url = f"http://127.0.0.1:{port}/foreground"
    headers: Dict[str, str] = {}
    token = cfg.get("token") or ""
    if token:
        headers["X-Sidecar-Token"] = token
    req = urllib.request.Request(url, method="GET", headers=headers)
    try:
        with _open_sidecar_request(req, timeout=2) as resp:
            return resp.status == 200
    except (urllib.error.URLError, TimeoutError, OSError):
        return False


def sidecar_health() -> Dict[str, Any]:
    cfg = _read_sidecar_config()
    port = cfg.get("port")
    if not port:
        return {"ok": False, "reason": "no_port_file"}
    url = f"http://127.0.0.1:{port}/health"
    try:
        req = urllib.request.Request(url, method="GET")
        token = cfg.get("token") or ""
        if token:
            req.add_header("X-Sidecar-Token", token)
        with _open_sidecar_request(req, timeout=2) as resp:
            body = json.loads(resp.read().decode("utf-8"))
            body["ok"] = True
            body["port"] = port
            return body
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError):
        return {"ok": False, "port": port, "reason": "unreachable"}


def sidecar_request(
    method: str,
    path: str,
    payload: Optional[Dict[str, Any]] = None,
    *,
    fail_open: bool = False,
) -> Dict[str, Any]:
    cfg = _read_sidecar_config()
    port = cfg.get("port")
    if not port:
        if fail_open:
            return {}
        raise RuntimeError("sidecar port not configured")
    url = f"http://127.0.0.1:{port}{path}"
    data = None
    headers = {"Content-Type": "application/json"}
    token = cfg.get("token") or ""
    if token:
        headers["X-Sidecar-Token"] = token
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method=method.upper(), headers=headers)
    try:
        with _open_sidecar_request(req, timeout=30) as resp:
            if resp.status >= 400:
                if fail_open:
                    return {}
                raise RuntimeError(f"sidecar {path} HTTP {resp.status}")
            body = resp.read().decode("utf-8")
            if not body.strip():
                return {}
            return json.loads(body)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError, RuntimeError):
        if fail_open:
            return {}
        raise
