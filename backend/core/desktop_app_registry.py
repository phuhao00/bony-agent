"""Discover and search installed desktop applications."""

from __future__ import annotations

import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

from core.app_catalog import list_apps as list_catalog_apps
from core.creative_software import CREATIVE_APP_PROFILES

_INSTALLED_CACHE: Dict[str, Any] = {"ts": 0.0, "data": None}
_CACHE_TTL = 300


def _slug(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", (name or "").lower()).strip("_")
    return slug or "app"


def _scan_macos_applications() -> List[Dict[str, Any]]:
    apps: List[Dict[str, Any]] = []
    seen: Set[str] = set()
    search_dirs = [Path("/Applications"), Path.home() / "Applications"]
    for base in search_dirs:
        if not base.is_dir():
            continue
        for item in sorted(base.glob("*.app")):
            name = item.stem
            app_id = _slug(name)
            if app_id in seen:
                continue
            seen.add(app_id)
            exe = item / "Contents" / "MacOS" / name
            if not exe.is_file():
                macos_dir = item / "Contents" / "MacOS"
                if macos_dir.is_dir():
                    candidates = list(macos_dir.iterdir())
                    exe = candidates[0] if len(candidates) == 1 else None
            apps.append(
                {
                    "id": app_id,
                    "name": name,
                    "bundle_id": None,
                    "executable_path": str(exe) if exe and exe.is_file() else str(item),
                    "source": "installed",
                    "platform": "darwin",
                }
            )
    try:
        completed = subprocess.run(
            ["mdfind", "kMDItemKind==Application"],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
        for line in (completed.stdout or "").splitlines():
            path = line.strip()
            if not path.endswith(".app"):
                continue
            item = Path(path)
            name = item.stem
            app_id = _slug(name)
            if app_id in seen:
                continue
            seen.add(app_id)
            apps.append(
                {
                    "id": app_id,
                    "name": name,
                    "bundle_id": None,
                    "executable_path": str(item),
                    "source": "installed",
                    "platform": "darwin",
                }
            )
    except (subprocess.TimeoutExpired, OSError):
        pass
    return apps


def _scan_windows_applications() -> List[Dict[str, Any]]:
    apps: List[Dict[str, Any]] = []
    seen: Set[str] = set()
    program_dirs = [
        Path(r"C:\Program Files"),
        Path(r"C:\Program Files (x86)"),
    ]
    for base in program_dirs:
        if not base.is_dir():
            continue
        for exe in base.rglob("*.exe"):
            if exe.name.lower() in {"uninstall.exe", "setup.exe", "update.exe"}:
                continue
            name = exe.stem
            app_id = _slug(name)
            if app_id in seen:
                continue
            seen.add(app_id)
            apps.append(
                {
                    "id": app_id,
                    "name": name,
                    "executable_path": str(exe),
                    "source": "installed",
                    "platform": "win32",
                }
            )
            if len(apps) >= 500:
                break
    return apps


def _scan_linux_applications() -> List[Dict[str, Any]]:
    apps: List[Dict[str, Any]] = []
    seen: Set[str] = set()
    for desktop_dir in (Path("/usr/share/applications"), Path.home() / ".local/share/applications"):
        if not desktop_dir.is_dir():
            continue
        for item in desktop_dir.glob("*.desktop"):
            try:
                text = item.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            name = item.stem
            for line in text.splitlines():
                if line.startswith("Name="):
                    name = line.split("=", 1)[1].strip()
                    break
            app_id = _slug(name)
            if app_id in seen:
                continue
            seen.add(app_id)
            apps.append(
                {
                    "id": app_id,
                    "name": name,
                    "executable_path": str(item),
                    "source": "installed",
                    "platform": "linux",
                }
            )
    return apps


def scan_installed_apps(*, use_cache: bool = True) -> List[Dict[str, Any]]:
    now = time.time()
    if use_cache and _INSTALLED_CACHE["data"] is not None and now - _INSTALLED_CACHE["ts"] < _CACHE_TTL:
        return list(_INSTALLED_CACHE["data"])

    if sys.platform == "darwin":
        apps = _scan_macos_applications()
    elif sys.platform == "win32":
        apps = _scan_windows_applications()
    else:
        apps = _scan_linux_applications()

    _INSTALLED_CACHE["ts"] = now
    _INSTALLED_CACHE["data"] = apps
    return list(apps)


def _catalog_entries() -> List[Dict[str, Any]]:
    return [
        {
            "id": entry["id"],
            "name": entry.get("name") or entry["id"],
            "source": "catalog",
            "category": entry.get("category"),
            "installable": True,
        }
        for entry in list_catalog_apps()
    ]


def _creative_profile_entries() -> List[Dict[str, Any]]:
    return [
        {
            "id": prof.id,
            "name": prof.name,
            "source": "creative_profile",
            "category": prof.category,
            "automation_modes": ["cli_batch"],
            "capability_id": prof.capability_id,
        }
        for prof in CREATIVE_APP_PROFILES.values()
    ]


def list_desktop_apps(*, limit: int = 100) -> List[Dict[str, Any]]:
    merged: Dict[str, Dict[str, Any]] = {}
    for entry in _catalog_entries() + _creative_profile_entries() + scan_installed_apps():
        app_id = entry["id"]
        if app_id in merged:
            merged[app_id] = {**merged[app_id], **entry}
        else:
            merged[app_id] = dict(entry)
    items = sorted(merged.values(), key=lambda item: (item.get("source") != "installed", item.get("name", "")))
    return items[: max(1, min(limit, 500))]


def _fuzzy_score(query: str, entry: Dict[str, Any]) -> float:
    q = (query or "").strip().lower()
    if not q:
        return 0.0
    name = (entry.get("name") or "").lower()
    app_id = (entry.get("id") or "").lower()
    path = (entry.get("executable_path") or "").lower()
    hay = f"{name} {app_id} {path}"

    if q == name or q == app_id:
        return 100.0
    if name.startswith(q) or app_id.startswith(q):
        return 90.0
    if q in name or q in app_id:
        return 80.0

    tokens = [t for t in re.split(r"\s+", q) if t]
    if len(tokens) > 1 and all(t in hay for t in tokens):
        return 70.0

    def _subsequence(needle: str, haystack: str) -> bool:
        idx = 0
        for ch in needle:
            pos = haystack.find(ch, idx)
            if pos == -1:
                return False
            idx = pos + 1
        return True

    if _subsequence(q, name) or _subsequence(q, app_id):
        return 55.0
    if q in hay:
        return 40.0
    return 0.0


def search_desktop_apps(query: str, *, limit: int = 50) -> List[Dict[str, Any]]:
    q = (query or "").strip()
    pool = list_desktop_apps(limit=500)
    if not q:
        return pool[:limit]
    scored = [( _fuzzy_score(q, entry), entry) for entry in pool]
    scored = [(score, entry) for score, entry in scored if score > 0]
    scored.sort(key=lambda item: (-item[0], item[1].get("name", "")))
    return [entry for _, entry in scored[:limit]]


def get_desktop_app(app_id: str) -> Optional[Dict[str, Any]]:
    aid = (app_id or "").strip().lower()
    for entry in list_desktop_apps(limit=500):
        if entry.get("id") == aid:
            return entry
    return None
