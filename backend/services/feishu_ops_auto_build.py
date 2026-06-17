"""飞书群聊自然语言 → 自动触发 Jenkins 构建（白名单 Job，无运维确认）"""
from __future__ import annotations

import json
import logging
import re
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from services.feishu_chat_pull import build_chat_transcript, list_chat_messages
from services.feishu_ops_deploy import _jenkins_jobs_for_prompt, _parse_llm_json
from services.meal_feishu_config import load_config

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).parent.parent.parent
_LOG_PATH = PROJECT_ROOT / "storage" / "meal" / "feishu_ops_auto_build_log.json"
_MAX_LOG_ENTRIES = 80

_DEPLOY_KEYWORDS_RE = re.compile(
    r"部署|构建|发布|上线|jenkins|deploy|build|打.?包|发版|ci\b",
    re.IGNORECASE,
)
_CONTEXT_HINT_RE = re.compile(r"上面|刚才|这个|那句|同上|继续|按.*说|如前|那样")
_MEAL_OR_OPS_SKIP_RE = re.compile(r"^(餐费|运维)\b")

_AUTO_BUILD_PROMPT = """你是 Jenkins 部署意图识别器。根据用户当前消息与可选群聊上下文，判断是否要求**触发 Jenkins 构建**。

白名单 Job（job_name 只能从中选一个，不得发明新名字）：
{jenkins_jobs}

返回唯一 JSON（不要 markdown）：
{{
  "is_deploy_request": true或false,
  "job_name": "白名单中的 name 或空字符串",
  "build_params": {{ "BRANCH": "main" }},
  "confidence": 0.0到1.0,
  "summary": "一句话说明理解"
}}

规则：
- 仅当用户明确要部署/构建/发布/上线/打测试包时 is_deploy_request=true。
- 闲聊、餐费、日志、重启飞书、查询状态、问 Jenkins 进度 → false。
- 分支、环境等写入 build_params，键名与 Job 参数一致（如 BRANCH）。
- 未指定分支时，用 Job 默认分支（常见 main）。
- 无法确定 Job 时 is_deploy_request=false。
- 仅询问构建状态、不要触发 → false。
"""


def _auto_cfg() -> dict[str, Any]:
    c = load_config()
    return {
        "enabled": bool(c.get("ops_auto_jenkins_build", True)),
        "require_admin": bool(c.get("ops_auto_jenkins_require_admin", True)),
        "min_confidence": float(c.get("ops_auto_jenkins_min_confidence") or 0.65),
        "context_hours": float(c.get("ops_auto_jenkins_context_hours") or 1.0),
        "cooldown_sec": int(c.get("ops_auto_jenkins_cooldown_sec") or 90),
    }


def auto_build_enabled() -> bool:
    cfg = _auto_cfg()
    if not cfg["enabled"]:
        return False
    try:
        from services.jenkins_service import get_jenkins_config

        return bool(get_jenkins_config().get("enabled"))
    except Exception:
        return False


def _maybe_deploy_keywords(text: str) -> bool:
    t = (text or "").strip()
    if not t or _MEAL_OR_OPS_SKIP_RE.search(t):
        return False
    return bool(_DEPLOY_KEYWORDS_RE.search(t))


def _needs_chat_context(text: str) -> bool:
    t = (text or "").strip()
    if len(t) < 36:
        return True
    return bool(_CONTEXT_HINT_RE.search(t))


def is_auto_build_allowed(
    sender_open_id: str,
    *,
    is_group: bool,
    at_bot: bool,
) -> tuple[bool, str]:
    """返回 (allowed, reason)。"""
    from services.feishu_ops import ops_enabled

    if not ops_enabled():
        return False, "运维功能未启用"
    if not auto_build_enabled():
        return False, "自动 Jenkins 构建未启用或未配置 Jenkins"

    cfg = _auto_cfg()
    oid = (sender_open_id or "").strip()
    admins = load_config().get("ops_admin_open_ids") or []
    if isinstance(admins, str):
        admins = [a.strip() for a in admins.split(",") if a.strip()]

    if cfg["require_admin"]:
        if not admins:
            return (
                False,
                "请在 feishu_config.json 配置 ops_admin_open_ids 以使用自动构建",
            )
        if oid not in admins:
            return False, "无自动构建权限（需列入 ops_admin_open_ids）"

    if is_group and not at_bot:
        return False, "群聊需 @机器人"

    return True, ""


