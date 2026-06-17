"""AI Short Drama analysis helpers."""

from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional

from langchain_core.messages import HumanMessage, SystemMessage

from core.llm_provider import get_chat_llm
from core.short_drama_recipes import get_recipe
from utils.logger import setup_logger

logger = setup_logger("short_drama_analysis")

_SYSTEM_PROMPT = """你是 AI Media Agent 的短剧导演，擅长：
- 将一句话创意扩展为适合短视频平台的短剧剧本
- 设计有记忆点的角色与冲突
- 按平台特性（抖音/快手/小红书/YouTube Shorts）调整节奏与画面比例
- 输出结构化的剧本、分镜与角色卡

输出要求：
1. 使用中文
2. 节奏快、钩子强、适合竖屏
3. 总时长符合用户要求
4. 角色不超过 4 人，避免复杂关系
5. 每个场景包含：景别、运镜、画面描述、台词/旁白、情绪、BGM 建议"""

_PLATFORM_CONFIGS = {
    "douyin": {"name": "抖音", "ratio": "9:16", "max_duration": 600, "style": "节奏快、强情绪、开头3秒钩子"},
    "kuaishou": {"name": "快手", "ratio": "9:16", "max_duration": 600, "style": "接地气、真实感、剧情反转"},
    "xiaohongshu": {"name": "小红书", "ratio": "3:4", "max_duration": 300, "style": "治愈、精致、女性向、画面干净"},
    "youtube_shorts": {"name": "YouTube Shorts", "ratio": "9:16", "max_duration": 60, "style": "全球化、强视觉、少对白依赖"},
}

_DRAMA_STYLES = {
    "甜宠": "甜蜜浪漫，男女主互动高甜，氛围温暖柔和",
    "悬疑": "紧张刺激，信息逐步揭露，结尾反转",
    "喜剧": "轻松搞笑，节奏明快，台词有梗",
    "古风": "唯美古典，服装场景考究，情感含蓄",
    "逆袭": "底层主角逆袭，爽点密集，情绪共鸣强",
    "虐恋": "情感拉扯，误会与和解，催泪向",
}


def _platform_config(platform: str) -> Dict[str, Any]:
    return _PLATFORM_CONFIGS.get(platform, _PLATFORM_CONFIGS["douyin"])


def _style_desc(style: str) -> str:
    return _DRAMA_STYLES.get(style, style)


def _run_llm(human: str, *, temperature: float = 0.7) -> str:
    llm = get_chat_llm(temperature=temperature)
    result = llm.invoke([SystemMessage(content=_SYSTEM_PROMPT), HumanMessage(content=human)])
    return str(result.content or "").strip()


def _extract_json(text: str) -> Optional[Dict[str, Any]]:
    # Try to extract JSON from markdown code block
    match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text)
    if match:
        text = match.group(1)
    try:
        return json.loads(text)
    except Exception:
        return None


def analyze_plot(params: Dict[str, Any]) -> Dict[str, Any]:
    brief = str(params.get("brief") or "").strip()
    if not brief:
        raise ValueError("brief is required")
    platform = str(params.get("platform") or "douyin").strip()
    duration = max(15, min(600, int(params.get("duration") or 60)))
    style = str(params.get("style") or "甜宠").strip()
    episodes = max(1, min(10, int(params.get("episodes") or 1)))
    config = _platform_config(platform)

    prompt = (
        f"请为「{brief}」创作一部适合 {config['name']} 的短剧剧本。\n"
        f"风格：{style}（{_style_desc(style)}）\n"
        f"时长：约 {duration} 秒\n"
        f"集数：{episodes} 集\n"
        f"平台特性：{config['style']}\n"
        f"画面比例：{config['ratio']}\n\n"
        "输出严格 JSON 格式：\n"
        "{\n"
        '  "title": "短剧标题",\n'
        '  "hook": "前3秒钩子",\n'
        '  "synopsis": "剧情简介",\n'
        '  "characters": [\n'
        '    {"name": "角色名", "role": "主角/反派/配角", "traits": "性格特点", "look": "外貌/服装建议"}\n'
        '  ],\n'
        '  "episodes": [\n'
        '    {"episode": 1, "title": "集标题", "summary": "本集梗概", "duration_sec": 60}\n'
        '  ],\n'
        '  "scenes": [\n'
        '    {"scene_id": 1, "episode": 1, "duration_sec": 10, "shot": "景别与运镜", "description": "画面描述", "dialogue": "台词/旁白", "emotion": "情绪", "bgm": "BGM建议"}\n'
        '  ],\n'
        '  "cta": "结尾行动号召或悬念",\n'
        '  "tags": ["标签1", "标签2"]\n'
        "}\n\n"
        "注意：场景总时长尽量接近目标时长，场景数不超过 10 个。"
    )
    raw = _run_llm(prompt, temperature=0.7)
    parsed = _extract_json(raw) or {}
    if not parsed:
        logger.warning("[short_drama] script JSON parse failed, returning raw text")
    return {
        "recipe": "short_drama.script",
        "brief": brief,
        "platform": platform,
        "duration": duration,
        "style": style,
        "episodes": episodes,
        "raw": raw,
        "script": parsed,
    }


