"""Lightweight tool-augmented agent for desktop pet — web, memory, RAG, MCP."""

from __future__ import annotations

import re
import time
from typing import Any, AsyncIterator, Dict, List, Optional

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage

from agents.mcp_tools import attach_mcp_tools
from core.augmented_llm import _build_react_agent, resolve_augmented_tools
from tools.web_search_tools import search_web
from utils.logger import setup_logger

logger = setup_logger("pet_tools_agent")

_PET_TOOLS_CACHE: dict[str, tuple[float, Any]] = {}
_PET_TOOLS_CACHE_TTL_SEC = 45.0
_PET_TOOLS_CACHE_MAX = 6


def clear_pet_tools_cache() -> None:
    _PET_TOOLS_CACHE.clear()

_FAILURE_CUES = (
    "没能查到", "无法查询", "出现问题", "小毛病", "没有找到", "无法获取", "查不到", "暂时没",
    "技术问题", "无法直接获取", "无法获取到", "我没有查到", "没有查到", "建议主人",
    "查看手机", "天气应用", "无法直接",
)
_SUCCESS_CUES = ("°c", "℃", "气温", "多云", "晴天", "晴", "雨", "湿度", "风速", "weather", "阴", "雪", "度")


def _looks_like_success(text: str) -> bool:
    lowered = text.lower()
    return any(cue in lowered if cue.isascii() else cue in text for cue in _SUCCESS_CUES)


def _looks_like_failure(text: str) -> bool:
    return any(cue in text for cue in _FAILURE_CUES)


def is_pet_failure_reply(text: str) -> bool:
    """True when assistant text reads like a failed lookup / apology."""
    t = (text or "").strip()
    if not t:
        return True
    return _looks_like_failure(t)


def coalesce_pet_turns(turns: List[str]) -> str:
    """Merge multi-turn ReAct output into one coherent reply (drop contradictory tail)."""
    if not turns:
        return ""

    chunks: List[str] = []
    for turn in turns:
        for part in re.split(r"\n\n+", turn.strip()):
            piece = part.strip()
            if piece:
                chunks.append(piece)

    if not chunks:
        return turns[-1].strip()

    successes = [c for c in chunks if _looks_like_success(c)]
    failures = [c for c in chunks if _looks_like_failure(c)]

    if successes:
        return successes[0][:800]

    if failures and len(chunks) > 1:
        non_failures = [c for c in chunks if c not in failures]
        if non_failures:
            return non_failures[0][:800]
        tip = "💡 可以换个问法或稍后再问我试试～"
        return f"{failures[-1]}\n\n{tip}"[:800]

    if failures:
        tip = "💡 可以换个问法或稍后再问我试试～"
        return f"{failures[-1]}\n\n{tip}"[:800]

    return chunks[-1][:800]


def _pet_tools_system_prompt(
    *,
    companion: Dict[str, Any],
    memory_context: str,
    perception: Optional[Dict[str, Any]],
    web_prefetch: str = "",
) -> str:
    persona = companion.get("persona") or {}
    pet = companion.get("pet") or {}
    name = pet.get("name") or persona.get("name") or "小光灵"

    perception_lines = ""
    if perception:
        perception_lines = (
            f"\n当前感知：前台={perception.get('foreground_app') or 'unknown'}，"
            f"标题={perception.get('foreground_title') or ''}，"
            f"空闲={perception.get('idle_seconds') or 0}s，"
            f"本地小时={perception.get('local_hour') or ''}。"
        )

    mem_block = f"\n相关记忆：\n{memory_context}" if memory_context else ""
    prefetch_block = ""
    if web_prefetch.strip():
        prefetch_block = (
            "\n\n【已预检索的联网结果 — 优先据此直接回答，通常无需再调用 search_web】\n"
            f"{web_prefetch[:6000]}"
        )

    return f"""你是桌面宠物「{name}」，可以调用工具帮主人查天气、新闻、股价、知识库、记忆等实时信息。
语气：{persona.get('tone') or '温暖、简洁'}；像贴心伙伴，2-5 句中文为主。{perception_lines}{mem_block}{prefetch_block}

**工具规则（必须遵守）：**
1. 若上方已有预检索结果且能回答问题 → **直接回答**，不要再调用 search_web。
2. 仅当预检索为空或明显不够时，才调用 search_web；调用后只给**一条**最终结论。
3. 私人文档/上传资料 → 用 search_knowledge_base；历史偏好 → 用 search_memory。
4. **禁止**先给成功答案再道歉说查不到；禁止重复回答；不要输出 JSON 或工具名。
5. 若确实查不到，一句话说明并给一个可执行建议（如换城市名、稍后再试）。"""


