"""Tests for System Assistant."""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from core import app_catalog
from core.system_command_policy import current_platform, validate_system_shell_command
from core.system_environment import (
    build_environment_profile,
    build_install_command,
    resolve_install_recipe_id,
)
from core.system_recipes import get_recipe, list_recipes, resolve_install_recipe
from services.system_suggestions import build_suggestions


def test_list_recipes_includes_network_diagnose():
    recipes = list_recipes(category="network")
    ids = {r["id"] for r in recipes}
    assert "network.diagnose" in ids


def test_list_recipes_linux_excludes_brew_only():
    with patch("core.system_environment.probe_package_managers", return_value={"brew": False, "winget": False, "choco": False}):
        recipes = list_recipes(platform="linux")
    ids = {r["id"] for r in recipes}
    assert "install.brew_cask" not in ids
    assert "network.diagnose" in ids


def test_get_recipe_install_brew():
    recipe = get_recipe("install.brew_cask")
    assert recipe is not None
    assert recipe.category == "install"
    assert recipe.requires_approval is True


def test_resolve_install_recipe_platform():
    pm = {"brew": True, "winget": False, "choco": False}
    with patch("core.system_recipes.current_platform", return_value="darwin"):
        with patch("core.system_environment.probe_package_managers", return_value=pm):
            assert resolve_install_recipe() == "install.brew_cask"
    pm_win = {"brew": False, "winget": True, "choco": False}
    with patch("core.system_recipes.current_platform", return_value="win32"):
        with patch("core.system_environment.probe_package_managers", return_value=pm_win):
            assert resolve_install_recipe() == "install.winget"


def test_build_environment_profile():
    with patch("core.system_environment.get_server_platform", return_value="darwin"):
        with patch("core.system_environment.probe_package_managers", return_value={"brew": True, "winget": False, "choco": False}):
            profile = build_environment_profile(client_platform="win32")
    assert profile["server_platform"] == "darwin"
    assert profile["platform_mismatch"] is True
    assert profile["install_recipe_id"] == "install.brew_cask"
    assert profile["capabilities"]["install"] is True


def test_build_install_command_darwin():
    cmd = build_install_command("google-chrome", "darwin")
    assert "brew install --cask google-chrome" == cmd


def test_build_suggestions_ping_failure():
    diagnostics = {
        "checks": [{"name": "ping", "success": False}],
        "dev_tools": [],
    }
    env = {
        "server_platform": "darwin",
        "capabilities": {"install": True, "network": True, "organize": True},
        "default_paths": {"downloads_path": "/tmp/Downloads"},
        "install_recipe_id": "install.brew_cask",
    }
    suggestions = build_suggestions(diagnostics, env)
    ids = {s["id"] for s in suggestions}
    assert "network-diagnose-ping" in ids


def test_validate_system_shell_brew_list():
    platform = current_platform()
    if platform != "darwin":
        pytest.skip("brew only on darwin")
    policy = validate_system_shell_command("brew list")
    assert policy["executable"] == "brew"
    assert policy["tier"] == 0


def test_validate_system_shell_rejects_injection():
    with pytest.raises(ValueError, match="blocked"):
        validate_system_shell_command("brew list; rm -rf /")


def test_app_catalog_defaults():
    with tempfile.TemporaryDirectory() as tmp:
        catalog_path = Path(tmp) / "app_catalog.json"
        with patch.object(app_catalog, "CATALOG_PATH", catalog_path):
            apps = app_catalog.list_apps()
            assert any(a["id"] == "chrome" for a in apps)


def test_app_catalog_add_custom():
    with tempfile.TemporaryDirectory() as tmp:
        catalog_path = Path(tmp) / "app_catalog.json"
        catalog_path.parent.mkdir(parents=True, exist_ok=True)
        catalog_path.write_text(json.dumps({"apps": []}), encoding="utf-8")
        with patch.object(app_catalog, "CATALOG_PATH", catalog_path):
            entry = app_catalog.add_custom_app(
                name="Test App",
                packages={"darwin": "test-app", "win32": "Test.App"},
            )
            assert entry["custom"] is True
            assert entry["id"]


