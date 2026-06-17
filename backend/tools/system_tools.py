"""LangChain tools for System Assistant."""

from __future__ import annotations

import json
from typing import Optional

from langchain.tools import tool

from core.app_catalog import search_apps
from core.system_recipes import list_recipes
from services import system_assistant_service
from utils.logger import setup_logger

logger = setup_logger("system_tools")


@tool
def list_system_recipes(category: str = "") -> str:
    """List available System Assistant recipes. Optional category: install, uninstall, repair, network, env, organize."""
    recipes = list_recipes(category=category or None)
    return json.dumps(recipes, ensure_ascii=False, indent=2)


@tool
def run_system_recipe(recipe_id: str, params_json: str = "{}") -> str:
    """Run a System Assistant recipe by id. params_json is a JSON object string, e.g. {\"app_id\": \"chrome\"}."""
    try:
        params = json.loads(params_json) if params_json.strip() else {}
    except json.JSONDecodeError as exc:
        return json.dumps({"success": False, "error": f"Invalid params_json: {exc}"}, ensure_ascii=False)
    try:
        result = system_assistant_service.start_recipe(recipe_id, params)
        return json.dumps(result, ensure_ascii=False, indent=2)
    except ValueError as exc:
        return json.dumps({"success": False, "error": str(exc)}, ensure_ascii=False)


@tool
def get_system_diagnostics() -> str:
    """Run quick network and dev-tool diagnostics on the local computer."""
    result = system_assistant_service.quick_diagnostics()
    return json.dumps(result, ensure_ascii=False, indent=2)


@tool
def search_app_catalog(query: str) -> str:
    """Search the application catalog for installable apps by name or id."""
    apps = search_apps(query)
    return json.dumps(apps, ensure_ascii=False, indent=2)


@tool
def install_application(app_id: str) -> str:
    """Install an application from the catalog by app id (e.g. chrome, vscode). Requires approval."""
    result = system_assistant_service.install_app(app_id)
    return json.dumps(result, ensure_ascii=False, indent=2)


@tool
def uninstall_application(app_id: str) -> str:
    """Uninstall an application from the catalog by app id. Requires approval."""
    result = system_assistant_service.uninstall_app(app_id)
    return json.dumps(result, ensure_ascii=False, indent=2)


@tool
def preview_file_organization(root_path: str) -> str:
    """Preview a file organization plan for a folder under My Computer registered roots."""
    result = system_assistant_service.start_recipe(
        "organize.preview",
        {"root_path": root_path},
    )
    return json.dumps(result, ensure_ascii=False, indent=2)


@tool
def preview_image_organization(root_path: str, mode: str = "by_format") -> str:
    """Preview image-only organization (by_format, by_date, by_size) within My Computer roots."""
    result = system_assistant_service.start_recipe(
        "organize.images_preview",
        {"root_path": root_path, "mode": mode},
    )
    return json.dumps(result, ensure_ascii=False, indent=2)


@tool
def compress_images_in_folder(
    root_path: str,
    quality: int = 80,
    max_width: int = 1920,
) -> str:
    """Batch compress images in a folder to JPEG copies. Requires approval."""
    result = system_assistant_service.start_recipe(
        "organize.compress_images",
        {"root_path": root_path, "quality": quality, "max_width": max_width},
    )
    return json.dumps(result, ensure_ascii=False, indent=2)


@tool
def edit_images_in_folder(
    root_path: str,
    rotate: int = 0,
    max_width: int = 0,
    output_format: str = "",
    auto_orient: bool = False,
    watermark_text: str = "",
) -> str:
    """Batch rotate/resize/convert/watermark images. Requires approval."""
    result = system_assistant_service.start_recipe(
        "organize.edit_images",
        {
            "root_path": root_path,
            "rotate": rotate,
            "max_width": max_width,
            "output_format": output_format,
            "auto_orient": auto_orient,
            "watermark_text": watermark_text,
        },
    )
    return json.dumps(result, ensure_ascii=False, indent=2)


@tool
def dedupe_images_in_folder(root_path: str) -> str:
    """Find duplicate images and move copies to Duplicates/. Requires approval."""
    result = system_assistant_service.start_recipe(
        "organize.dedupe_images",
        {"root_path": root_path},
    )
    return json.dumps(result, ensure_ascii=False, indent=2)


@tool
def create_slideshow_from_images(
    root_path: str,
    duration_per_image: float = 3.0,
    sort_by: str = "name",
    audio_path: str = "",
) -> str:
    """Create an MP4 slideshow from images. sort_by: name|exif_date. Optional audio_path for BGM."""
    result = system_assistant_service.start_recipe(
        "organize.images_to_video",
        {
            "root_path": root_path,
            "duration_per_image": duration_per_image,
            "sort_by": sort_by,
            "audio_path": audio_path,
        },
    )
    return json.dumps(result, ensure_ascii=False, indent=2)


@tool
def flush_dns_cache() -> str:
    """Flush local DNS cache. Requires approval on most platforms."""
    result = system_assistant_service.start_recipe("network.flush_dns", {})
    return json.dumps(result, ensure_ascii=False, indent=2)


SYSTEM_ASSISTANT_TOOLS = [
    list_system_recipes,
    run_system_recipe,
    get_system_diagnostics,
    search_app_catalog,
    install_application,
    uninstall_application,
    preview_file_organization,
    preview_image_organization,
    compress_images_in_folder,
    edit_images_in_folder,
    dedupe_images_in_folder,
    create_slideshow_from_images,
    flush_dns_cache,
]
