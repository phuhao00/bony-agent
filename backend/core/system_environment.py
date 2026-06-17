"""System Assistant environment profile — single source of truth for OS adaptation."""

from __future__ import annotations

import os
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any, Dict, Optional

from core.system_command_policy import current_platform

_PM_CACHE: Dict[str, Any] = {"ts": 0.0, "data": None}
_PM_CACHE_TTL = 300  # seconds

PLATFORM_LABELS = {
    "darwin": "macOS",
    "win32": "Windows",
    "linux": "Linux",
}


def get_server_platform() -> str:
    return current_platform()


def _which(executable: str, platform: str) -> bool:
    try:
        if platform == "win32":
            cmd = f"where {executable}"
        else:
            cmd = f"which {executable}"
        completed = subprocess.run(
            cmd.split(),
            capture_output=True,
            text=True,
            timeout=5,
            shell=False,
            check=False,
        )
        return completed.returncode == 0 and bool((completed.stdout or "").strip())
    except (subprocess.TimeoutExpired, OSError):
        return False


def probe_package_managers(*, platform: Optional[str] = None, use_cache: bool = True) -> Dict[str, bool]:
    platform = platform or get_server_platform()
    now = time.time()
    if use_cache and _PM_CACHE["data"] is not None and now - _PM_CACHE["ts"] < _PM_CACHE_TTL:
        return dict(_PM_CACHE["data"])

    managers = {"brew": False, "winget": False, "choco": False}
    if platform == "darwin":
        managers["brew"] = _which("brew", platform)
    elif platform == "win32":
        managers["winget"] = _which("winget", platform)
        managers["choco"] = _which("choco", platform)
    _PM_CACHE["ts"] = now
    _PM_CACHE["data"] = managers
    return dict(managers)


def get_default_paths(platform: Optional[str] = None) -> Dict[str, str]:
    platform = platform or get_server_platform()
    home = Path.home()
    if platform == "win32":
        downloads = home / "Downloads"
        desktop = home / "Desktop"
        return {
            "downloads_path": str(downloads),
            "desktop_path": str(desktop),
            "home_path": str(home),
        }
    return {
        "downloads_path": str(home / "Downloads"),
        "desktop_path": str(home / "Desktop"),
        "home_path": str(home),
    }


def resolve_install_recipe_id(
    platform: Optional[str] = None,
    managers: Optional[Dict[str, bool]] = None,
) -> Optional[str]:
    platform = platform or get_server_platform()
    managers = managers or probe_package_managers(platform=platform)
    if platform == "darwin" and managers.get("brew"):
        return "install.brew_cask"
    if platform == "win32":
        if managers.get("winget"):
            return "install.winget"
        if managers.get("choco"):
            return "install.winget"  # choco uses same recipe slot; command builder handles choco
    return None


def resolve_uninstall_recipe_id(
    platform: Optional[str] = None,
    managers: Optional[Dict[str, bool]] = None,
) -> Optional[str]:
    platform = platform or get_server_platform()
    managers = managers or probe_package_managers(platform=platform)
    if platform == "darwin" and managers.get("brew"):
        return "uninstall.brew"
    if platform == "win32" and (managers.get("winget") or managers.get("choco")):
        return "uninstall.winget"
    return None


def package_key_for_platform(platform: str) -> str:
    if platform == "darwin":
        return "darwin"
    if platform == "win32":
        return "win32"
    return "linux"


def build_install_command(app_pkg: str, platform: Optional[str] = None, managers: Optional[Dict[str, bool]] = None) -> str:
    platform = platform or get_server_platform()
    managers = managers or probe_package_managers(platform=platform)
    if platform == "darwin":
        return f"brew install --cask {app_pkg}"
    if managers.get("winget"):
        return f"winget install --id {app_pkg} -e --accept-source-agreements --accept-package-agreements"
    if managers.get("choco"):
        return f"choco install {app_pkg} -y"
    return f"winget install --id {app_pkg} -e --accept-source-agreements --accept-package-agreements"


def build_uninstall_command(app_pkg: str, platform: Optional[str] = None, managers: Optional[Dict[str, bool]] = None) -> str:
    platform = platform or get_server_platform()
    managers = managers or probe_package_managers(platform=platform)
    if platform == "darwin":
        return f"brew uninstall --cask {app_pkg}"
    if managers.get("winget"):
        return f"winget uninstall --id {app_pkg} -e"
    if managers.get("choco"):
        return f"choco uninstall {app_pkg} -y"
    return f"winget uninstall --id {app_pkg} -e"


def build_flush_dns_command(platform: Optional[str] = None) -> str:
    platform = platform or get_server_platform()
    if platform == "darwin":
        return "dscacheutil -flushcache"
    if platform == "win32":
        return "ipconfig /flushdns"
    return "echo DNS flush not supported on this platform"


def build_dev_tool_install_command(tool: str, platform: Optional[str] = None, managers: Optional[Dict[str, bool]] = None) -> str:
    platform = platform or get_server_platform()
    managers = managers or probe_package_managers(platform=platform)
    if platform == "darwin":
        return f"brew install {tool}"
    if managers.get("winget"):
        return f"winget install --id {tool} -e --accept-source-agreements --accept-package-agreements"
    if managers.get("choco"):
        return f"choco install {tool} -y"
    return f"winget install --id {tool} -e --accept-source-agreements --accept-package-agreements"


def build_ping_command(platform: Optional[str] = None) -> str:
    platform = platform or get_server_platform()
    if platform == "win32":
        return "ping -n 3 8.8.8.8"
    return "ping -c 3 8.8.8.8"


def build_python_version_command(platform: Optional[str] = None) -> str:
    platform = platform or get_server_platform()
    return "python --version" if platform == "win32" else "python3 --version"


def build_environment_profile(client_platform: Optional[str] = None) -> Dict[str, Any]:
    server_platform = get_server_platform()
    managers = probe_package_managers(platform=server_platform)
    paths = get_default_paths(server_platform)
    install_recipe = resolve_install_recipe_id(server_platform, managers)
    uninstall_recipe = resolve_uninstall_recipe_id(server_platform, managers)

    pkg_label = "Homebrew" if managers.get("brew") else "winget" if managers.get("winget") else "Chocolatey" if managers.get("choco") else "无"

    ui_labels = {
        "platform_name": PLATFORM_LABELS.get(server_platform, server_platform),
        "install_cmd": "brew install --cask" if server_platform == "darwin" else "winget install --id",
        "uninstall_cmd": "brew uninstall --cask" if server_platform == "darwin" else "winget uninstall --id",
        "package_manager": pkg_label,
        "downloads_path": paths["downloads_path"],
        "desktop_path": paths["desktop_path"],
    }

    normalized_client = client_platform if client_platform in {"darwin", "win32", "linux"} else None
    platform_mismatch = bool(
        normalized_client and normalized_client != server_platform
    )

    capabilities = {
        "install": install_recipe is not None,
        "uninstall": uninstall_recipe is not None,
        "network": server_platform in {"darwin", "win32", "linux"},
        "env": True,
        "organize": True,
        "media_organize": bool(shutil.which("ffmpeg")),
        "repair": install_recipe is not None,
    }

    return {
        "server_platform": server_platform,
        "client_platform": normalized_client,
        "platform_mismatch": platform_mismatch,
        "package_managers": managers,
        "install_recipe_id": install_recipe,
        "uninstall_recipe_id": uninstall_recipe,
        "capabilities": capabilities,
        "ui_labels": ui_labels,
        "default_paths": paths,
    }
