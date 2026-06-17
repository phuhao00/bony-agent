"""Customer-service chat engine — retrieval + streaming LLM."""

from __future__ import annotations

import json
from typing import Any, AsyncIterator, Dict, List, Optional

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from core.llm_provider import get_api_key, get_chat_llm, get_current_model, get_provider_id
from services.customer_service_retrieval import (
    build_context_block,
    estimate_confidence,
    retrieve_workspace_context_async,
)
from services.customer_service_store import append_session_message, get_session
from utils.logger import setup_logger
from utils.rag_manager import get_rag_manager

logger = setup_logger("customer_service_engine")

DEFAULT_SYSTEM_TEMPLATE = """你是专业、可靠的 AI 客服助手。

【服务场景】{name}
{domain_line}
{description_line}

【知识库参考】以下内容由系统从已导入的知识库检索，请优先依据它们回答；若无相关内容，请诚实说明并引导用户补充信息。
{context_block}

【回答规范】
1. 语气友好、简洁，使用与用户相同的语言
2. 不要编造价格、政策、联系方式或承诺
3. 可引用知识库要点，但不要逐字堆砌
4. 问题超出范围时，建议用户提供更多上下文或联系人工客服
{extra_prompt}"""


def _sse(event: str, data: Dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _build_system_prompt(workspace: Dict[str, Any], context_block: str) -> str:
    domain = (workspace.get("domain") or "").strip()
    desc = (workspace.get("description") or "").strip()
    custom = (workspace.get("system_prompt") or "").strip()
    return DEFAULT_SYSTEM_TEMPLATE.format(
        name=workspace.get("name") or "通用客服",
        domain_line=f"领域：{domain}" if domain else "",
        description_line=f"说明：{desc}" if desc else "",
        context_block=context_block,
        extra_prompt=f"\n【额外指令】\n{custom}" if custom else "",
    )


def _history_messages(session: Dict[str, Any], max_turns: int = 8) -> List:
    rows = list(session.get("messages") or [])
    recent = rows[-max_turns * 2 :]
    out = []
    for row in recent:
        role = row.get("role")
        content = (row.get("content") or "").strip()
        if not content:
            continue
        if role == "assistant":
            out.append(AIMessage(content=content))
        else:
            out.append(HumanMessage(content=content))
    return out


def _extract_direct_reply(snippets: List[Dict[str, Any]]) -> str:
    """FAQ 快速模式：优先 FAQ 答案，其次绑定文档正文片段。"""
    if not snippets:
        return "暂未在知识库中找到匹配答案，请补充游戏名或更具体的问题描述。"

    top = snippets[0]
    if top.get("kind") == "faq":
        answer = (top.get("answer") or "").strip()
        if answer:
            return answer

    text = (top.get("text") or "").strip()
    if text:
        if len(text) > 2400:
            return text[:2400].rstrip() + "\n\n…"
        return text

    return "暂未在知识库中找到匹配答案，请补充游戏名或更具体的问题描述。"


async def stream_customer_service_chat(
    *,
    workspace: Dict[str, Any],
    message: str,
    session_id: str = "",
    use_llm: bool = True,
) -> AsyncIterator[str]:
    workspace_id = workspace["id"]
    user_text = (message or "").strip()
    if not user_text:
        yield _sse("error", {"error": "消息不能为空"})
        yield _sse("done", {})
        return

    session = get_session(session_id) if session_id else {"session_id": "", "messages": []}
    sid = session.get("session_id") or session_id
    session = append_session_message(
        sid,
        workspace_id=workspace_id,
        role="user",
        content=user_text,
    )
    sid = session["session_id"]

    yield _sse("metadata", {"session_id": sid, "workspace_id": workspace_id})

    rag_manager = get_rag_manager(get_api_key() or None)
    snippets = await retrieve_workspace_context_async(workspace, user_text, rag_manager)
    context_block = build_context_block(snippets)
    confidence = estimate_confidence(snippets)

    if not use_llm:
        reply = _extract_direct_reply(snippets)
        append_session_message(
            sid,
            workspace_id=workspace_id,
            role="assistant",
            content=reply,
            metadata={
                "confidence": confidence,
                "retrieval_count": len(snippets),
                "source": snippets[0].get("kind") if snippets else "none",
            },
        )
        yield _sse("token", {"token": reply})
        yield _sse("reply_done", {})
        yield _sse("done", {
            "session_id": sid,
            "confidence": confidence,
            "conversation_len": len(get_session(sid).get("messages") or []),
        })
        return

    system_prompt = _build_system_prompt(workspace, context_block)
    lc_messages = [SystemMessage(content=system_prompt), *_history_messages(session)]

    if not get_api_key():
        fallback = _extract_direct_reply(snippets)
        if fallback.startswith("暂未在知识库"):
            fallback = "未配置 LLM API Key，请在设置中配置模型供应商后重试。"
        append_session_message(
            sid,
            workspace_id=workspace_id,
            role="assistant",
            content=fallback,
            metadata={"confidence": confidence, "retrieval_count": len(snippets)},
        )
        yield _sse("token", {"token": fallback})
        yield _sse("reply_done", {})
        yield _sse("done", {"session_id": sid, "confidence": confidence})
        return

    llm = get_chat_llm(
        temperature=float(workspace.get("temperature") or 0.35),
        streaming=True,
    )

    full = ""
    try:
        async for chunk in llm.astream(lc_messages):
            token = chunk.content if isinstance(chunk.content, str) else str(chunk.content or "")
            if not token:
                continue
            full += token
            yield _sse("token", {"token": token})
        if full.strip():
            yield _sse("reply_done", {})
    except Exception as exc:
        logger.error("CS stream failed: %s", exc, exc_info=True)
        yield _sse("error", {"error": str(exc)})
        if not full.strip():
            yield _sse("done", {"session_id": sid})
            return

    reply = full.strip() or "抱歉，暂时无法生成回复，请稍后再试。"
    append_session_message(
        sid,
        workspace_id=workspace_id,
        role="assistant",
        content=reply,
        metadata={
            "confidence": confidence,
            "retrieval_count": len(snippets),
            "model": get_current_model(),
            "provider": get_provider_id(),
        },
    )
    yield _sse("done", {
        "session_id": sid,
        "confidence": confidence,
        "conversation_len": len(get_session(sid).get("messages") or []),
    })
