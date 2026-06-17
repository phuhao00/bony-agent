"""Deterministic video generation + publish (LangGraph node)."""

from __future__ import annotations

import json
import os
from typing import Any, Dict

from langchain_core.messages import AIMessage

from agents.base.message import AgentMessage
from agents.publish_routing import detect_publish_platform, is_video_generation_publish_request
from tools.connectors.manager import get_connector_manager
from tools.media_tools import generate_video
from utils.generation_history import add_generation_record
from utils.media_resolver import normalize_publish_media
from utils.logger import setup_logger

logger = setup_logger("publish_pipeline_node")


def _extract_video_url_from_result(text: str) -> str:
    import re

    m = re.search(r"(storage/outputs/[^\s\"')]+\.(?:mp4|webm|mov|avi))", text or "", re.I)
    if m:
        return m.group(1)
    m = re.search(r"(https?://[^\s\"')]+\.(?:mp4|webm|mov|avi))", text or "", re.I)
    return m.group(1) if m else ""


async def run_video_generation_publish_pipeline(
    user_input: str,
    *,
    outputs_dir: str,
) -> Dict[str, Any]:
    import asyncio

    platform = detect_publish_platform(user_input)
    if not platform:
        raise ValueError("无法识别发布平台")

    logger.info("publish_pipeline start platform=%s input=%.80r", platform, user_input)
    video_result = await asyncio.to_thread(generate_video.invoke, user_input)
    video_result_text = str(video_result or "")
    media_urls = normalize_publish_media(
        media_urls=[],
        content=video_result_text,
        content_type="video",
        outputs_dir=outputs_dir,
        logger=logger,
    )
    if not media_urls:
        raise ValueError(f"视频已生成但未解析到可发布的视频路径: {video_result_text[:300]}")

    publish_result = await get_connector_manager().publish_to_platform(
        platform_id=platform,
        content_type="video",
        title="AI生成视频",
        content=user_input,
        media_urls=media_urls,
        options={},
    )
    publish_dict = publish_result.to_dict()
    add_generation_record(
        record_type="publish",
        prompt=f"发布到 {platform}: AI生成视频",
        result=json.dumps(publish_dict, ensure_ascii=False),
        metadata={"platform": platform, "media_urls": media_urls, "source": "publish_pipeline_node"},
    )

    media_url = _extract_video_url_from_result(video_result_text)
    if not media_url and media_urls:
        first_media = media_urls[0]
        if isinstance(first_media, str) and first_media.startswith("http"):
            media_url = first_media
        else:
            media_url = f"/api/media/{os.path.basename(str(first_media))}"

    platform_url = publish_dict.get("url") or ""
    if publish_result.success:
        response = (
            f"视频已生成，并已发布到 {platform}。\n\n"
            f"生成结果：\n{video_result_text}\n\n"
            f"发布链接：{platform_url or '平台未返回链接'}"
        )
    else:
        response = (
            f"视频已生成，但发布到 {platform} 失败。\n\n"
            f"生成结果：\n{video_result_text}\n\n"
            f"失败原因：{publish_dict.get('error') or publish_result.error or '未知错误'}"
        )

    return {
        "response": response,
        "completed_agents": ["media_agent"],
        "media_url": media_url,
        "media_urls": media_urls,
        "platform": platform,
        "publish_result": publish_dict,
        "video_result": video_result_text,
    }


def build_publish_pipeline_node(outputs_dir: str):
    async def publish_pipeline_node(state: dict) -> dict:
        messages = state.get("messages") or []
        user_text = ""
        for msg in messages:
            if getattr(msg, "type", "") == "human" or msg.__class__.__name__ == "HumanMessage":
                user_text = str(getattr(msg, "content", "") or "")
                break
        result = await run_video_generation_publish_pipeline(user_text, outputs_dir=outputs_dir)
        content = str(result.get("response") or "")
        msg = AgentMessage(sender="media_agent", content=content)
        return {
            "messages": [msg.to_langchain_message()],
            "completed_agents": ["media_agent"],
            "final_response": content,
            "next_agent": "FINISH",
            "media_url": result.get("media_url") or "",
        }

    return publish_pipeline_node
