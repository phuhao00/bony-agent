"""Application catalog for System Assistant install/uninstall recipes."""

from __future__ import annotations

import json
import uuid
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

PROJECT_ROOT = Path(__file__).resolve().parents[2]
CATALOG_PATH = PROJECT_ROOT / "storage" / "system" / "app_catalog.json"

DEFAULT_APPS: List[Dict[str, Any]] = [
    {
        "id": "chrome",
        "name": "Google Chrome",
        "category": "browser",
        "packages": {"darwin": "google-chrome", "win32": "Google.Chrome"},
    },
    {
        "id": "vscode",
        "name": "Visual Studio Code",
        "category": "dev",
        "packages": {"darwin": "visual-studio-code", "win32": "Microsoft.VisualStudioCode"},
    },
    {
        "id": "firefox",
        "name": "Mozilla Firefox",
        "category": "browser",
        "packages": {"darwin": "firefox", "win32": "Mozilla.Firefox"},
    },
    {
        "id": "node",
        "name": "Node.js",
        "category": "dev",
        "packages": {"darwin": "node", "win32": "OpenJS.NodeJS.LTS"},
    },
    {
        "id": "git",
        "name": "Git",
        "category": "dev",
        "packages": {"darwin": "git", "win32": "Git.Git"},
    },
    {
        "id": "slack",
        "name": "Slack",
        "category": "productivity",
        "packages": {"darwin": "slack", "win32": "SlackTechnologies.Slack"},
    },
    {
        "id": "zoom",
        "name": "Zoom",
        "category": "productivity",
        "packages": {"darwin": "zoom", "win32": "Zoom.Zoom"},
    },
    {
        "id": "docker",
        "name": "Docker Desktop",
        "category": "dev",
        "packages": {"darwin": "docker", "win32": "Docker.DockerDesktop"},
    },
]


@dataclass
class AppCatalogEntry:
    id: str
    name: str
    category: str
    packages: Dict[str, str]
    custom: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    def package_for(self, platform: str) -> Optional[str]:
        return self.packages.get(platform)


def _ensure_catalog_file() -> None:
    CATALOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    if not CATALOG_PATH.exists():
        CATALOG_PATH.write_text(
            json.dumps({"apps": DEFAULT_APPS}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )


def _load_raw() -> Dict[str, Any]:
    _ensure_catalog_file()
    return json.loads(CATALOG_PATH.read_text(encoding="utf-8"))


def _save_raw(data: Dict[str, Any]) -> None:
    CATALOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    CATALOG_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def list_apps(*, query: Optional[str] = None, category: Optional[str] = None) -> List[Dict[str, Any]]:
    apps = _load_raw().get("apps") or []
    results = []
    q = (query or "").strip().lower()
    for item in apps:
        if category and item.get("category") != category:
            continue
        if q:
            hay = f"{item.get('id', '')} {item.get('name', '')}".lower()
            if q not in hay:
                continue
        results.append(item)
    return results


def get_app(app_id: str) -> Optional[Dict[str, Any]]:
    for item in _load_raw().get("apps") or []:
        if item.get("id") == app_id:
            return item
    return None


def add_custom_app(
    *,
    name: str,
    packages: Dict[str, str],
    category: str = "custom",
) -> Dict[str, Any]:
    data = _load_raw()
    apps = data.get("apps") or []
    app_id = name.lower().replace(" ", "-")[:48]
    base_id = app_id
    suffix = 1
    existing_ids = {a.get("id") for a in apps}
    while app_id in existing_ids:
        app_id = f"{base_id}-{suffix}"
        suffix += 1
    entry = {
        "id": app_id,
        "name": name,
        "category": category,
        "packages": packages,
        "custom": True,
    }
    apps.append(entry)
    data["apps"] = apps
    _save_raw(data)
    return entry


def search_apps(query: str, limit: int = 20) -> List[Dict[str, Any]]:
    return list_apps(query=query)[:limit]