def build_storyboard(params: Dict[str, Any]) -> Dict[str, Any]:
    brief = str(params.get("brief") or "").strip()
    if not brief:
        raise ValueError("brief is required")
    platform = str(params.get("platform") or "douyin").strip()
    duration = max(15, min(600, int(params.get("duration") or 60)))
    style = str(params.get("style") or "甜宠").strip()
    scene_count = max(3, min(12, int(params.get("scenes") or 6)))
    config = _platform_config(platform)

    prompt = (
        f"请为「{brief}」创作 {config['name']} 短剧的分镜脚本。\n"
        f"风格：{style}（{_style_desc(style)}）\n"
        f"总时长：约 {duration} 秒\n"
        f"场景数：{scene_count} 个\n"
        f"画面比例：{config['ratio']}\n\n"
        "输出严格 JSON 格式：\n"
        "{\n"
        '  "title": "短剧标题",\n'
        '  "hook": "前3秒钩子",\n'
        '  "characters": [{"name": "角色名", "look": "外貌/服装"}],\n'
        '  "scenes": [\n'
        '    {\n'
        '      "scene_id": 1,\n'
        '      "duration_sec": 8,\n'
        '      "shot_type": "特写/中景/远景",\n'
        '      "camera_movement": "固定/推/拉/摇/跟",\n'
        '      "description": "画面内容，含角色动作、场景、光线",\n'
        '      "image_prompt": "用于 AI 生图的英文提示词，需包含角色一致性描述",\n'
        '      "dialogue": "台词或旁白",\n'
        '      "subtitle": "字幕文案",\n'
        '      "emotion": "情绪标签",\n'
        '      "bgm": "BGM 风格建议"\n'
        '    }\n'
        '  ],\n'
        '  "editing_notes": "剪辑节奏、转场、字幕样式建议",\n'
        '  "publishing_tips": "标题、封面、话题标签建议"\n'
        "}\n\n"
        f"要求：总时长约 {duration} 秒，每个场景 3-12 秒，画面描述要具体、可视觉化。"
    )
    raw = _run_llm(prompt, temperature=0.75)
    parsed = _extract_json(raw) or {}
    if not parsed:
        logger.warning("[short_drama] storyboard JSON parse failed, returning raw text")
    return {
        "recipe": "short_drama.storyboard",
        "brief": brief,
        "platform": platform,
        "duration": duration,
        "style": style,
        "scene_count": scene_count,
        "raw": raw,
        "storyboard": parsed,
    }


