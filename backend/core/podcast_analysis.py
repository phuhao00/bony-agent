"""AI Podcast Production analysis helpers."""

from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional

from langchain_core.messages import HumanMessage, SystemMessage

from core.llm_provider import get_chat_llm
from core.podcast_recipes import get_recipe
from utils.logger import setup_logger

logger = setup_logger("podcast_analysis")

_SYSTEM_PROMPT = """你是 AI Media Agent 的播客制作人，擅长：
- 根据主题设计播客定位、结构与听众画像
- 撰写自然、有节奏感的播客脚本（双人对话或单人独白）
- 设计封面视觉、shownotes、时间轴与发布文案
- 为脚本匹配合适的音色与 BGM

输出要求：
1. 使用中文
2. 脚本口语化、有停顿感、避免书面长句
3. 双人对话要有性格差异和互动感
4. 每段内容标注时间戳（分钟级）
5. 提供封面图生图提示词"""

_FORMAT_CONFIGS = {
    "双人对话": {"style": "两位主持人互动，观点碰撞，轻松有梗", "default_hosts": "A（理性沉稳）, B（活泼好奇）"},
    "单人独白": {"style": "主播独自讲述，娓娓道来，适合知识分享", "default_hosts": "主播"},
    "访谈": {"style": "主持人 + 嘉宾，问答推进，挖掘深度观点", "default_hosts": "主持人, 嘉宾"},
    "叙事": {"style": "讲故事为主，音效与配乐驱动情绪", "default_hosts": "旁白"},
}


def _format_config(format_name: str) -> Dict[str, Any]:
    return _FORMAT_CONFIGS.get(format_name, _FORMAT_CONFIGS["双人对话"])


def _run_llm(human: str, *, temperature: float = 0.7) -> str:
    llm = get_chat_llm(temperature=temperature)
    result = llm.invoke([SystemMessage(content=_SYSTEM_PROMPT), HumanMessage(content=human)])
    return str(result.content or "").strip()


def _extract_json(text: str) -> Optional[Dict[str, Any]]:
    match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text)
    if match:
        text = match.group(1)
    try:
        return json.loads(text)
    except Exception:
        return None


def plan_podcast(params: Dict[str, Any]) -> Dict[str, Any]:
    topic = str(params.get("topic") or "").strip()
    if not topic:
        raise ValueError("topic is required")
    format_name = str(params.get("format") or "双人对话").strip()
    audience = str(params.get("audience") or "普通听众").strip()
    tone = str(params.get("tone") or "轻松").strip()
    duration = max(5, min(120, int(params.get("duration") or 15)))
    config = _format_config(format_name)

    prompt = (
        f"请为「{topic}」策划一档播客节目。\n"
        f"节目形式：{format_name}（{config['style']}）\n"
        f"目标听众：{audience}\n"
        f"语气：{tone}\n"
        f"时长：约 {duration} 分钟\n\n"
        "输出严格 JSON 格式：\n"
        "{\n"
        '  "title": "播客标题",\n'
        '  "subtitle": "副标题",\n'
        '  "positioning": "节目定位",\n'
        '  "target_audience": "目标听众画像",\n'
        '  "hosts": [{"name": "主播A", "persona": "人设"}],\n'
        '  "structure": [\n'
        '    {"segment": "开场", "duration_min": 1, "content": "内容要点"}\n'
        '  ],\n'
        '  "topics": ["话题1", "话题2"],\n'
        '  "hooks": ["开场钩子", "结尾钩子"],\n'
        '  "cover_prompt": "封面图生图提示词，禁 AI 紫蓝渐变与三卡片模板",\n'
        '  "bgm_suggestion": "BGM 风格建议",\n'
        '  "publishing_platforms": ["小宇宙", "Apple Podcasts", "Spotify"]\n'
        "}"
    )
    raw = _run_llm(prompt, temperature=0.65)
    parsed = _extract_json(raw) or {}
    if not parsed:
        logger.warning("[podcast] plan JSON parse failed, returning raw text")
    return {
        "recipe": "podcast.plan",
        "topic": topic,
        "format": format_name,
        "audience": audience,
        "tone": tone,
        "duration": duration,
        "raw": raw,
        "plan": parsed,
    }


def write_script(params: Dict[str, Any]) -> Dict[str, Any]:
    topic = str(params.get("topic") or "").strip()
    if not topic:
        raise ValueError("topic is required")
    format_name = str(params.get("format") or "双人对话").strip()
    hosts = str(params.get("hosts") or _format_config(format_name)["default_hosts"]).strip()
    duration = max(5, min(120, int(params.get("duration") or 15)))
    tone = str(params.get("tone") or "轻松").strip()
    config = _format_config(format_name)

    prompt = (
        f"请为「{topic}」撰写一档 {format_name} 播客的完整脚本。\n"
        f"主持人设定：{hosts}\n"
        f"语气：{tone}\n"
        f"节目形式特点：{config['style']}\n"
        f"目标时长：约 {duration} 分钟\n\n"
        "输出严格 JSON 格式：\n"
        "{\n"
        '  "title": "节目标题",\n'
        '  "format": "双人对话",\n'
        '  "total_duration_min": 15,\n'
        '  "hosts": [{"name": "A", "persona": "理性沉稳"}, {"name": "B", "persona": "活泼好奇"}],\n'
        '  "segments": [\n'
        '    {\n'
        '      "time": "00:00",\n'
        '      "duration_min": 1,\n'
        '      "type": "开场",\n'
        '      "content": "主持人对话内容，口语化，带停顿"\n'
        '    }\n'
        '  ],\n'
        '  "highlight_quotes": ["金句1", "金句2"],\n'
        '  "bgm_cues": ["00:00 轻快前奏", "05:30 情绪递进"]\n'
        "}\n\n"
        "要求：\n"
        "1. 内容口语化，避免书面长句\n"
        "2. 双人对话要有性格差异\n"
        "3. 每段标注时间戳和时长\n"
        "4. 总时长尽量接近目标时长"
    )
    raw = _run_llm(prompt, temperature=0.75)
    parsed = _extract_json(raw) or {}
    if not parsed:
        logger.warning("[podcast] script JSON parse failed, returning raw text")
    return {
        "recipe": "podcast.script",
        "topic": topic,
        "format": format_name,
        "hosts": hosts,
        "duration": duration,
        "tone": tone,
        "raw": raw,
        "script": parsed,
    }


