"""System Assistant recipe registry."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional

from core.system_command_policy import current_platform
from core.system_environment import (
    probe_package_managers,
    resolve_install_recipe_id,
    resolve_uninstall_recipe_id,
)


@dataclass(frozen=True)
class RecipeStep:
    id: str
    kind: str  # diagnose | execute | verify | preview | apply
    description: str


@dataclass(frozen=True)
class SystemRecipe:
    id: str
    name: str
    category: str
    description: str
    platforms: List[str]
    risk_level: str
    requires_approval: bool
    capability_id: str
    steps: List[RecipeStep] = field(default_factory=list)
    params_schema: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        data = asdict(self)
        data["steps"] = [asdict(s) for s in self.steps]
        return data


SYSTEM_RECIPES: Dict[str, SystemRecipe] = {
    "install.brew_cask": SystemRecipe(
        id="install.brew_cask",
        name="Install App (Homebrew)",
        category="install",
        description="Install a macOS application via Homebrew cask.",
        platforms=["darwin"],
        risk_level="critical",
        requires_approval=True,
        capability_id="system_install",
        steps=[
            RecipeStep("diagnose", "diagnose", "Check if app is already installed"),
            RecipeStep("execute", "execute", "Run brew install --cask"),
            RecipeStep("verify", "verify", "Verify installation"),
        ],
        params_schema={"app_id": {"type": "string", "required": True}},
    ),
    "install.winget": SystemRecipe(
        id="install.winget",
        name="Install App (winget)",
        category="install",
        description="Install a Windows application via winget.",
        platforms=["win32"],
        risk_level="critical",
        requires_approval=True,
        capability_id="system_install",
        steps=[
            RecipeStep("diagnose", "diagnose", "Check if app is already installed"),
            RecipeStep("execute", "execute", "Run winget install"),
            RecipeStep("verify", "verify", "Verify installation"),
        ],
        params_schema={"app_id": {"type": "string", "required": True}},
    ),
    "uninstall.brew": SystemRecipe(
        id="uninstall.brew",
        name="Uninstall App (Homebrew)",
        category="uninstall",
        description="Uninstall a macOS application via Homebrew.",
        platforms=["darwin"],
        risk_level="critical",
        requires_approval=True,
        capability_id="system_install",
        steps=[
            RecipeStep("execute", "execute", "Run brew uninstall --cask"),
            RecipeStep("verify", "verify", "Verify removal"),
        ],
        params_schema={"app_id": {"type": "string", "required": True}},
    ),
    "uninstall.winget": SystemRecipe(
        id="uninstall.winget",
        name="Uninstall App (winget)",
        category="uninstall",
        description="Uninstall a Windows application via winget.",
        platforms=["win32"],
        risk_level="critical",
        requires_approval=True,
        capability_id="system_install",
        steps=[
            RecipeStep("execute", "execute", "Run winget uninstall"),
            RecipeStep("verify", "verify", "Verify removal"),
        ],
        params_schema={"app_id": {"type": "string", "required": True}},
    ),
    "repair.reinstall_app": SystemRecipe(
        id="repair.reinstall_app",
        name="Reinstall Application",
        category="repair",
        description="Uninstall then reinstall an application.",
        platforms=["darwin", "win32"],
        risk_level="critical",
        requires_approval=True,
        capability_id="system_install",
        steps=[
            RecipeStep("uninstall", "execute", "Uninstall existing app"),
            RecipeStep("install", "execute", "Reinstall app"),
            RecipeStep("verify", "verify", "Verify app works"),
        ],
        params_schema={"app_id": {"type": "string", "required": True}},
    ),
    "network.diagnose": SystemRecipe(
        id="network.diagnose",
        name="Network Diagnostics",
        category="network",
        description="Run ping, DNS, and connectivity checks.",
        platforms=["darwin", "win32", "linux"],
        risk_level="low",
        requires_approval=False,
        capability_id="system_network_fix",
        steps=[
            RecipeStep("ping", "diagnose", "Ping gateway and public DNS"),
            RecipeStep("dns", "diagnose", "Check DNS resolution"),
            RecipeStep("proxy", "diagnose", "Check proxy settings"),
        ],
        params_schema={"host": {"type": "string", "default": "8.8.8.8"}},
    ),
    "network.flush_dns": SystemRecipe(
        id="network.flush_dns",
        name="Flush DNS Cache",
        category="network",
        description="Clear local DNS cache.",
        platforms=["darwin", "win32"],
        risk_level="high",
        requires_approval=True,
        capability_id="system_network_fix",
        steps=[RecipeStep("flush", "execute", "Flush DNS cache")],
        params_schema={},
    ),
    "env.check_dev_tools": SystemRecipe(
        id="env.check_dev_tools",
        name="Check Dev Tools",
        category="env",
        description="Check node, python, git versions.",
        platforms=["darwin", "win32", "linux"],
        risk_level="low",
        requires_approval=False,
        capability_id="system_env_config",
        steps=[RecipeStep("check", "diagnose", "Check tool versions")],
        params_schema={},
    ),
    "env.install_dev_tool": SystemRecipe(
        id="env.install_dev_tool",
        name="Install Dev Tool",
        category="env",
        description="Install a development tool via package manager.",
        platforms=["darwin", "win32"],
        risk_level="high",
        requires_approval=True,
        capability_id="system_env_config",
        steps=[
            RecipeStep("execute", "execute", "Install tool"),
            RecipeStep("verify", "verify", "Verify version"),
        ],
        params_schema={"tool": {"type": "string", "required": True}},
    ),
    "organize.preview": SystemRecipe(
        id="organize.preview",
        name="Preview File Organization",
        category="organize",
        description="Scan a folder and generate an organization plan.",
        platforms=["darwin", "win32", "linux"],
        risk_level="low",
        requires_approval=False,
        capability_id="system_file_organize",
        steps=[RecipeStep("scan", "preview", "Scan and categorize files")],
        params_schema={
            "root_path": {"type": "string", "required": True},
            "rules": {"type": "object", "required": False},
        },
    ),
    "organize.apply_batch": SystemRecipe(
        id="organize.apply_batch",
        name="Apply File Organization",
        category="organize",
        description="Move files according to a preview plan.",
        platforms=["darwin", "win32", "linux"],
        risk_level="high",
        requires_approval=True,
        capability_id="system_file_organize",
        steps=[RecipeStep("apply", "apply", "Move files in batch")],
        params_schema={"plan_id": {"type": "string", "required": True}},
    ),
    "organize.images_preview": SystemRecipe(
        id="organize.images_preview",
        name="Preview Image Organization",
        category="organize",
        description="Scan images in a folder and preview sort-by-format/date/size plan.",
        platforms=["darwin", "win32", "linux"],
        risk_level="low",
        requires_approval=False,
        capability_id="system_file_organize",
        steps=[RecipeStep("scan", "preview", "Scan and categorize images")],
        params_schema={
            "root_path": {"type": "string", "required": True},
            "mode": {"type": "string", "default": "by_format"},
            "recursive": {"type": "boolean", "default": True},
        },
    ),
    "organize.compress_images": SystemRecipe(
        id="organize.compress_images",
        name="Compress Images",
        category="organize",
        description="Batch compress images to JPEG in a subfolder (keeps originals).",
        platforms=["darwin", "win32", "linux"],
        risk_level="high",
        requires_approval=True,
        capability_id="system_file_organize",
        steps=[
            RecipeStep("preview", "preview", "Estimate compression savings"),
            RecipeStep("apply", "apply", "Write compressed copies"),
        ],
        params_schema={
            "root_path": {"type": "string", "required": True},
            "quality": {"type": "integer", "default": 80},
            "max_width": {"type": "integer", "default": 1920},
            "output_subdir": {"type": "string", "default": "Compressed"},
            "recursive": {"type": "boolean", "default": True},
        },
    ),
    "organize.edit_images": SystemRecipe(
        id="organize.edit_images",
        name="Batch Edit Images",
        category="organize",
        description="Batch rotate, resize, or convert images into an Edited subfolder.",
        platforms=["darwin", "win32", "linux"],
        risk_level="high",
        requires_approval=True,
        capability_id="system_file_organize",
        steps=[
            RecipeStep("preview", "preview", "Preview edit targets"),
            RecipeStep("apply", "apply", "Write edited copies"),
        ],
        params_schema={
            "root_path": {"type": "string", "required": True},
            "rotate": {"type": "integer", "default": 0},
            "max_width": {"type": "integer", "default": 0},
            "output_format": {"type": "string", "default": ""},
            "output_subdir": {"type": "string", "default": "Edited"},
            "recursive": {"type": "boolean", "default": True},
            "auto_orient": {"type": "boolean", "default": False},
            "watermark_text": {"type": "string", "default": ""},
            "watermark_position": {"type": "string", "default": "bottom_right"},
        },
    ),
    "organize.dedupe_images": SystemRecipe(
        id="organize.dedupe_images",
        name="Deduplicate Images",
        category="organize",
        description="Find duplicate images by content hash and move copies to Duplicates/.",
        platforms=["darwin", "win32", "linux"],
        risk_level="high",
        requires_approval=True,
        capability_id="system_file_organize",
        steps=[
            RecipeStep("scan", "preview", "Scan for duplicate images"),
            RecipeStep("apply", "apply", "Move duplicates to Duplicates/"),
        ],
        params_schema={
            "root_path": {"type": "string", "required": True},
            "output_subdir": {"type": "string", "default": "Duplicates"},
            "recursive": {"type": "boolean", "default": True},
        },
    ),
    "organize.images_to_video": SystemRecipe(
        id="organize.images_to_video",
        name="Images to Slideshow Video",
        category="organize",
        description="Create an MP4 slideshow from folder images using FFmpeg.",
        platforms=["darwin", "win32", "linux"],
        risk_level="high",
        requires_approval=True,
        capability_id="system_file_organize",
        steps=[
            RecipeStep("preview", "preview", "List images and estimate duration"),
            RecipeStep("render", "execute", "Render slideshow with FFmpeg"),
        ],
        params_schema={
            "root_path": {"type": "string", "required": True},
            "duration_per_image": {"type": "number", "default": 3.0},
            "fps": {"type": "integer", "default": 30},
            "width": {"type": "integer", "default": 1280},
            "height": {"type": "integer", "default": 720},
            "recursive": {"type": "boolean", "default": True},
            "sort_by": {"type": "string", "default": "name"},
            "audio_path": {"type": "string", "default": ""},
        },
    ),
}


def _recipe_available_on_platform(recipe: SystemRecipe, platform: str) -> bool:
    if platform not in recipe.platforms:
        return False
    managers = probe_package_managers(platform=platform)
    if recipe.id in {"install.brew_cask", "uninstall.brew"}:
        return bool(managers.get("brew"))
    if recipe.id in {"install.winget", "uninstall.winget"}:
        return bool(managers.get("winget") or managers.get("choco"))
    if recipe.id == "network.flush_dns" and platform == "linux":
        return False
    if recipe.id == "env.install_dev_tool" and platform == "linux":
        return False
    return True


def list_recipes(
    *,
    category: Optional[str] = None,
    platform: Optional[str] = None,
) -> List[Dict[str, Any]]:
    platform = platform or current_platform()
    results = []
    for recipe in SYSTEM_RECIPES.values():
        if category and recipe.category != category:
            continue
        if not _recipe_available_on_platform(recipe, platform):
            continue
        results.append(recipe.to_dict())
    return results


def get_recipe(recipe_id: str) -> Optional[SystemRecipe]:
    return SYSTEM_RECIPES.get(recipe_id)


def resolve_install_recipe(platform: Optional[str] = None) -> str:
    platform = platform or current_platform()
    recipe_id = resolve_install_recipe_id(platform)
    if not recipe_id:
        raise ValueError(f"No install recipe available on {platform}")
    return recipe_id


def resolve_uninstall_recipe(platform: Optional[str] = None) -> str:
    platform = platform or current_platform()
    recipe_id = resolve_uninstall_recipe_id(platform)
    if not recipe_id:
        raise ValueError(f"No uninstall recipe available on {platform}")
    return recipe_id
