"""Music Production analysis helpers."""

from __future__ import annotations

import os
import shutil
import time
import uuid
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional

from langchain_core.messages import HumanMessage, SystemMessage

from core.llm_provider import get_chat_llm
from core.music_recipes import get_recipe
from utils.logger import setup_logger

logger = setup_logger("music_analysis")

SYSTEM_PROMPT = """你是 AI Media Agent 的音乐制作顾问，擅长：
- 将用户的文字描述转化为具体的音乐风格、情绪、乐器与结构建议
- 为短视频、Vlog、短剧、博客等内容匹配 BGM
- 提供清晰、可执行的音乐生成提示词

输出要求：
1. 使用中文
2. 给出结构化的音乐生成建议
3. 不编造不存在的艺术家或具体版权作品
4. 若用户提供的信息不足，主动询问关键参数"""


class MusicProvider(ABC):
    """Abstract base for AI music generation providers."""

    name: str = "abstract"

    @abstractmethod
    def generate(
        self,
        prompt: str,
        *,
        lyrics: Optional[str] = None,
        style: Optional[str] = None,
        mood: Optional[str] = None,
        duration: int = 30,
        instrumental: bool = False,
        structure: Optional[str] = None,
        reference_url: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Generate music and return a dict with at least audio_url/path and metadata."""
        ...


class MockMusicProvider(MusicProvider):
    """Mock provider that copies a sample audio file for MVP development."""

    name = "mock"

    def generate(
        self,
        prompt: str,
        *,
        lyrics: Optional[str] = None,
        style: Optional[str] = None,
        mood: Optional[str] = None,
        duration: int = 30,
        instrumental: bool = False,
        structure: Optional[str] = None,
        reference_url: Optional[str] = None,
    ) -> Dict[str, Any]:
        project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        outputs_dir = os.path.join(project_root, "storage", "outputs")
        os.makedirs(outputs_dir, exist_ok=True)

        # Try to find any existing audio file as a mock source; otherwise create a silent mp3 placeholder.
        sample_path = self._find_sample_audio(project_root)
        file_id = f"music_{uuid.uuid4().hex[:12]}_{int(time.time())}.mp3"
        dest_path = os.path.join(outputs_dir, file_id)

        if sample_path:
            shutil.copy2(sample_path, dest_path)
        else:
            # Minimal empty MP3 header placeholder (won't play, but file exists for UI testing)
            with open(dest_path, "wb") as f:
                f.write(b"\x00" * 1024)

        return {
            "provider": self.name,
            "audio_path": dest_path,
            "audio_url": f"/media/{file_id}",
            "duration": duration,
            "prompt": prompt,
            "lyrics": lyrics,
            "style": style,
            "mood": mood,
            "instrumental": instrumental,
            "structure": structure,
            "reference_url": reference_url,
        }

    @staticmethod
    def _find_sample_audio(project_root: str) -> Optional[str]:
        candidates = [
            os.path.join(project_root, "assets", "sample_music.mp3"),
            os.path.join(project_root, "storage", "uploads", "sample_music.mp3"),
        ]
        # Also search for any mp3 in storage/uploads as a fallback.
        uploads = os.path.join(project_root, "storage", "uploads")
        if os.path.isdir(uploads):
            for name in os.listdir(uploads):
                if name.lower().endswith(".mp3"):
                    candidates.append(os.path.join(uploads, name))
        for path in candidates:
            if os.path.isfile(path):
                return path
        return None


class MiniMaxMusicProvider(MusicProvider):
    """Placeholder for MiniMax Music API integration."""

    name = "minimax"

    def generate(
        self,
        prompt: str,
        *,
        lyrics: Optional[str] = None,
        style: Optional[str] = None,
        mood: Optional[str] = None,
        duration: int = 30,
        instrumental: bool = False,
        structure: Optional[str] = None,
        reference_url: Optional[str] = None,
    ) -> Dict[str, Any]:
        # TODO: integrate MiniMax Music API (v2.5/v2.6) once credentials available.
        logger.info("[MiniMaxMusicProvider] using mock fallback until API integration")
        return MockMusicProvider().generate(
            prompt,
            lyrics=lyrics,
            style=style,
            mood=mood,
            duration=duration,
            instrumental=instrumental,
            structure=structure,
            reference_url=reference_url,
        )


class SunoMusicProvider(MusicProvider):
    """Placeholder for Suno API integration."""

    name = "suno"

    def generate(
        self,
        prompt: str,
        *,
        lyrics: Optional[str] = None,
        style: Optional[str] = None,
        mood: Optional[str] = None,
        duration: int = 30,
        instrumental: bool = False,
        structure: Optional[str] = None,
        reference_url: Optional[str] = None,
    ) -> Dict[str, Any]:
        # TODO: integrate Suno API once credentials available.
        logger.info("[SunoMusicProvider] using mock fallback until API integration")
        return MockMusicProvider().generate(
            prompt,
            lyrics=lyrics,
            style=style,
            mood=mood,
            duration=duration,
            instrumental=instrumental,
            structure=structure,
            reference_url=reference_url,
        )


_MUSIC_PROVIDERS: Dict[str, MusicProvider] = {
    "mock": MockMusicProvider(),
    "minimax": MiniMaxMusicProvider(),
    "suno": SunoMusicProvider(),
}


def get_music_provider(name: Optional[str] = None) -> MusicProvider:
    provider_name = (name or os.environ.get("MUSIC_PROVIDER", "mock")).lower()
    provider = _MUSIC_PROVIDERS.get(provider_name)
    if provider is None:
        logger.warning("[music] unknown provider '%s', falling back to mock", provider_name)
        return _MUSIC_PROVIDERS["mock"]
    return provider


def _run_llm(human: str, *, temperature: float = 0.5) -> str:
    llm = get_chat_llm(temperature=temperature)
    result = llm.invoke([SystemMessage(content=SYSTEM_PROMPT), HumanMessage(content=human)])
    return str(result.content or "").strip()


def parse_music_request(params: Dict[str, Any]) -> Dict[str, Any]:
    prompt = str(params.get("prompt") or "").strip()
    lyrics = str(params.get("lyrics") or "").strip() or None
    style = str(params.get("style") or "流行").strip()
    mood = str(params.get("mood") or "欢快").strip()
    duration = max(10, min(240, int(params.get("duration") or 30)))
    instrumental = bool(params.get("instrumental", False))
    structure = str(params.get("structure") or "").strip() or None
    reference_url = str(params.get("reference_url") or "").strip() or None

    if not prompt and not lyrics:
        raise ValueError("prompt or lyrics is required")

    llm_input = (
        f"请根据以下音乐创作需求，生成一段面向 AI 音乐模型的英文优化提示词（prompt），"
        f"并给出中文创作说明。\n\n"
        f"主题/描述：{prompt or '(由歌词决定)'}\n"
        f"风格：{style}\n"
        f"情绪：{mood}\n"
        f"时长：{duration} 秒\n"
        f"纯音乐：{'是' if instrumental else '否'}\n"
        f"结构标签：{structure or '无'}\n"
        f"参考音频：{reference_url or '无'}\n\n"
        "输出 JSON 格式：\n"
        '{"optimized_prompt": "英文提示词", "chinese_note": "中文说明", "suggested_instruments": ["乐器1", "乐器2"]}'
    )
    try:
        parsed = _run_llm(llm_input, temperature=0.5)
    except Exception as exc:
        logger.warning("[music_analysis] LLM parse failed: %s", exc)
        parsed = ""

    return {
        "prompt": prompt,
        "lyrics": lyrics,
        "style": style,
        "mood": mood,
        "duration": duration,
        "instrumental": instrumental,
        "structure": structure,
        "reference_url": reference_url,
        "llm_suggestion": parsed,
    }


def compose_music(params: Dict[str, Any], provider_name: Optional[str] = None) -> Dict[str, Any]:
    parsed = parse_music_request(params)
    provider = get_music_provider(provider_name)
    result = provider.generate(
        parsed["prompt"],
        lyrics=parsed["lyrics"],
        style=parsed["style"],
        mood=parsed["mood"],
        duration=parsed["duration"],
        instrumental=parsed["instrumental"],
        structure=parsed["structure"],
        reference_url=parsed["reference_url"],
    )
    return {**parsed, **result}


def run_analysis(recipe_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
    recipe = get_recipe(recipe_id)
    if recipe is None:
        raise ValueError(f"Unknown recipe: {recipe_id}")

    if recipe_id in {"music.text_to_music", "music.lyrics_to_music", "music.reference_style", "music.bgm_for_video"}:
        return compose_music(params)

    raise ValueError(f"Recipe {recipe_id} has no analysis handler")
