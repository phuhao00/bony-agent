"""HAR 抓包文件解析与桌面客户端网络缺陷分析。"""

from __future__ import annotations

import json
import re
from typing import Any, Optional
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from utils.logger import setup_logger

logger = setup_logger("tapd_har_analyze")

_HAR_EXTS = {".har"}
_SENSITIVE_HEADERS = {
    "authorization",
    "cookie",
    "set-cookie",
    "x-api-key",
    "x-auth-token",
    "x-access-token",
    "proxy-authorization",
}
_SENSITIVE_QUERY_KEYS = {
    "token",
    "access_token",
    "accesskey",
    "api_key",
    "apikey",
    "auth",
    "password",
    "secret",
    "session",
    "sessionid",
}
_VALID_PRIORITIES = {"urgent", "high", "medium", "low"}

_HAR_PROMPT = (
    "你是资深桌面客户端 QA，专门分析网络抓包（HAR）中的接口异常。"
    "场景：Electron/原生桌面软件的 HTTP/HTTPS 通信问题。"
    "只输出一个 JSON 对象，不要解释、不要 markdown 代码块。字段：\n"
    '- title: 简短缺陷标题（20字以内）\n'
    "- description: 完整缺陷描述，用中文，结构包含："
    "【问题概述】【复现步骤】【实际结果（含关键接口/状态码/响应摘要）】【期望结果】【网络证据】；"
    "步骤用有序列表；不可见的信息填「待补充」，不要编造\n"
    '- priority: 只能是 urgent、high、medium、low\n'
    "- confidence: 0~1 置信度\n"
    "priority 规则：5xx/连接失败/核心接口超时 → high 或 urgent；4xx 业务错误 → medium 或 high。"
)


def _parse_json(text: str) -> dict:
    if not text:
        return {}
    s = text.strip()
    s = re.sub(r"^```(?:json)?\s*", "", s)
    s = re.sub(r"\s*```$", "", s)
    try:
        return json.loads(s)
    except Exception:
        m = re.search(r"\{.*\}", s, re.DOTALL)
        if m:
            try:
                return json.loads(m.group(0))
            except Exception:
                return {}
    return {}


def _norm_priority(raw: Any) -> str:
    if not raw:
        return "medium"
    s = str(raw).strip().lower()
    if s in _VALID_PRIORITIES:
        return s
    mapping = {
        "紧急": "urgent",
        "高": "high",
        "中": "medium",
        "低": "low",
    }
    return mapping.get(s, "medium")


def is_har_file(filename: str, content_type: str, content: bytes) -> bool:
    ext = _har_ext(filename)
    if ext in _HAR_EXTS:
        return True
    ct = (content_type or "").lower()
    if ext == ".json" and "json" in ct:
        return _looks_like_har(content)
    return False


def _har_ext(filename: str) -> str:
    from pathlib import Path

    return Path(filename or "").suffix.lower()


def _looks_like_har(content: bytes) -> bool:
    try:
        text = content.decode("utf-8", errors="replace")
        data = json.loads(text)
        entries = data.get("log", {}).get("entries")
        return isinstance(entries, list)
    except Exception:
        return False


def parse_har_bytes(content: bytes) -> dict[str, Any]:
    try:
        text = content.decode("utf-8", errors="replace")
        data = json.loads(text)
    except json.JSONDecodeError as e:
        raise ValueError(f"HAR 不是合法 JSON：{e}") from e

    log = data.get("log")
    if not isinstance(log, dict):
        raise ValueError("HAR 格式无效：缺少 log 对象")
    entries = log.get("entries")
    if not isinstance(entries, list):
        raise ValueError("HAR 格式无效：缺少 log.entries 数组")
    return data


def _redact_url(url: str) -> str:
    try:
        parsed = urlparse(url)
        pairs = parse_qsl(parsed.query, keep_blank_values=True)
        redacted = []
        for k, v in pairs:
            if k.lower() in _SENSITIVE_QUERY_KEYS:
                redacted.append((k, "***"))
            else:
                redacted.append((k, v))
        new_query = urlencode(redacted)
        return urlunparse(parsed._replace(query=new_query))
    except Exception:
        return url


def _redact_headers(headers: list[dict] | None) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    for h in headers or []:
        if not isinstance(h, dict):
            continue
        name = str(h.get("name") or "")
        value = str(h.get("value") or "")
        if name.lower() in _SENSITIVE_HEADERS:
            value = "***"
        out.append({"name": name, "value": value})
    return out


def _snippet(text: str | None, limit: int) -> str:
    if not text:
        return ""
    s = text.strip()
    if len(s) <= limit:
        return s
    return s[:limit] + "…"


def _extract_entry_row(entry: dict) -> dict[str, Any]:
    req = entry.get("request") or {}
    resp = entry.get("response") or {}
    status = int(resp.get("status") or 0)
    time_ms = entry.get("time")
    try:
        time_ms = float(time_ms) if time_ms is not None else None
    except (TypeError, ValueError):
        time_ms = None

    req_content = req.get("postData") or {}
    req_body = req_content.get("text") if isinstance(req_content, dict) else ""

    resp_content = resp.get("content") or {}
    resp_body = resp_content.get("text") if isinstance(resp_content, dict) else ""
    resp_mime = resp_content.get("mimeType") if isinstance(resp_content, dict) else ""

    return {
        "startedDateTime": str(entry.get("startedDateTime") or ""),
        "method": str(req.get("method") or "GET").upper(),
        "url": _redact_url(str(req.get("url") or "")),
        "status": status,
        "statusText": str(resp.get("statusText") or ""),
        "time_ms": time_ms,
        "error": str(entry.get("_failureText") or resp.get("_failureText") or "").strip(),
        "req_headers": _redact_headers(req.get("headers")),
        "resp_headers": _redact_headers(resp.get("headers")),
        "req_body_snippet": _snippet(str(req_body or ""), 512),
        "resp_body_snippet": _snippet(str(resp_body or ""), 1024),
        "resp_mime": str(resp_mime or ""),
    }


