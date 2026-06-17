"""飞书群聊消息拉取（lark-cli im +chat-messages-list）"""
from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from services.meal_feishu_lark_cli import parse_json_blob, run_cli

_ANSI_RE = re.compile(r"\x1b\[[0-9;]*m")


def _message_body_plain(m: dict[str, Any]) -> str:
    body_wrap = m.get("body")
    c = m.get("content")
    if isinstance(body_wrap, dict) and isinstance(body_wrap.get("content"), str):
        c = body_wrap.get("content")
    if not isinstance(c, str):
        return json.dumps(c, ensure_ascii=False)[:2000] if c is not None else ""
    try:
        j = json.loads(c)
        if isinstance(j, dict):
            return str(j.get("text") or c).replace("\n", " ").strip()[:4000]
    except json.JSONDecodeError:
        pass
    return c.replace("\n", " ").strip()[:4000]


def _sender_label(m: dict[str, Any]) -> str:
    snd = m.get("sender")
    if isinstance(snd, dict):
        for key in ("sender_name", "name", "nickname", "en_name"):
            v = snd.get(key)
            if isinstance(v, str) and v.strip():
                return v.strip()
        sid = snd.get("id")
        if isinstance(sid, str) and sid.strip():
            return sid.strip()
    return str(m.get("sender_id") or "unknown")[:40]


def _messages_from_page(data: dict[str, Any]) -> list[dict[str, Any]]:
    nested = data.get("data")
    for key in ("messages", "items"):
        if isinstance(data.get(key), list):
            return [x for x in data[key] if isinstance(x, dict)]
        if isinstance(nested, dict) and isinstance(nested.get(key), list):
            return [x for x in nested[key] if isinstance(x, dict)]
    return []


def _page_meta(data: dict[str, Any]) -> tuple[bool, str]:
    nested = data.get("data") if isinstance(data.get("data"), dict) else {}
    has_more = data.get("has_more") is True or nested.get("has_more") is True
    token = str(data.get("page_token") or nested.get("page_token") or "").strip()
    return has_more, token


def message_to_line(m: dict[str, Any]) -> str:
    recalled = "（已撤回）" if m.get("deleted") else ""
    t = str(m.get("create_time") or "")
    return f"[{_sender_label(m)}] {t}{recalled}\n{_message_body_plain(m)}"


def filter_messages_by_keyword(
    messages: list[dict[str, Any]],
    keyword: str,
) -> list[dict[str, Any]]:
    k = (keyword or "").strip().lower()
    if not k:
        return messages
    out: list[dict[str, Any]] = []
    for m in messages:
        blob = json.dumps(m, ensure_ascii=False).lower()
        if k in blob or k in _message_body_plain(m).lower():
            out.append(m)
    return out


def list_chat_messages(
    chat_id: str,
    *,
    hours_back: float = 2.0,
    as_who: str = "bot",
    max_pages: int = 8,
    page_size: int = 50,
) -> tuple[list[dict[str, Any]], str]:
    """
    拉取群聊时间窗内消息（升序）。
    返回 (messages, error)。
    """
    cid = (chat_id or "").strip()
    if not cid.startswith("oc_"):
        return [], "chat_id 须为 oc_ 开头"

    end = datetime.now(timezone.utc)
    start = end - timedelta(hours=max(0.25, min(hours_back, 168.0)))
    start_iso = start.strftime("%Y-%m-%dT%H:%M:%SZ")
    end_iso = end.strftime("%Y-%m-%dT%H:%M:%SZ")
    who = "user" if as_who == "user" else "bot"

    merged: list[dict[str, Any]] = []
    page_token = ""
    for page in range(max(1, min(max_pages, 20))):
        args = [
            "im",
            "+chat-messages-list",
            "--as",
            who,
            "--chat-id",
            cid,
            "--start",
            start_iso,
            "--end",
            end_iso,
            "--sort",
            "asc",
            "--page-size",
            str(max(10, min(page_size, 50))),
            "--format",
            "json",
        ]
        if page_token:
            args.extend(["--page-token", page_token])
        code, out, err = run_cli(args, timeout=60)
        if code != 0:
            detail = (err or out or "拉取失败").strip()[:400]
            if merged:
                return merged, ""
            return [], detail
        parsed = parse_json_blob(_ANSI_RE.sub("", out))
        if not parsed:
            if merged:
                return merged, ""
            return [], "无法解析 lark-cli 返回的 JSON"
        chunk = _messages_from_page(parsed)
        merged.extend(chunk)
        has_more, page_token = _page_meta(parsed)
        if not has_more or not page_token:
            break
    return merged, ""


def build_chat_transcript(
    messages: list[dict[str, Any]],
    *,
    max_chars: int = 12000,
) -> str:
    lines = [message_to_line(m) for m in messages if _message_body_plain(m) or m.get("deleted")]
    text = "\n\n".join(lines)
    if len(text) > max_chars:
        text = "…(较早消息已截断)\n\n" + text[-max_chars:]
    return text