def design_cover(params: Dict[str, Any]) -> Dict[str, Any]:
    title = str(params.get("title") or "").strip()
    if not title:
        raise ValueError("title is required")
    topic = str(params.get("topic") or "").strip()
    style = str(params.get("style") or "现代简约").strip()

    prompt = (
        f"请为播客「{title}」设计封面图。\n"
        f"主题：{topic or title}\n"
        f"视觉风格：{style}\n\n"
        "输出严格 JSON 格式：\n"
        "{\n"
        '  "title": "播客标题",\n'
        '  "visual_concept": "视觉概念说明",\n'
        '  "color_palette": ["主色", "辅色"],\n'
        '  "composition": "构图建议",\n'
        '  "english_prompt": "用于 AI 生图的英文提示词，高质量、无文字、适合播客封面",\n'
        '  "chinese_prompt": "中文提示词"\n'
        "}"
    )
    raw = _run_llm(prompt, temperature=0.6)
    parsed = _extract_json(raw) or {}
    if not parsed:
        logger.warning("[podcast] cover JSON parse failed, returning raw text")
    return {
        "recipe": "podcast.cover",
        "title": title,
        "topic": topic,
        "style": style,
        "raw": raw,
        "cover": parsed,
    }


def prepare_voiceover(params: Dict[str, Any]) -> Dict[str, Any]:
    script = str(params.get("script") or "").strip()
    if not script:
        raise ValueError("script is required")
    voice = str(params.get("voice") or "default").strip()
    bgm_mood = str(params.get("bgm_mood") or "轻松").strip()

    # For MVP, return a structured plan instead of actual TTS generation.
    # Actual TTS can be triggered by the frontend using /tools/audio/tts.
    segments = []
    for i, line in enumerate(script.split("\n"), start=1):
        line = line.strip()
        if not line:
            continue
        speaker = "旁白"
        if "：" in line or ":" in line:
            speaker = line.split("：")[0].split(":")[0].strip()
        segments.append({"index": i, "speaker": speaker, "text": line})

    return {
        "recipe": "podcast.voiceover",
        "voice": voice,
        "bgm_mood": bgm_mood,
        "segments": segments,
        "tts_hint": "请使用 /tools/audio/tts 将 segments 转换为音频，或使用音频工具生成多主播配音。",
    }


def prepare_publish(params: Dict[str, Any]) -> Dict[str, Any]:
    title = str(params.get("title") or "").strip()
    script = str(params.get("script") or "").strip()
    platform = str(params.get("platform") or "xiaoyuzhou").strip()
    if not title or not script:
        raise ValueError("title and script are required")

    prompt = (
        f"请为播客「{title}」生成 {platform} 平台的发布文案。\n\n"
        "脚本前 1000 字：\n"
        f"{script[:1000]}\n\n"
        "输出严格 JSON 格式：\n"
        "{\n"
        '  "title": "发布标题",\n'
        '  "subtitle": "副标题",\n'
        '  "shownotes": "详细 shownotes（含时间轴、要点、嘉宾信息）",\n'
        '  "short_description": "短描述（≤200字）",\n'
        '  "hashtags": ["#话题1", "#话题2"],\n'
        '  "cta": "订阅/评论/分享引导",\n'
        '  "cover_hint": "封面图建议"\n'
        "}"
    )
    raw = _run_llm(prompt, temperature=0.6)
    parsed = _extract_json(raw) or {}
    if not parsed:
        logger.warning("[podcast] publish JSON parse failed, returning raw text")
    return {
        "recipe": "podcast.publish",
        "title": title,
        "platform": platform,
        "raw": raw,
        "publish": parsed,
    }


def run_analysis(recipe_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
    recipe = get_recipe(recipe_id)
    if recipe is None:
        raise ValueError(f"Unknown recipe: {recipe_id}")

    if recipe_id == "podcast.plan":
        return plan_podcast(params)
    if recipe_id == "podcast.script":
        return write_script(params)
    if recipe_id == "podcast.cover":
        return design_cover(params)
    if recipe_id == "podcast.voiceover":
        return prepare_voiceover(params)
    if recipe_id == "podcast.publish":
        return prepare_publish(params)

    raise ValueError(f"Recipe {recipe_id} has no analysis handler")