def _to_langchain_messages(messages: List[Dict[str, str]], user_input: str) -> List[BaseMessage]:
    out: List[BaseMessage] = []
    for msg in messages[-8:]:
        role = msg.get("role") or "user"
        content = (msg.get("content") or "").strip()
        if not content:
            continue
        if role == "assistant":
            out.append(AIMessage(content=content))
        else:
            out.append(HumanMessage(content=content))
    if user_input and (not out or not isinstance(out[-1], HumanMessage) or out[-1].content != user_input):
        out.append(HumanMessage(content=user_input))
    return out


def _build_pet_tools_graph(
    *,
    companion: Dict[str, Any],
    memory_context: str,
    perception: Optional[Dict[str, Any]],
    web_prefetch: str = "",
):
    system = _pet_tools_system_prompt(
        companion=companion,
        memory_context=memory_context,
        perception=perception,
        web_prefetch=web_prefetch,
    )
    cache_key = f"{hash(system)}:{hash(web_prefetch[:2000])}"
    now = time.monotonic()
    cached = _PET_TOOLS_CACHE.get(cache_key)
    if cached and (now - cached[0]) < _PET_TOOLS_CACHE_TTL_SEC:
        return cached[1]

    base_tools = resolve_augmented_tools(
        [search_web],
        with_memory=True,
        with_rag=True,
        with_web=True,
    )
    tools = attach_mcp_tools(base_tools)
    compiled = _build_react_agent(system, tools, model=None, streaming=True)
    if len(_PET_TOOLS_CACHE) >= _PET_TOOLS_CACHE_MAX:
        oldest = min(_PET_TOOLS_CACHE, key=lambda k: _PET_TOOLS_CACHE[k][0])
        _PET_TOOLS_CACHE.pop(oldest, None)
    _PET_TOOLS_CACHE[cache_key] = (now, compiled)
    return compiled


async def stream_pet_tools_chat(
    *,
    messages: List[Dict[str, str]],
    user_input: str,
    companion: Dict[str, Any],
    memory_context: str = "",
    perception: Optional[Dict[str, Any]] = None,
    web_prefetch: str = "",
) -> AsyncIterator[dict[str, Any]]:
    """Stream ReAct tool loop for pet; yields token / tool_start / tool_end / final."""
    lc_messages = _to_langchain_messages(messages, user_input)
    if not lc_messages:
        yield {"type": "error", "detail": "empty input"}
        return

    compiled = _build_pet_tools_graph(
        companion=companion,
        memory_context=memory_context,
        perception=perception,
        web_prefetch=web_prefetch,
    )
    t0 = time.monotonic()
    completed_turns: List[str] = []
    current_turn = ""

    async for chunk in compiled.astream({"messages": lc_messages}, stream_mode="messages"):
        if not isinstance(chunk, tuple) or len(chunk) < 1:
            continue
        message_chunk = chunk[0]
        msg_type = getattr(message_chunk, "type", "") or message_chunk.__class__.__name__

        if "Tool" in msg_type:
            tool_name = getattr(message_chunk, "name", "") or ""
            if "ToolMessage" in msg_type or msg_type == "tool":
                yield {"type": "tool_end", "tool_name": tool_name}
            else:
                if current_turn.strip():
                    completed_turns.append(current_turn.strip())
                    current_turn = ""
                yield {"type": "tool_start", "tool_name": tool_name}
            continue

        content = getattr(message_chunk, "content", "")
        if isinstance(content, list):
            content = "".join(
                part.get("text", "") if isinstance(part, dict) else str(part)
                for part in content
            )
        text = str(content or "")
        if not text:
            continue
        if getattr(message_chunk, "type", "") == "AIMessageChunk" or message_chunk.__class__.__name__.endswith(
            "Chunk"
        ):
            current_turn += text

    if current_turn.strip():
        completed_turns.append(current_turn.strip())

    final_text = coalesce_pet_turns(completed_turns)
    logger.info(
        "[pet_tools] done in %.3fs turns=%d len=%d",
        time.monotonic() - t0,
        len(completed_turns),
        len(final_text),
    )
    yield {
        "type": "final",
        "response": final_text or "嗯，我查完了，但暂时没拿到有效结果～",
        "all_turns": completed_turns,
    }
