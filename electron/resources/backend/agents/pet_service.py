"""Desktop companion pet chat — structured SSE + hybrid routing."""

from __future__ import annotations

import json
import re
import time
from pathlib import Path
from typing import Any, AsyncIterator, Dict, List, Optional

from agents.pet_router import PetRoute, classify_pet_route, pet_stage_from_care
from agents.search_intent import looks_like_mandatory_web_lookup
from agents.sse_adapter import format_sse_event
from core.companion_state import get_companion_state, patch_companion_state
from core.llm_provider import (
    get_api_key,
    get_chat_llm,
    get_current_model,
    get_ollama_model,
    get_provider_id,
    is_ollama_available,
)
from utils.logger import setup_logger

logger = setup_logger("pet_service")

PROJECT_ROOT = Path(__file__).resolve().parents[2]
PERCEPTION_LOG = PROJECT_ROOT / "storage" / "companion" / "perception.jsonl"
PERCEPTION_MAX_LINES = 200
PERCEPTION_MAX_BYTES = 512 * 1024

PET_ACTIONS = frozenset(
    {"cheer_up", "thinking", "idle", "celebrate", "remind_drink", "talking"}
)

_JSON_BLOCK = re.compile(r"\{[\s\S]*\}")


def _ensure_perception_dir() -> None:
    PERCEPTION_LOG.parent.mkdir(parents=True, exist_ok=True)


def _trim_perception_log() -> None:
    """Keep perception log bounded to avoid unbounded disk + read growth."""
    if not PERCEPTION_LOG.is_file():
        return
    try:
        size = PERCEPTION_LOG.stat().st_size
        if size <= PERCEPTION_MAX_BYTES:
            with PERCEPTION_LOG.open("r", encoding="utf-8") as fh:
                line_count = sum(1 for _ in fh)
            if line_count <= PERCEPTION_MAX_LINES:
                return
        lines = PERCEPTION_LOG.read_text(encoding="utf-8").splitlines()
        kept = lines[-PERCEPTION_MAX_LINES:]
        PERCEPTION_LOG.write_text("\n".join(kept) + ("\n" if kept else ""), encoding="utf-8")
    except Exception as exc:
        logger.warning("perception log trim skipped: %s", exc)