def test_local_computer_executable_actions_include_launch_app():
    from core.local_computer import EXECUTABLE_APPROVED_ACTIONS

    assert "launch_app" in EXECUTABLE_APPROVED_ACTIONS
    assert "move_path" in EXECUTABLE_APPROVED_ACTIONS


def test_system_assistant_start_diagnostic_recipe():
    from services import system_assistant_service

    result = system_assistant_service.start_recipe("env.check_dev_tools", {})
    assert result.get("task_id")
    assert result.get("status") == "completed"


def test_system_assistant_uninstall_waiting_approval():
    from services import system_assistant_service

    with patch("services.system_assistant_service.current_platform", return_value="darwin"):
        result = system_assistant_service.start_recipe("uninstall.brew", {"app_id": "chrome"})
    assert result.get("status") == "waiting_approval"
    assert result.get("task_id")
    assert result.get("approval")


def test_assert_organize_root_requires_my_computer():
    from services import system_assistant_service

    with patch.object(system_assistant_service.local_computer_service, "run_action", side_effect=__import__(
        "core.local_computer", fromlist=["LocalComputerError"]
    ).LocalComputerError("No allowed local computer roots configured")):
        with pytest.raises(ValueError, match="My Computer"):
            system_assistant_service._assert_organize_root("/tmp/demo")


def test_list_recipes_includes_image_organize():
    recipes = list_recipes(category="organize")
    ids = {r["id"] for r in recipes}
    assert "organize.images_preview" in ids
    assert "organize.compress_images" in ids
    assert "organize.images_to_video" in ids
    assert "organize.dedupe_images" in ids


def test_preview_image_organize():
    from core.file_media_ops import build_image_organize_moves, collect_images

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        (root / "a.png").write_bytes(b"png")
        (root / "b.jpg").write_bytes(b"jpg")
        images = collect_images(root, recursive=False)
        moves = build_image_organize_moves(images, root, mode="by_format")
        assert len(moves) == 2
        assert all("Images/" in m["category"] for m in moves)


def test_preview_compress_images():
    from core.file_media_ops import preview_compress_images

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        (root / "photo.png").write_bytes(b"x" * 2000)
        preview = preview_compress_images(str(root), quality=80, max_width=1920)
        assert preview["image_count"] == 1
        assert preview["items"][0]["dest"].endswith(".jpg")


def test_preview_dedupe_images():
    from core.file_media_ops import preview_dedupe_images

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        data = b"same-image-data"
        (root / "a.jpg").write_bytes(data)
        (root / "b.jpg").write_bytes(data)
        (root / "c.jpg").write_bytes(b"unique")
        preview = preview_dedupe_images(str(root), recursive=False)
        assert preview["duplicate_group_count"] == 1
        assert preview["duplicate_file_count"] == 1


def test_build_image_organize_by_exif_date():
    from core.file_media_ops import build_image_organize_moves

    root = Path("/tmp/photos")
    images = [
        {"path": "/tmp/photos/a.jpg", "exif_date": 1704067200.0, "modified_at": 0, "extension": ".jpg"},
    ]
    moves = build_image_organize_moves(images, root, mode="by_exif_date")
    assert moves[0]["category"].startswith("ByExifDate/")


def test_build_suggestions_includes_image_ops():
    diagnostics = {"checks": [], "dev_tools": []}
    env = {
        "server_platform": "darwin",
        "capabilities": {"install": True, "network": True, "organize": True, "media_organize": True},
        "default_paths": {"downloads_path": "/tmp/Downloads"},
        "install_recipe_id": "install.brew_cask",
    }
    suggestions = build_suggestions(diagnostics, env, computer_roots=[{"path": "/tmp/Photos"}])
    ids = {s["id"] for s in suggestions}
    assert "organize-images" in ids
    assert "organize-images-exif" in ids
    assert "dedupe-images" in ids
    assert "compress-images" in ids
    assert "images-to-video" in ids


def test_system_assistant_get_suggestions():
    from services import system_assistant_service

    with patch.object(system_assistant_service, "quick_diagnostics", return_value={"checks": [], "dev_tools": []}):
        with patch.object(system_assistant_service.local_computer_service, "list_allowed_roots", return_value=[]):
            data = system_assistant_service.get_suggestions()
    assert "suggestions" in data
    assert "environment" in data