def _select_entries(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not rows:
        return []

    errors = [
        r
        for r in rows
        if r.get("status", 0) >= 400 or r.get("status", 0) == 0 or r.get("error")
    ]
    slow = sorted(
        [r for r in rows if (r.get("time_ms") or 0) > 3000],
        key=lambda x: x.get("time_ms") or 0,
        reverse=True,
    )[:5]

    selected: list[dict[str, Any]] = []
    seen: set[str] = set()

    def add(row: dict[str, Any]) -> None:
        key = f"{row.get('method')}|{row.get('url')}|{row.get('status')}"
        if key in seen:
            return
        seen.add(key)
        selected.append(row)

    for r in errors:
        add(r)
    for r in slow:
        add(r)

    if not selected:
        selected = rows[-10:]

    return selected[:30]


def build_har_summary_text(har: dict[str, Any]) -> tuple[str, int, int]:
    """返回 (摘要文本, 总条目数, 异常条目数)。"""
    entries = har.get("log", {}).get("entries") or []
    rows = [_extract_entry_row(e) for e in entries if isinstance(e, dict)]
    total = len(rows)
    error_count = sum(
        1
        for r in rows
        if r.get("status", 0) >= 400 or r.get("status", 0) == 0 or r.get("error")
    )
    selected = _select_entries(rows)

    lines = [
        f"HAR 抓包摘要（共 {total} 条请求，异常 {error_count} 条，以下展示 {len(selected)} 条重点请求）：",
        "",
    ]
    for i, r in enumerate(selected, 1):
        lines.append(f"--- 请求 {i} ---")
        lines.append(f"时间: {r.get('startedDateTime') or '待补充'}")
        lines.append(f"{r.get('method')} {r.get('url')}")
        lines.append(f"状态: {r.get('status')} {r.get('statusText')}".strip())
        if r.get("time_ms") is not None:
            lines.append(f"耗时: {r.get('time_ms'):.0f} ms")
        if r.get("error"):
            lines.append(f"连接错误: {r.get('error')}")
        if r.get("req_body_snippet"):
            lines.append(f"请求体: {r.get('req_body_snippet')}")
        if r.get("resp_body_snippet"):
            lines.append(f"响应体: {r.get('resp_body_snippet')}")
        lines.append("")

    return "\n".join(lines).strip(), total, error_count


def _call_har_llm(summary: str, filename: str) -> dict[str, Any]:
    from langchain_core.messages import HumanMessage, SystemMessage
    from core.llm_provider import get_chat_llm, get_current_model

    if not summary.strip():
        return {"ok": False, "error": "HAR 文件中没有可分析的请求记录"}

    model = get_current_model()
    try:
        llm = get_chat_llm(temperature=0)
        resp = llm.invoke(
            [
                SystemMessage(content=_HAR_PROMPT),
                HumanMessage(
                    content=(
                        f"来源文件：{filename}\n\n"
                        f"以下是脱敏后的 HAR 网络摘要：\n\n{summary}"
                    )
                ),
            ]
        )
        raw = resp.content if hasattr(resp, "content") else str(resp)
        logger.info("[tapd] har model=%s raw=%s", model, repr(str(raw)[:120]))
        parsed = _parse_json(str(raw))
        if not parsed.get("title") and not parsed.get("description"):
            return {
                "ok": False,
                "error": "模型未能从 HAR 中解析出有效缺陷信息",
                "raw": str(raw),
                "model": model,
            }
        return {
            "ok": True,
            "title": str(parsed.get("title") or "网络接口异常").strip()[:120],
            "description": str(parsed.get("description") or "").strip(),
            "priority": _norm_priority(parsed.get("priority")),
            "confidence": parsed.get("confidence"),
            "model": model,
            "raw": str(raw),
        }
    except Exception as e:
        logger.error("har LLM analyze failed: %s", e, exc_info=True)
        return {"ok": False, "error": f"HAR 分析失败：{str(e)[:200]}"}


def analyze_har_bytes(content: bytes, filename: str = "capture.har") -> tuple[dict[str, Any], dict[str, Any]]:
    """
    分析 HAR 字节内容。

    Returns:
        (analysis_result, meta)  meta 含 entries / errors 统计
    """
    safe_name = filename or "capture.har"
    try:
        har = parse_har_bytes(content)
        summary, total, error_count = build_har_summary_text(har)
        result = _call_har_llm(summary, safe_name)
        meta = {
            "filename": safe_name,
            "kind": "har",
            "entries": total,
            "errors": error_count,
        }
        return result, meta
    except ValueError as e:
        return (
            {"ok": False, "error": str(e)},
            {"filename": safe_name, "kind": "har", "entries": 0, "errors": 0},
        )