def _load_log() -> dict[str, Any]:
    _LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    if not _LOG_PATH.is_file():
        return {"entries": [], "last_trigger_by_chat": {}}
    try:
        data = json.loads(_LOG_PATH.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            return data
    except Exception:
        pass
    return {"entries": [], "last_trigger_by_chat": {}}


def _save_log(data: dict[str, Any]) -> None:
    _LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    _LOG_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _check_cooldown(chat_id: str) -> Optional[str]:
    cfg = _auto_cfg()
    sec = cfg["cooldown_sec"]
    if sec <= 0:
        return None
    cid = (chat_id or "dm").strip() or "dm"
    store = _load_log()
    bucket = store.get("last_trigger_by_chat")
    if not isinstance(bucket, dict):
        return None
    last = float(bucket.get(cid) or 0)
    if last and time.time() - last < sec:
        wait = int(sec - (time.time() - last)) + 1
        return f"本群 {wait}s 内已触发过构建，请稍后再试"
    return None


def _set_cooldown(chat_id: str) -> None:
    cid = (chat_id or "dm").strip() or "dm"
    store = _load_log()
    bucket = store.setdefault("last_trigger_by_chat", {})
    if isinstance(bucket, dict):
        bucket[cid] = time.time()
    _save_log(store)


def _append_audit(
    *,
    sender_open_id: str,
    chat_id: str,
    job_name: str,
    build_params: dict[str, Any],
    build_number: Optional[int],
    ok: bool,
    detail: str,
) -> None:
    store = _load_log()
    entries = store.setdefault("entries", [])
    if not isinstance(entries, list):
        entries = []
        store["entries"] = entries
    entries.append(
        {
            "at": datetime.now().isoformat(timespec="seconds"),
            "sender_open_id": sender_open_id[:24],
            "chat_id": (chat_id or "")[:32],
            "job_name": job_name,
            "build_params": build_params,
            "build_number": build_number,
            "ok": ok,
            "detail": (detail or "")[:500],
        }
    )
    store["entries"] = entries[-_MAX_LOG_ENTRIES:]
    _save_log(store)


def _parse_deploy_intent_llm(
    text: str,
    transcript: str,
    *,
    chat_id: str = "",
) -> dict[str, Any]:
    try:
        from langchain_core.messages import HumanMessage, SystemMessage
        from core.llm_provider import get_chat_llm

        llm = get_chat_llm(temperature=0.1, model=None)
        sys = _AUTO_BUILD_PROMPT.format(jenkins_jobs=_jenkins_jobs_for_prompt())
        parts = [f"用户消息: {text}"]
        if chat_id:
            parts.append(f"群 chat_id: {chat_id}")
        if transcript:
            parts.append(f"近期群聊:\n{transcript}")
        resp = llm.invoke(
            [SystemMessage(content=sys), HumanMessage(content="\n\n".join(parts))]
        )
        raw = resp.content if hasattr(resp, "content") else str(resp)
        parsed = _parse_llm_json(str(raw))
        if isinstance(parsed, dict):
            return parsed
    except Exception as e:
        logger.exception("[feishu_ops_auto_build] LLM failed")
        return {"is_deploy_request": False, "error": str(e)[:200]}
    return {"is_deploy_request": False}


def _fetch_transcript(chat_id: str, hours: float) -> str:
    cid = (chat_id or "").strip()
    if not cid.startswith("oc_"):
        return ""
    messages, err = list_chat_messages(cid, hours_back=hours, as_who="bot")
    if err:
        logger.warning("[feishu_ops_auto_build] pull chat: %s", err[:120])
    t = build_chat_transcript(messages)
    return t[:8000] if t else ""


def _execute_trigger(
    job_name: str,
    build_params: dict[str, Any],
    *,
    sender_open_id: str,
    chat_id: str,
) -> str:
    from services.jenkins_service import format_trigger_result_for_chat, trigger_build

    job = (job_name or "").strip()
    if not job:
        return "❌ 未识别到 Jenkins Job 名称"

    bp = build_params if isinstance(build_params, dict) else {}
    r = trigger_build(job, bp, wait_for_start=True)
    msg = format_trigger_result_for_chat(r)
    _append_audit(
        sender_open_id=sender_open_id,
        chat_id=chat_id,
        job_name=job,
        build_params=bp,
        build_number=r.get("build_number") if isinstance(r.get("build_number"), int) else None,
        ok=bool(r.get("ok")),
        detail=msg[:500],
    )
    if r.get("ok"):
        _set_cooldown(chat_id)
    return msg


def try_auto_jenkins_from_chat(
    text: str,
    *,
    sender_open_id: str,
    sender_name: str,
    chat_id: str,
    message_id: str,
    is_group: bool,
    at_bot: bool,
) -> bool:
    """
    自然语言部署意图 → 直接触发 Jenkins。已处理并回复时返回 True。
    """
    from services import meal_feishu_api as fs
    from services.feishu_ops import is_ops_command

    t = (text or "").strip()
    if not t or is_ops_command(t):
        return False
    if not _maybe_deploy_keywords(t):
        return False

    allowed, reason = is_auto_build_allowed(
        sender_open_id, is_group=is_group, at_bot=at_bot
    )
    if not allowed:
        fs.reply_text(message_id, f"⛔ {reason}"[:4000])
        logger.info(
            "[feishu_ops_auto_build] denied %s: %s",
            sender_name,
            reason,
        )
        return True

    cool = _check_cooldown(chat_id)
    if cool:
        fs.reply_text(message_id, f"⏳ {cool}")
        return True

    cfg = _auto_cfg()
    transcript = ""
    if is_group and _needs_chat_context(t):
        transcript = _fetch_transcript(chat_id, cfg["context_hours"])

    parsed = _parse_deploy_intent_llm(t, transcript, chat_id=chat_id)
    if parsed.get("error"):
        fs.reply_text(message_id, f"❌ 解析失败: {parsed['error']}"[:4000])
        return True

    if not parsed.get("is_deploy_request"):
        return False

    try:
        confidence = float(parsed.get("confidence") or 0)
    except (TypeError, ValueError):
        confidence = 0.0
    if confidence < cfg["min_confidence"]:
        fs.reply_text(
            message_id,
            f"🤔 部署意图不够明确（置信度 {confidence:.2f}），请说明 Job 与分支，例如：部署 deploy-agent-backend 分支 main",
        )
        return True

    job_name = str(parsed.get("job_name") or "").strip()
    bp = parsed.get("build_params") if isinstance(parsed.get("build_params"), dict) else {}
    summary = str(parsed.get("summary") or "").strip()

    from services.jenkins_service import is_job_allowed

    if not job_name or not is_job_allowed(job_name):
        fs.reply_text(
            message_id,
            f"❌ Job `{job_name or '—'}` 不在白名单，请指定允许的流水线名称",
        )
        return True

    head = f"🚀 {summary}\n\n" if summary else "🚀 正在触发 Jenkins 构建…\n\n"
    reply = _execute_trigger(
        job_name,
        bp,
        sender_open_id=sender_open_id,
        chat_id=chat_id,
    )
    fs.reply_text(message_id, (head + reply)[:4000])
    logger.info(
        "[feishu_ops_auto_build] %s triggered %s params=%s",
        sender_name,
        job_name,
        bp,
    )
    return True
