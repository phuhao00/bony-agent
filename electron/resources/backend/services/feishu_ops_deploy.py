"""飞书对话 → 运维/部署指令计划（LLM 解析 + 白名单执行）"""
from __future__ import annotations

import json
import logging
import re
import time
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Optional

from services.feishu_chat_pull import (
    build_chat_transcript,
    filter_messages_by_keyword,
    list_chat_messages,
)
from services.meal_feishu_config import load_config

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).parent.parent.parent
_PLANS_PATH = PROJECT_ROOT / "storage" / "meal" / "feishu_ops_plans.json"
_PLAN_TTL_SEC = 3600

# 仅允许白名单动作，禁止任意 shell
ACTION_CATALOG: dict[str, dict[str, Any]] = {
    "status_snapshot": {
        "label": "采集运维快照",
        "risk": "low",
        "description": "检查端口、飞书连接、餐费库、磁盘",
    },
    "feishu_reconnect": {
        "label": "重连飞书消息",
        "risk": "medium",
        "description": "断开并重新启动飞书 WebSocket/lark-cli 订阅",
    },
    "feishu_disconnect": {
        "label": "断开飞书消息",
        "risk": "medium",
        "description": "停止飞书消息订阅",
    },
    "broadcast_status": {
        "label": "推送运维摘要到群",
        "risk": "low",
        "description": "向指定 oc_ 群发送运维状态文本",
        "params": {"chat_id": "oc_xxx"},
    },
    "meal_reminder_send": {
        "label": "发送餐费上传提醒",
        "risk": "low",
        "description": "向配置的提醒群发送餐费 H5 链接",
    },
    "tail_logs": {
        "label": "查看最近日志",
        "risk": "low",
        "description": "读取 agent 日志末尾",
        "params": {"lines": "20"},
    },
    "refresh_meal_reminder_job": {
        "label": "刷新餐费定时提醒",
        "risk": "low",
        "description": "重新注册 APScheduler 餐费提醒任务",
    },
    "jenkins_trigger_build": {
        "label": "触发 Jenkins 构建",
        "risk": "high",
        "description": "触发白名单内的 Jenkins Job（可带 build_params）",
        "params": {"job_name": "deploy-agent-backend", "build_params": {}},
    },
    "jenkins_build_status": {
        "label": "查询 Jenkins 构建状态",
        "risk": "low",
        "description": "查询白名单 Job 的最近或指定构建",
        "params": {"job_name": "deploy-agent-backend", "build_number": ""},
    },
}

_DEPLOY_PROMPT = """你是运维助手。根据「飞书群聊记录」和/或「用户指令」，输出要执行的运维动作计划。

只能使用以下 action（不可发明新 action）：
{action_list}

返回唯一一个 JSON 对象（不要 markdown）：
{{
  "summary": "一两句话说明从对话中理解到的运维诉求",
  "actions": [
    {{"action": "status_snapshot", "params": {{}}, "reason": "为何执行"}}
  ],
  "confidence": 0.0到1.0
}}

规则：
- 若对话里提到「重启飞书」「机器人没反应」「重连」，可安排 feishu_disconnect 再 feishu_reconnect（顺序执行）。
- 若提到「发提醒」「催交餐费」，用 meal_reminder_send。
- 若提到「看下日志」「报错」，用 tail_logs，params.lines 默认 25。
- 若提到「同步状态」「巡检」，用 status_snapshot；若要发到群里再加 broadcast_status（params.chat_id 用上下文里的 chat_id）。
- 若提到「部署」「发布」「上线」「Jenkins」「构建」「打测试包」，用 jenkins_trigger_build：params.job_name 必须是白名单 Job 名；分支等写在 build_params 对象里（键名与 Job 参数一致，如 BRANCH）。
- 若提到「看下 xxx 构建」「Jenkins 状态」，用 jenkins_build_status，params.job_name 填 Job 名。
- 白名单 Job 列表（仅可选用以下 job_name）：{jenkins_jobs}
- 拿不准时只返回 status_snapshot，confidence 低于 0.6。
- actions 最多 5 项。
"""