def append_perception_context(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Persist Tauri perception snapshot for dream / pet prompts."""
    _ensure_perception_dir()
    row = {"ts": time.time(), **payload}
    with PERCEPTION_LOG.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(row, ensure_ascii=False) + "\n")
    _trim_perception_log()
    return {"success": True, "stored": True}


def load_latest_perception() -> Optional[Dict[str, Any]]:
    if not PERCEPTION_LOG.is_file():
        return None
    try:
        with PERCEPTION_LOG.open("rb") as fh:
            fh.seek(0, 2)
            size = fh.tell()
            if size <= 0:
                return None
            read_size = min(size, 8192)
            fh.seek(max(0, size - read_size))
            chunk = fh.read().decode("utf-8", errors="replace")
        lines = [ln for ln in chunk.splitlines() if ln.strip()]
        if not lines:
            return None
        return json.loads(lines[-1])
    except Exception:
        return None


def _build_system_prompt(
    *,
    companion: Dict[str, Any],
    memory_context: str,
    perception: Optional[Dict[str, Any]],
) -> str:
    persona = companion.get("persona") or {}
    pet = companion.get("pet") or {}
    growth = companion.get("growth") or {}
    mood = companion.get("mood") or {}
    name = pet.get("name") or persona.get("name") or "小助手"
    stage = pet.get("stage") or pet_stage_from_care(int(pet.get("care_score") or 0))

    perception_lines = ""
    if perception:
        perception_lines = (
            f"\n感知上下文：前台应用={perception.get('foreground_app') or 'unknown'}，"
            f"窗口标题={perception.get('foreground_title') or ''}，"
            f"空闲秒数={perception.get('idle_seconds') or 0}，"
            f"本地小时={perception.get('local_hour') or ''}。"
        )
        clip = perception.get("clipboard_preview")
        if clip:
            perception_lines += f"\n剪贴板预览（用户已授权）：{str(clip)[:200]}"

    mem_block = f"\n相关记忆摘要：\n{memory_context}" if memory_context else ""

    return f"""你是桌面宠物「{name}」，物种 {pet.get('species') or '光灵'}，成长阶段 {stage}，等级 {growth.get('level', 1)}。
人格：{persona.get('traits') or '温暖、俏皮'}；语气：{persona.get('tone') or '友好简洁'}。
当前心情：{mood.get('label') or 'neutral'}。{perception_lines}{mem_block}

你必须只输出一个 JSON 对象（不要 markdown 代码块），字段：
- action: cheer_up | thinking | idle | celebrate | remind_drink | talking
- text: 给主人的短回复（1-3 句，中文为主）
- mood: happy | neutral | sad | excited
- tool_hint: null 或简短工具建议字符串

规则：闲聊与情绪陪伴用 talking/cheer_up；提醒喝水用 remind_drink；庆祝用 celebrate；思考中用 thinking。"""


def _parse_pet_json(raw: str) -> Dict[str, Any]:
    text = (raw or "").strip()
    if not text:
        return {"action": "idle", "text": "…", "mood": "neutral", "tool_hint": None}

    try:
        obj = json.loads(text)
        if isinstance(obj, dict) and obj.get("text"):
            return _normalize_pet_response(obj)
    except json.JSONDecodeError:
        pass

    match = _JSON_BLOCK.search(text)
    if match:
        try:
            obj = json.loads(match.group(0))
            if isinstance(obj, dict):
                return _normalize_pet_response(obj)
        except json.JSONDecodeError:
            pass

    return {
        "action": "talking",
        "text": text[:500],
        "mood": "neutral",
        "tool_hint": None,
    }


def _normalize_pet_response(obj: Dict[str, Any]) -> Dict[str, Any]:
    action = str(obj.get("action") or "talking").strip()
    if action not in PET_ACTIONS:
        action = "talking"
    mood = str(obj.get("mood") or "neutral").strip()
    if mood not in {"happy", "neutral", "sad", "excited"}:
        mood = "neutral"
    tool_hint = obj.get("tool_hint")
    if tool_hint is not None:
        tool_hint = str(tool_hint)[:200]
    return {
        "action": action,
        "text": str(obj.get("text") or "").strip() or "嗯嗯，我在呢～",
        "mood": mood,
        "tool_hint": tool_hint,
    }


def _prefetch_memory(query: str, tag_ids: List[str]) -> str:
    try:
        from services.memory_coordinator import get_memory_coordinator

        result = get_memory_coordinator().prefetch(query, k=3, priority_ids=tag_ids)
        return str(result.get("context") or "")
    except Exception as exc:
        logger.warning("pet memory prefetch skipped: %s", exc)
        return ""


def _messages_to_prompt(messages: List[Dict[str, str]], user_input: str) -> str:
    parts: List[str] = []
    for m in messages[-6:]:
        role = m.get("role") or "user"
        content = (m.get("content") or "").strip()
        if content:
            parts.append(f"{role}: {content}")
    if user_input and (not parts or not parts[-1].endswith(user_input)):
        parts.append(f"user: {user_input}")
    return "\n".join(parts) if parts else user_input


async def _invoke_local_or_cloud(
    *,
    system: str,
    user_text: str,
    route: PetRoute,
    streaming: bool,
) -> AsyncIterator[str]:
    from langchain_core.messages import HumanMessage, SystemMessage

    if route == "local":
        llm = get_chat_llm(temperature=0.8, streaming=streaming, provider_id="ollama")
    else:
        llm = get_chat_llm(temperature=0.7, streaming=streaming)

    msgs = [SystemMessage(content=system), HumanMessage(content=user_text)]
    if streaming:
        async for chunk in llm.astream(msgs):
            piece = getattr(chunk, "content", "") or ""
            if piece:
                yield str(piece)
    else:
        resp = await llm.ainvoke(msgs)
        yield str(getattr(resp, "content", "") or "")


async def stream_pet_chat(
    *,
    messages: List[Dict[str, str]],
    user_input: str,
    perception: Optional[Dict[str, Any]] = None,
    force_agent: bool = False,
) -> AsyncIterator[str]:
    """Yield SSE lines for pet chat."""
    text = (user_input or "").strip()
    if not text and messages:
        text = (messages[-1].get("content") or "").strip()

    route = classify_pet_route(text, force_agent=force_agent)
    companion = get_companion_state()
    tag_ids = list(companion.get("memory_tag_ids") or [])
    mem_ctx = _prefetch_memory(text, tag_ids)
    perception_snapshot = perception or load_latest_perception()
    system = _build_system_prompt(
        companion=companion,
        memory_context=mem_ctx,
        perception=perception_snapshot,
    )

    yield format_sse_event(
        {
            "type": "metadata",
            "route": route,
            "ollama_available": is_ollama_available(),
            "provider": get_provider_id() if route != "local" else "ollama",
            "model": get_ollama_model() if route == "local" else get_current_model(),
        }
    )

    if route == "agent":
        from agents.pet_router import looks_like_pet_tools

        async for line in _stream_via_agent(
            text,
            messages,
            tool_like=looks_like_pet_tools(text),
        ):
            yield line
        yield format_sse_event({"type": "done"})
        return

    if route == "tools":
        async for line in _stream_via_pet_tools(
            text=text,
            messages=messages,
            companion=companion,
            memory_context=mem_ctx,
            perception=perception_snapshot,
        ):
            yield line
        yield format_sse_event({"type": "done"})
        return

    yield format_sse_event({"type": "pet_action", "action": "thinking"})

    buffer = ""
    async for piece in _invoke_local_or_cloud(
        system=system,
        user_text=_messages_to_prompt(messages, text),
        route=route,
        streaming=True,
    ):
        buffer += piece
        yield format_sse_event({"type": "token", "content": piece})

    parsed = _parse_pet_json(buffer)
    yield format_sse_event({"type": "pet_response", **parsed})

    try:
        patch_companion_state({"pet": {"care_score_delta": 1}})
    except Exception as exc:
        logger.debug("care_score bump skipped: %s", exc)

    yield format_sse_event({"type": "done"})


def _prefetch_is_usable(text: str) -> bool:
    t = (text or "").strip()
    if len(t) < 25:
        return False
    lower = t.lower()
    if lower in {"no search results.", "error: empty query"}:
        return False
    if lower.startswith("no search results") or lower.startswith("no results were found"):
        return False
    if "bot filtering" in lower or "empty matches" in lower:
        return False
    return True


def _web_search_query_for_pet(text: str) -> str:
    """Expand short pet queries into search-friendly keywords."""
    t = (text or "").strip()
    if not t:
        return t
    if not looks_like_mandatory_web_lookup(t):
        return t
    city = ""
    m = re.search(r"([\u4e00-\u9fff]{2,8})(?:市|县|区)?(?=.*天气|.*气温|.*下雨)", t)
    if m:
        city = m.group(1)
    elif m := re.search(r"([\u4e00-\u9fff]{2,8})天气", t):
        city = m.group(1)
    if city:
        return f"{city} 今天 天气预报 气温"
    if "天气" in t or "气温" in t:
        return f"{t} 天气预报 气温"
    return t


def _extractive_prefetch_answer(
    user_input: str,
    web_prefetch: str,
    companion: Dict[str, Any],
) -> str:
    """Build a pet reply directly from search snippets (no LLM)."""
    from agents.pet_tools_agent import _looks_like_success

    name = (companion.get("pet") or {}).get("name") or (companion.get("persona") or {}).get("name") or "小光灵"
    lines = [ln.strip() for ln in re.split(r"[\n\r]+", web_prefetch) if ln.strip() and len(ln.strip()) > 6]
    scored: List[tuple[int, str]] = []
    for ln in lines:
        score = 0
        if _looks_like_success(ln):
            score += 3
        if "天气" in ln or "forecast" in ln.lower():
            score += 2
        for ch in re.findall(r"[\u4e00-\u9fff]{2,8}", user_input):
            if ch in ln:
                score += 2
                break
        if score > 0:
            scored.append((score, ln))
    scored.sort(key=lambda item: item[0], reverse=True)

    if scored:
        body = scored[0][1][:320]
        return f"主人，{body}"[:800]

    if _looks_like_success(web_prefetch) or "°" in web_prefetch or "℃" in web_prefetch:
        return f"主人，{web_prefetch.strip()}"[:800]

    compact = re.sub(r"\s+", " ", web_prefetch[:420]).strip()
    if len(compact) > 40:
        return f"主人，我搜到：{compact}"[:800]
    return ""


async def _synthesize_pet_answer_from_prefetch(
    *,
    user_input: str,
    web_prefetch: str,
    companion: Dict[str, Any],
) -> str:
    """Turn raw web search snippets into a short in-character pet reply."""
    from langchain_core.messages import HumanMessage, SystemMessage

    pet = companion.get("pet") or {}
    persona = companion.get("persona") or {}
    name = pet.get("name") or persona.get("name") or "小光灵"
    tone = persona.get("tone") or "温暖、简洁"

    system = (
        f"你是桌面宠物「{name}」，语气{tone}。"
        "根据下方联网检索结果回答主人，2-5 句中文。"
        "只给明确结论与实用建议；禁止说查不到、技术问题、无法获取；禁止 JSON 与工具名。"
    )
    user = f"主人问：{user_input.strip()}\n\n【联网检索结果】\n{web_prefetch[:5000]}"

    llm = get_chat_llm(temperature=0.35, streaming=False)
    resp = await llm.ainvoke([SystemMessage(content=system), HumanMessage(content=user)])
    text = str(getattr(resp, "content", "") or "").strip()
    return text[:800]


async def _stream_via_pet_tools(
    *,
    text: str,
    messages: List[Dict[str, str]],
    companion: Dict[str, Any],
    memory_context: str,
    perception: Optional[Dict[str, Any]],
) -> AsyncIterator[str]:
    """Tool-augmented pet path: web search, RAG, memory, MCP."""
    import asyncio

    from agents.pet_tools_agent import is_pet_failure_reply, stream_pet_tools_chat

    # Fast path: weather queries hit the structured weather API directly (≈1-2s,
    # reliable) instead of the slow/bot-filtered web search.
    from tools.weather_tools import fetch_weather_short_sync, looks_like_weather_query

    if looks_like_weather_query(text):
        yield format_sse_event(
            {"type": "tools_handoff", "message": "正在查天气…", "prefetch": True}
        )
        yield format_sse_event({"type": "pet_action", "action": "thinking"})
        weather_line = await asyncio.to_thread(fetch_weather_short_sync, text)
        if weather_line:
            yield format_sse_event(
                {
                    "type": "pet_response",
                    "action": "talking",
                    "text": f"主人，{weather_line}～",
                    "mood": "happy",
                    "tool_hint": "weather",
                }
            )
            try:
                patch_companion_state({"pet": {"care_score_delta": 1}, "growth_add_xp": 1})
            except Exception as exc:
                logger.debug("care_score bump skipped: %s", exc)
            return
        logger.info("[pet_tools] weather api empty, falling back to web search")

    web_prefetch = ""
    search_query = _web_search_query_for_pet(text)
    if looks_like_mandatory_web_lookup(text):
        try:
            from tools.web_search_tools import execute_web_search_sync

            region = "cn-zh" if any("\u4e00" <= c <= "\u9fff" for c in text) else ""
            web_prefetch = await asyncio.to_thread(execute_web_search_sync, search_query, 8, region)
            logger.info("[pet_tools] pre-search q=%r len=%d", search_query, len(web_prefetch))
            if not _prefetch_is_usable(web_prefetch):
                from tools.weather_tools import fetch_weather_short_sync

                weather_line = await asyncio.to_thread(fetch_weather_short_sync, text)
                if weather_line:
                    web_prefetch = weather_line
                    logger.info("[pet_tools] wttr fallback len=%d", len(web_prefetch))
        except Exception as exc:
            logger.warning("[pet_tools] pre-search failed: %s", exc)

    yield format_sse_event(
        {
            "type": "tools_handoff",
            "message": "正在用联网/知识库工具帮你查…",
            "prefetch": bool(web_prefetch.strip()),
        }
    )
    yield format_sse_event({"type": "pet_action", "action": "thinking"})

    final = ""
    if _prefetch_is_usable(web_prefetch) and looks_like_mandatory_web_lookup(text):
        extractive = _extractive_prefetch_answer(text, web_prefetch, companion)
        if extractive and not is_pet_failure_reply(extractive):
            logger.info("[pet_tools] extractive prefetch len=%d", len(extractive))
            yield format_sse_event(
                {
                    "type": "pet_response",
                    "action": "talking",
                    "text": extractive,
                    "mood": "happy",
                    "tool_hint": "tools",
                }
            )
            try:
                patch_companion_state({"pet": {"care_score_delta": 1}, "growth_add_xp": 1})
            except Exception as exc:
                logger.debug("care_score bump skipped: %s", exc)
            return

        try:
            final = await _synthesize_pet_answer_from_prefetch(
                user_input=text,
                web_prefetch=web_prefetch,
                companion=companion,
            )
            if final and not is_pet_failure_reply(final):
                logger.info("[pet_tools] prefetch synthesis len=%d", len(final))
                yield format_sse_event(
                    {
                        "type": "pet_response",
                        "action": "talking",
                        "text": final,
                        "mood": "happy",
                        "tool_hint": "tools",
                    }
                )
                try:
                    patch_companion_state({"pet": {"care_score_delta": 1}, "growth_add_xp": 1})
                except Exception as exc:
                    logger.debug("care_score bump skipped: %s", exc)
                return
        except Exception as exc:
            logger.warning("[pet_tools] prefetch synthesis failed: %s", exc)
            final = ""

    async for event in stream_pet_tools_chat(
        messages=messages,
        user_input=text,
        companion=companion,
        memory_context=memory_context,
        perception=perception,
        web_prefetch=web_prefetch,
    ):
        et = event.get("type")
        if et == "tool_start":
            yield format_sse_event(
                {"type": "pet_action", "action": "thinking", "tool": event.get("tool_name")}
            )
        elif et == "final":
            final = str(event.get("response") or final)

    if (not final or is_pet_failure_reply(final)) and _prefetch_is_usable(web_prefetch):
        extractive = _extractive_prefetch_answer(text, web_prefetch, companion)
        if extractive and not is_pet_failure_reply(extractive):
            final = extractive
            logger.info("[pet_tools] extractive fallback len=%d", len(final))
        else:
            try:
                synthesized = await _synthesize_pet_answer_from_prefetch(
                    user_input=text,
                    web_prefetch=web_prefetch,
                    companion=companion,
                )
                if synthesized and not is_pet_failure_reply(synthesized):
                    final = synthesized
                    logger.info("[pet_tools] fallback synthesis len=%d", len(final))
            except Exception as exc:
                logger.warning("[pet_tools] fallback synthesis failed: %s", exc)

    yield format_sse_event(
        {
            "type": "pet_response",
            "action": "talking",
            "text": (final or "查完了，但好像没有拿到结果～")[:800],
            "mood": "happy",
            "tool_hint": "tools",
        }
    )

    try:
        patch_companion_state({"pet": {"care_score_delta": 1}, "growth_add_xp": 1})
    except Exception as exc:
        logger.debug("care_score bump skipped: %s", exc)


def _extract_pet_media(text: str) -> List[Dict[str, str]]:
    """Pull generated image/video URLs from agent output → [{type,url}] for pet UI.

    URLs are normalized to filenames so the pet frontend can load them from the
    backend static mount (`/media/<file>`), avoiding the web app's /api/media proxy.
    """
    from utils.a2ui_media import build_a2ui_media_lines

    media: List[Dict[str, str]] = []
    seen: set[str] = set()
    for line in build_a2ui_media_lines(text or ""):
        # line: "A2UI_MEDIA:image:/api/media/<file>" or full https URL
        parts = line.split(":", 2)
        if len(parts) != 3:
            continue
        kind, url = parts[1], parts[2]
        if url.startswith("/api/media/"):
            url = "/media/" + url[len("/api/media/"):]
        if url in seen:
            continue
        seen.add(url)
        media.append({"type": kind, "url": url})
    return media


def _strip_media_noise(text: str) -> str:
    """Remove raw storage paths / success boilerplate so the bubble stays clean."""
    t = text or ""
    t = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", t)  # markdown images
    t = re.sub(r"A2UI_MEDIA:(?:image|video):\S+", "", t)
    t = re.sub(r"\*\*(?:本地路径|直接显示|URL|Model|供应商)[:：]\*\*[^\n]*", "", t)
    t = re.sub(r"https?://\S+\.(?:png|jpg|jpeg|webp|gif|mp4|webm|mov)\S*", "", t, flags=re.I)
    t = re.sub(r"\.?[/\\]?(?:[^\s\"'>]*[/\\])?storage[/\\]outputs[/\\]\S+", "", t, flags=re.I)
    t = re.sub(r"/media/\S+\.(?:png|jpg|jpeg|webp|gif|mp4|webm|mov)", "", t, flags=re.I)
    # Drop now-empty label lines, e.g. "本地路径:" / "URL：" / "直接显示:"
    t = re.sub(
        r"(?m)^[\-\*\s>]*\**\s*(?:本地路径|直接显示|预览|URL|链接|地址|文件|路径|Model|供应商)\s*[:：]\**\s*$",
        "",
        t,
    )
    t = re.sub(r"\n{3,}", "\n\n", t).strip()
    return t


async def _stream_via_agent(
    user_input: str,
    messages: List[Dict[str, str]],
    *,
    tool_like: bool = False,
) -> AsyncIterator[str]:
    from agents.chat_request import ChatMessage, ChatPreferences, ChatRequest
    from agents.chat_service import create_chat_trace, stream_agent_chat

    req = ChatRequest(
        messages=[ChatMessage(role=m.get("role", "user"), content=m.get("content", "")) for m in messages],
        input=user_input,
        mode="multi",
        graph_hint="auto",
        preferences=ChatPreferences(
            online_search_mode="smart",
            chat_knowledge_mode="smart",
            chat_memory_recall=True,
        ),
    )
    trace_id = create_chat_trace(req)
    api_key = get_api_key() or ""

    handoff_msg = (
        "正在用多 Agent 联网帮你查…"
        if tool_like
        else "复杂任务已交给多 Agent 协作（含 MCP 工具）"
    )
    yield format_sse_event(
        {
            "type": "agent_handoff",
            "trace_id": trace_id,
            "message": handoff_msg,
        }
    )
    yield format_sse_event({"type": "pet_action", "action": "thinking"})

    final = ""
    media_seen = ""
    _buf_cap = 65536
    async for event in stream_agent_chat(req, api_key=api_key, trace_id=trace_id):
        et = event.get("type")
        if et == "token":
            chunk = str(event.get("content") or "")
            final = (final + chunk)[-_buf_cap:]
            media_seen = (media_seen + chunk)[-_buf_cap:]
            yield format_sse_event({"type": "token", "content": chunk})
        elif et == "decision":
            nxt = str(event.get("next_agent") or "").strip()
            if nxt and nxt != "FINISH":
                yield format_sse_event(
                    {
                        "type": "agent_handoff",
                        "trace_id": trace_id,
                        "message": f"正在协调 {nxt}…",
                    }
                )
        elif et in ("agent_result", "final"):
            extra = "\n" + str(event.get("content") or "")
            if event.get("media_url"):
                extra += "\n" + str(event.get("media_url"))
            media_seen = (media_seen + extra)[-_buf_cap:]
            if et == "final":
                final = str(event.get("response") or final)

    media = _extract_pet_media(media_seen + "\n" + final)
    display_text = _strip_media_noise(final) if not final.strip().startswith("{") else final

    if final.strip().startswith("{"):
        parsed = _parse_pet_json(final)
    else:
        fallback = "图片已经生成好啦，主人看看喜欢吗～" if media else (display_text[:800] or "任务已完成～")
        parsed = {
            "action": "celebrate" if (media or len(display_text) > 20) else "talking",
            "text": display_text[:800] or fallback,
            "mood": "happy",
            "tool_hint": "agent",
        }
    if media:
        parsed.setdefault("text", "")
        if not parsed["text"].strip():
            parsed["text"] = "好啦，生成完成啦～"

    yield format_sse_event({"type": "pet_response", **parsed, "media": media})

    try:
        patch_companion_state({"pet": {"care_score_delta": 1}, "growth_add_xp": 2})
    except Exception:
        pass


def get_pet_status() -> Dict[str, Any]:
    companion = get_companion_state()
    pet = companion.get("pet") or {}
    return {
        "ollama_available": is_ollama_available(),
        "ollama_model": get_ollama_model(),
        "cloud_provider": get_provider_id(),
        "cloud_model": get_current_model(),
        "pet_stage": pet.get("stage") or pet_stage_from_care(int(pet.get("care_score") or 0)),
        "care_score": pet.get("care_score", 0),
    }


def get_wake_payload(source: str = "manual", *, include_dream: bool = True) -> Dict[str, Any]:
    """Build structured wake greeting for Boni desktop pet (tray / hotkey / startup)."""
    from datetime import datetime

    companion = get_companion_state()
    persona = companion.get("persona") or {}
    pet = companion.get("pet") or {}
    growth = companion.get("growth") or {}
    name = (pet.get("name") or persona.get("name") or "波尼").strip()
    title = str(growth.get("title") or "").strip()
    title_suffix = f"（{title}）" if title else ""

    wake_reason = "default"
    nudge_text: Optional[str] = None
    for fb in reversed(companion.get("recent_feedback") or []):
        if not isinstance(fb, dict):
            continue
        kind = str(fb.get("kind") or "")
        if kind in {"scheduler_nudge", "nudge"}:
            nudge_text = str(fb.get("text") or "").strip()
            if nudge_text:
                wake_reason = "scheduler"
                break

    dream_greeting: Optional[str] = None
    fast_sources = {"startup", "hotkey", "tray", "menu", "click"}
    src = (source or "manual").strip() or "manual"
    load_dream = include_dream and src not in fast_sources
    if not nudge_text and load_dream:
        try:
            from services.dream_store import get_dream_store

            digest = get_dream_store().load_digest("latest")
            if isinstance(digest, dict):
                dream_greeting = str(
                    digest.get("greeting") or digest.get("summary") or ""
                ).strip()
                if dream_greeting:
                    wake_reason = "dream"
        except Exception as exc:
            logger.debug("dream wake skipped: %s", exc)

    hour = datetime.now().hour
    if nudge_text:
        text = nudge_text[:220]
        action = "remind_drink" if any(k in text for k in ("休息", "喝水", "水", "睡")) else "cheer_up"
    elif dream_greeting:
        text = dream_greeting[:220]
        action = "cheer_up"
    elif hour < 12:
        text = f"早安，{name}{title_suffix}！波尼已醒来，今天也要加油呀～"
        action = "cheer_up"
        wake_reason = "morning"
    elif hour >= 22:
        text = f"夜深了，{name} 还在陪你{title_suffix}。"
        action = "idle"
        wake_reason = "night"
    else:
        text = f"嗨，我是{name}{title_suffix}，随时都可以聊～"
        action = "talking"

    mood = str((companion.get("mood") or {}).get("label") or "happy")
    if mood not in {"happy", "neutral", "sad", "excited"}:
        mood = "happy"

    return {
        "action": action if action in PET_ACTIONS else "cheer_up",
        "text": text,
        "mood": mood,
        "tool_hint": None,
        "source": src,
        "wake_reason": wake_reason,
        "companion": {
            "persona": persona,
            "pet": pet,
            "growth": growth,
            "mood": companion.get("mood") or {},
        },
    }


def get_pet_bootstrap(source: str = "startup", *, fast: bool = True) -> Dict[str, Any]:
    """One round-trip: companion snapshot + wake greeting."""
    companion = get_companion_state()
    wake = get_wake_payload(source, include_dream=not fast)
    return {
        "companion": companion,
        "wake": wake,
    }
