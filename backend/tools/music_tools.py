"""LangChain tools for AI Music Production."""

from __future__ import annotations

import json

from langchain.tools import tool

from core.music_analysis import compose_music, get_music_provider
from core.music_recipes import list_recipes
from services import music_service
from utils.logger import setup_logger

logger = setup_logger("music_tools")


@tool
def list_music_recipes(category: str = "") -> str:
    """List Music Production recipes. Categories: compose, video."""
    recipes = list_recipes(category=category or None)
    return json.dumps(recipes, ensure_ascii=False, indent=2)


@tool
def run_music_recipe(recipe_id: str, params_json: str = "{}") -> str:
    """Run a Music Production recipe. Example params_json: {"prompt": " upbeat pop for vlog", "duration": 30}."""
    try:
        params = json.loads(params_json) if params_json.strip() else {}
    except json.JSONDecodeError as exc:
        return json.dumps({"success": False, "error": f"Invalid params_json: {exc}"}, ensure_ascii=False)
    try:
        result = music_service.start_recipe(recipe_id, params)
        return json.dumps(result, ensure_ascii=False, indent=2)
    except ValueError as exc:
        return json.dumps({"success": False, "error": str(exc)}, ensure_ascii=False)


@tool
def generate_music(
    prompt: str,
    style: str = "流行",
    mood: str = "欢快",
    duration: int = 30,
    instrumental: bool = False,
    structure: str = "",
    provider: str = "mock",
) -> str:
    """Generate music from a text prompt. Returns audio URL and metadata.

    Args:
        prompt: Description of the music.
        style: Music style (e.g., 流行, 电子, 摇滚, 古典).
        mood: Mood (e.g., 欢快, 抒情, 紧张, 治愈).
        duration: Duration in seconds (10-240).
        instrumental: Whether to generate instrumental only.
        structure: Optional structure tags separated by commas.
        provider: Provider name (mock/minimax/suno).
    """
    try:
        result = compose_music(
            {
                "prompt": prompt,
                "style": style,
                "mood": mood,
                "duration": duration,
                "instrumental": instrumental,
                "structure": structure,
            },
            provider_name=provider,
        )
        return json.dumps(result, ensure_ascii=False, indent=2)
    except Exception as exc:
        logger.error("[music_tools] generate_music failed: %s", exc, exc_info=True)
        return json.dumps({"success": False, "error": str(exc)}, ensure_ascii=False)


@tool
def describe_music_provider(provider: str = "") -> str:
    """Describe available music providers and current default."""
    info = {
        "providers": ["mock", "minimax", "suno"],
        "current": provider or "mock",
        "notes": {
            "mock": "Returns a sample/placeholder audio file for UI development.",
            "minimax": "MiniMax Music API (requires MUSIC_PROVIDER=minimax and API key).",
            "suno": "Suno API (requires MUSIC_PROVIDER=suno and API key).",
        },
    }
    return json.dumps(info, ensure_ascii=False, indent=2)


MUSIC_TOOLS = [
    list_music_recipes,
    run_music_recipe,
    generate_music,
    describe_music_provider,
]