def _load_plans() -> dict[str, Any]:
    _PLANS_PATH.parent.mkdir(parents=True, exist_ok=True)
    if not _PLANS_PATH.is_file():
        return {"plans": {}}
    try:
        data = json.loads(_PLANS_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {"plans": {}}
    except Exception:
        return {"plans": {}}


def _save_plans(data: dict[str, Any]) -> None:
    _PLANS_PATH.parent.mkdir(parents=True, exist_ok=True)
    _PLANS_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _purge_expired(plans: dict[str, Any]) -> None:
    now = time.time()
    bucket = plans.get("plans")
    if not isinstance(bucket, dict):
        plans["plans"] = {}
        return
    for pid in list(bucket.keys()):
        ent = bucket.get(pid)
        if not isinstance(ent, dict):
            bucket.pop(pid, None)
            continue
        exp = float(ent.get("expires_at") or 0)
        if exp and exp < now:
            bucket.pop(pid, None)


def list_action_catalog() -> list[dict[str, Any]]:
    return [
        {"id": k, **v}
        for k, v in ACTION_CATALOG.items()
    ]


def _action_list_for_prompt() -> str:
    lines = []
    for aid, meta in ACTION_CATALOG.items():
        lines.append(f"- {aid}: {meta.get('label')} — {meta.get('description')}")
    return "\n".join(lines)


def _jenkins_jobs_for_prompt() -> str:
    try:
        from services.jenkins_service import get_allowed_job_defs

        defs = get_allowed_job_defs()
        if not defs:
            return "（未配置，勿使用 jenkins_* 动作）"
        parts = []
        for d in defs:
            name = d.get("name", "")
            label = d.get("label") or name
            params = d.get("parameters") or []
            pnames = [str(p.get("name")) for p in params if isinstance(p, dict) and p.get("name")]
            extra = f" 参数:{','.join(pnames)}" if pnames else ""
            parts.append(f"{name}({label}){extra}")
        return "; ".join(parts)
    except Exception:
        return "（读取失败）"


def _validate_jenkins_step(aid: str, params: dict[str, Any]) -> bool:
    from services.jenkins_service import is_job_allowed

    job = str(params.get("job_name") or "").strip()
    if not job:
        return False
    if not is_job_allowed(job):
        return False
    if aid == "jenkins_trigger_build":
        bp = params.get("build_params")
        if bp is not None and not isinstance(bp, dict):
            return False
    if aid == "jenkins_build_status":
        bn = params.get("build_number")
        if bn not in (None, "", 0, "0"):
            try:
                int(bn)
            except (TypeError, ValueError):
                return False
    return True


def _parse_llm_json(text: str) -> dict[str, Any]:
    s = (text or "").strip()
    s = re.sub(r"^```(?:json)?\s*", "", s)
    s = re.sub(r"\s*```$", "", s)
    import re as _re

    try:
        return json.loads(s)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", s, re.DOTALL)
        if m:
            return json.loads(m.group(0))
    return {}


def plan_from_context(
    *,
    chat_id: str = "",
    hours_back: float = 2.0,
    instruction: str = "",
    focus_keyword: str = "",
    default_chat_id: str = "",
    as_who: str = "bot",
) -> dict[str, Any]:
    """
    拉取对话 + LLM → 部署计划（待确认）。
    """
    transcript = ""
    pull_error = ""
    cid = (chat_id or default_chat_id or "").strip()

    if cid.startswith("oc_"):
        messages, pull_error = list_chat_messages(
            cid, hours_back=hours_back, as_who=as_who
        )
        if focus_keyword:
            messages = filter_messages_by_keyword(messages, focus_keyword)
        transcript = build_chat_transcript(messages)
        if not transcript and not pull_error:
            transcript = "(该时间窗内无文本消息)"

    user_instruction = (instruction or "").strip()
    if not transcript and not user_instruction:
        return {
            "ok": False,
            "error": pull_error or "需要群 chat_id 或文字指令（如：运维部署 重启飞书并通知群）",
        }

    ctx_parts = []
    if cid:
        ctx_parts.append(f"群 chat_id: {cid}")
    if user_instruction:
        ctx_parts.append(f"用户指令: {user_instruction}")
    if transcript:
        ctx_parts.append(f"群聊记录（最近约 {hours_back} 小时）:\n{transcript}")

    try:
        from langchain_core.messages import HumanMessage, SystemMessage
        from core.llm_provider import get_chat_llm

        llm = get_chat_llm(temperature=0.15, model=None)
        sys = _DEPLOY_PROMPT.format(
            action_list=_action_list_for_prompt(),
            jenkins_jobs=_jenkins_jobs_for_prompt(),
        )
        resp = llm.invoke(
            [
                SystemMessage(content=sys),
                HumanMessage(content="\n\n".join(ctx_parts)),
            ]
        )
        raw = resp.content if hasattr(resp, "content") else str(resp)
        parsed = _parse_llm_json(str(raw))
    except Exception as e:
        logger.exception("[feishu_ops_deploy] LLM failed")
        return {"ok": False, "error": f"LLM 解析失败: {str(e)[:200]}"}

    actions_in = parsed.get("actions") if isinstance(parsed.get("actions"), list) else []
    validated: list[dict[str, Any]] = []
    for row in actions_in:
        if not isinstance(row, dict):
            continue
        aid = str(row.get("action") or "").strip()
        if aid not in ACTION_CATALOG:
            continue
        params = row.get("params") if isinstance(row.get("params"), dict) else {}
        if aid.startswith("jenkins_") and not _validate_jenkins_step(aid, params):
            continue
        if aid == "broadcast_status" and not params.get("chat_id") and cid:
            params = {**params, "chat_id": cid}
        validated.append(
            {
                "action": aid,
                "params": params,
                "reason": str(row.get("reason") or "")[:300],
                "label": ACTION_CATALOG[aid].get("label"),
            }
        )

    if not validated:
        validated = [
            {
                "action": "status_snapshot",
                "params": {},
                "reason": "未能从对话解析出明确动作，默认巡检",
                "label": ACTION_CATALOG["status_snapshot"]["label"],
            }
        ]

    plan_id = uuid.uuid4().hex[:12]
    store = _load_plans()
    _purge_expired(store)
    store.setdefault("plans", {})[plan_id] = {
        "plan_id": plan_id,
        "created_at": datetime.now().isoformat(timespec="seconds"),
        "expires_at": time.time() + _PLAN_TTL_SEC,
        "chat_id": cid,
        "summary": str(parsed.get("summary") or "")[:500],
        "confidence": float(parsed.get("confidence") or 0.5),
        "actions": validated,
        "transcript_chars": len(transcript),
        "pull_error": pull_error,
    }
    _save_plans(store)

    return {
        "ok": True,
        "plan_id": plan_id,
        "summary": parsed.get("summary"),
        "confidence": parsed.get("confidence"),
        "actions": validated,
        "transcript_preview": transcript[:1500] if transcript else "",
        "pull_error": pull_error,
        "confirm_hint": f"确认执行请发送：运维确认 {plan_id}",
    }


def get_plan(plan_id: str) -> Optional[dict[str, Any]]:
    store = _load_plans()
    _purge_expired(store)
    ent = (store.get("plans") or {}).get((plan_id or "").strip())
    return ent if isinstance(ent, dict) else None


def format_plan_for_feishu(plan: dict[str, Any]) -> str:
    lines = [
        f"📋 **运维计划** `{plan.get('plan_id')}`",
        f"{plan.get('summary') or '—'}",
        f"置信度 {plan.get('confidence', '—')}",
        "",
        "**拟执行：**",
    ]
    for i, a in enumerate(plan.get("actions") or [], 1):
        lines.append(
            f"{i}. {a.get('label') or a.get('action')} — {a.get('reason') or ''}"
        )
    lines.append("")
    has_jenkins = any(
        (a.get("action") or "").startswith("jenkins_trigger")
        for a in (plan.get("actions") or [])
    )
    if has_jenkins:
        lines.append("⚠️ 本计划含 **Jenkins 构建触发**，请确认 Job 与参数无误。")
        lines.append("")
    lines.append(f"回复 **运维确认 {plan.get('plan_id')}** 执行（1 小时内有效）")
    return "\n".join(lines)


def _run_action(action: str, params: dict[str, Any]) -> str:
    if action == "status_snapshot":
        from services.feishu_ops import format_ops_status_markdown

        return format_ops_status_markdown()

    if action == "feishu_disconnect":
        from services import meal_feishu_ws as fws

        fws.stop()
        return "已断开飞书消息订阅"

    if action == "feishu_reconnect":
        from services import meal_feishu_ws as fws

        fws.stop()
        ok, msg = fws.start()
        return f"重连: {'成功' if ok else '失败'} — {msg[:200]}"

    if action == "broadcast_status":
        from services import meal_feishu_lark_cli as lc
        from services.feishu_ops import format_ops_status_markdown

        cid = str(params.get("chat_id") or "").strip()
        if not cid.startswith("oc_"):
            return "broadcast_status 缺少有效 chat_id"
        text = format_ops_status_markdown().replace("**", "")[:4000]
        ok, detail = lc.send_chat_text(cid, text)
        return f"推送群消息: {'成功' if ok else detail[:200]}"

    if action == "meal_reminder_send":
        from services.meal_feishu_reminder import send_group_reminder

        cid = str(params.get("chat_id") or "").strip()
        r = send_group_reminder(chat_id=cid or None)
        return f"餐费提醒: {'成功' if r.get('ok') else r.get('error', '失败')}"

    if action == "tail_logs":
        from services.feishu_ops import _tail_log_lines

        try:
            n = int(params.get("lines") or 25)
        except (TypeError, ValueError):
            n = 25
        path, tail = _tail_log_lines(n)
        return f"日志 `{path}`:\n```\n{tail[-2500:]}\n```"

    if action == "refresh_meal_reminder_job":
        from services.meal_feishu_reminder import refresh_reminder_schedule

        r = refresh_reminder_schedule()
        return f"刷新提醒任务: {'成功' if r.get('ok') else r.get('error', '失败')}"

    if action == "jenkins_trigger_build":
        from services.jenkins_service import format_trigger_result_for_chat, trigger_build

        job = str(params.get("job_name") or "").strip()
        bp = params.get("build_params") if isinstance(params.get("build_params"), dict) else {}
        r = trigger_build(job, bp, wait_for_start=True)
        return format_trigger_result_for_chat(r)

    if action == "jenkins_build_status":
        from services.jenkins_service import get_build_status

        job = str(params.get("job_name") or "").strip()
        bn = params.get("build_number")
        num: Optional[int] = None
        if bn not in (None, "", 0, "0"):
            try:
                num = int(bn)
            except (TypeError, ValueError):
                pass
        r = get_build_status(job, num)
        if not r.get("ok"):
            return f"Jenkins 状态: {r.get('error', '失败')}"
        res = r.get("result") or ("构建中" if r.get("building") else "—")
        return (
            f"Jenkins `{job}` #{r.get('number')} — {res}\n"
            f"链接: {r.get('url', '')}"
        )[:3500]

    return f"未知动作: {action}"


def execute_plan(
    plan_id: str,
    *,
    sender_open_id: str = "",
) -> dict[str, Any]:
    plan = get_plan(plan_id)
    if not plan:
        return {"ok": False, "error": "计划不存在或已过期，请重新 运维对话/运维部署 生成"}

    results: list[dict[str, str]] = []
    for step in plan.get("actions") or []:
        if not isinstance(step, dict):
            continue
        aid = str(step.get("action") or "")
        params = step.get("params") if isinstance(step.get("params"), dict) else {}
        try:
            out = _run_action(aid, params)
            results.append({"action": aid, "ok": "true", "detail": out[:3500]})
        except Exception as e:
            logger.exception("[feishu_ops_deploy] action %s failed", aid)
            results.append({"action": aid, "ok": "false", "detail": str(e)[:500]})

    # 执行后删除计划，防重放
    store = _load_plans()
    bucket = store.get("plans") or {}
    bucket.pop(plan_id, None)
    _save_plans(store)

    lines = [f"✅ 计划 `{plan_id}` 已执行", ""]
    for i, r in enumerate(results, 1):
        flag = "✓" if r.get("ok") == "true" else "✗"
        lines.append(f"{flag} {i}. {r.get('action')}: {str(r.get('detail') or '')[:800]}")
    return {
        "ok": True,
        "plan_id": plan_id,
        "results": results,
        "message": "\n".join(lines)[:4000],
    }
