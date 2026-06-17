"""
基于 research_artifact 生成内容选题、脚本方向与发布计划（结构化 JSON）。
"""

from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional

from langchain_core.messages import HumanMessage, SystemMessage
from utils.logger import setup_logger

logger = setup_logger("research_content_plan")

SYSTEM_PROMPT = """你是一位资深短视频与社媒内容策划。用户会提供基于联网检索的材料摘要与参考链接。
请只输出一个合法的 JSON 对象（不要 Markdown 围栏以外的文字），结构固定为：
{
  "topic_ideas": [ { "title": "选题标题", "angle": "切入角度/差异点", "audience": "目标受众简述" } ],
  "script_direction": {
    "hook": "开头钩子建议（1-2句）",
    "structure": ["段落或镜头模块1", "模块2", "..."],
    "cta": "结尾转化/互动引导"
  },
  "publish_plan": [
    { "platform": "平台名", "format": "图文/短视频/口播等", "schedule_hint": "发布节奏建议", "caption_outline": "文案大纲要点" }
  ]
}
要求：选题 3–5 个；structure 至少 4 步；publish_plan 至少覆盖用户指定的主平台，可补充 1–2 个衍生平台。内容要具体可执行，避免空泛套话。"""


def format_research_for_planning(
    artifact: Dict[str, Any],
    *,
    max_item_snippet: int = 450,
    max_summary: int = 7000,
    max_items: int = 14,
) -> str:
    """将 research_artifact 压成给策划 LLM 阅读的纯文本。"""
    if not isinstance(artifact, dict):
        return ""
    lines: list[str] = []
    q = (artifact.get("query") or "").strip()
    title = (artifact.get("title") or "").strip()
    src = artifact.get("source") or ""
    summ = (artifact.get("summary") or "").strip()[:max_summary]
    if q:
        lines.append(f"检索词: {q}")
    if title:
        lines.append(f"材料标题: {title}")
    if src:
        lines.append(f"来源类型: {src}")
    lines.append("")
    lines.append("摘要:")
    lines.append(summ or "(无摘要)")
    items = artifact.get("items") or []
    if isinstance(items, list) and items:
        lines.append("")
        lines.append("参考条目:")
        for i, it in enumerate(items[:max_items], 1):
            if not isinstance(it, dict):
                continue
            t = ((it.get("title") or "").strip())[:220]
            u = ((it.get("url") or "").strip())[:600]
            s = ((it.get("snippet") or "").strip())[:max_item_snippet]
            lines.append(f"{i}. {t}")
            if u:
                lines.append(f"   链接: {u}")
            if s:
                lines.append(f"   摘录: {s}")
            lines.append("")
    return "\n".join(lines).strip()


def extract_json_object(text: str) -> Dict[str, Any]:
    """从 LLM 输出中解析唯一 JSON 对象。"""
    raw = (text or "").strip()
    if not raw:
        raise ValueError("empty_llm_output")
    if "```" in raw:
        m = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", raw, re.IGNORECASE)
        if m:
            raw = m.group(1).strip()
    raw = raw.strip()
    if not raw.startswith("{"):
        i = raw.find("{")
        j = raw.rfind("}")
        if i >= 0 and j > i:
            raw = raw[i : j + 1]
    return json.loads(raw)


async def generate_research_content_plan(
    artifact: Dict[str, Any],
    *,
    platform: str = "douyin",
    goal: str = "",
) -> Dict[str, Any]:
    """
    调用当前配置的 Chat LLM，返回 {"plan": dict, "llm_text": str} 或 {"error": str, ...}。
    """
    from core.llm_provider import get_api_key, get_chat_llm

    if not isinstance(artifact, dict) or not artifact:
        return {"error": "invalid_artifact", "detail": "artifact must be a non-empty dict"}

    if not get_api_key():
        return {"error": "no_api_key", "detail": "LLM API Key 未配置"}

    brief = format_research_for_planning(artifact)
    if not brief:
        return {"error": "empty_brief", "detail": "无法从 artifact 提取有效文本"}

    goal_line = (goal or "").strip()
    human = (
        f"主发布平台（请重点适配）: {platform}\n"
        + (f"用户额外目标: {goal_line}\n\n" if goal_line else "\n")
        + "以下为检索材料：\n\n"
        + brief
    )

    llm = get_chat_llm(temperature=0.45, streaming=False, api_key=get_api_key())
    messages = [
        SystemMessage(content=SYSTEM_PROMPT),
        HumanMessage(content=human),
    ]
    text = ""
    try:
        resp = await llm.ainvoke(messages)
        text = getattr(resp, "content", None) or str(resp)
        plan = extract_json_object(text)
        return {"plan": plan, "llm_text": text}
    except json.JSONDecodeError as e:
        logger.warning("research_content_plan JSON parse failed: %s", e)
        return {
            "error": "invalid_json",
            "detail": str(e),
            "llm_preview": (text or "")[:1500],
        }
    except Exception as e:
        logger.error("research_content_plan LLM error: %s", e, exc_info=True)
        return {"error": "llm_failed", "detail": str(e)}


def merge_artifacts_for_planning(artifacts: List[Dict[str, Any]]) -> Dict[str, Any]:
    """将多篇 research_artifact 合并为一个供策划使用的 artifact。"""
    from core.research_artifact import make_research_artifact, merge_research_summaries

    clean = [a for a in artifacts if isinstance(a, dict)]
    if not clean:
        return make_research_artifact("custom", query="", summary="", items=[])
    if len(clean) == 1:
        return clean[0]
    merged = merge_research_summaries(clean, max_items=40)
    queries = [str(a.get("query") or "").strip() for a in clean if (a.get("query") or "").strip()]
    qcomb = " | ".join(dict.fromkeys(queries))[:3500]
    return make_research_artifact(
        "custom",
        query=qcomb or "merged_research",
        title="合并检索材料",
        summary="",
        items=merged.get("items") or [],
        raw={"merged_sources": merged.get("sources"), "merged_item_count": merged.get("item_count")},
    )