def _generate_scene_images(scenes: List[Dict[str, Any]], style: str) -> List[Dict[str, Any]]:
    """Best-effort scene image generation. Returns scenes enriched with image results."""
    try:
        from tools.image_tools import generate_image
    except Exception as exc:
        logger.warning("[short_drama] image_tools import failed: %s", exc)
        return scenes

    enriched = []
    for scene in scenes:
        scene = dict(scene)
        prompt = scene.get("image_prompt") or scene.get("description", "")
        if not prompt:
            enriched.append(scene)
            continue
        full_prompt = f"{prompt}. Style: {style}. Vertical 9:16 cinematic shot, photorealistic, high quality."
        try:
            result = generate_image.invoke({"prompt": full_prompt}) if hasattr(generate_image, "invoke") else generate_image(full_prompt)
            scene["image_result"] = str(result)
            # Try to extract local path
            path_match = re.search(r"\*\*本地路径:\*\*\s*(\S+)", str(result))
            if path_match:
                scene["local_image_path"] = path_match.group(1)
        except Exception as exc:
            logger.warning("[short_drama] scene image generation failed: %s", exc)
            scene["image_result"] = f"生成失败: {exc}"
        enriched.append(scene)
    return enriched


def produce_short_drama(params: Dict[str, Any]) -> Dict[str, Any]:
    brief = str(params.get("brief") or "").strip()
    if not brief:
        raise ValueError("brief is required")
    platform = str(params.get("platform") or "douyin").strip()
    duration = max(15, min(600, int(params.get("duration") or 60)))
    style = str(params.get("style") or "甜宠").strip()
    generate_images = bool(params.get("generate_images", True))
    voiceover = bool(params.get("voiceover", False))

    # 1. Storyboard
    storyboard_result = build_storyboard(
        {"brief": brief, "platform": platform, "duration": duration, "style": style, "scenes": 8}
    )
    storyboard = storyboard_result.get("storyboard") or {}
    scenes = storyboard.get("scenes") or []

    # 2. Optional image generation
    if generate_images and scenes:
        scenes = _generate_scene_images(scenes, style)

    # 3. Optional voiceover text
    voiceover_text = ""
    if voiceover:
        voiceover_text = "\n".join(
            f"场景 {s.get('scene_id')}: {s.get('dialogue', '')}" for s in scenes if s.get("dialogue")
        )

    return {
        "recipe": "short_drama.produce",
        "brief": brief,
        "platform": platform,
        "duration": duration,
        "style": style,
        "title": storyboard.get("title", ""),
        "hook": storyboard.get("hook", ""),
        "characters": storyboard.get("characters", []),
        "scenes": scenes,
        "editing_notes": storyboard.get("editing_notes", ""),
        "publishing_tips": storyboard.get("publishing_tips", ""),
        "voiceover_text": voiceover_text,
        "generate_images": generate_images,
        "voiceover": voiceover,
    }


def regen_scene(params: Dict[str, Any]) -> Dict[str, Any]:
    desc = str(params.get("scene_description") or "").strip()
    if not desc:
        raise ValueError("scene_description is required")
    style = str(params.get("style") or "").strip()
    shot_type = str(params.get("shot_type") or "中景").strip()

    prompt = f"{desc}. Shot type: {shot_type}. Style: {style or 'cinematic'}. Vertical 9:16, photorealistic, high quality."
    try:
        from tools.image_tools import generate_image

        result = generate_image.invoke({"prompt": prompt}) if hasattr(generate_image, "invoke") else generate_image(prompt)
        return {
            "recipe": "short_drama.scene_regen",
            "scene_description": desc,
            "style": style,
            "shot_type": shot_type,
            "image_result": str(result),
        }
    except Exception as exc:
        return {
            "recipe": "short_drama.scene_regen",
            "scene_description": desc,
            "style": style,
            "shot_type": shot_type,
            "error": str(exc),
        }


def run_analysis(recipe_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
    recipe = get_recipe(recipe_id)
    if recipe is None:
        raise ValueError(f"Unknown recipe: {recipe_id}")

    if recipe_id == "short_drama.script":
        return analyze_plot(params)
    if recipe_id == "short_drama.storyboard":
        return build_storyboard(params)
    if recipe_id == "short_drama.produce":
        return produce_short_drama(params)
    if recipe_id == "short_drama.scene_regen":
        return regen_scene(params)

    raise ValueError(f"Recipe {recipe_id} has no analysis handler")
