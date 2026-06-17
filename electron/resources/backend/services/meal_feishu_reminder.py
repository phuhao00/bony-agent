"""餐费 · 定时向飞书群发送上传表单链接"""
from __future__ import annotations

import logging
from datetime import date
from typing import Any, Optional

from services.meal_feishu_config import load_config, save_config

logger = logging.getLogger(__name__)

JOB_ID = "meal_feishu_group_reminder"


def public_upload_url() -> str:
    from utils.meal_public_url import meal_upload_page_url

    return meal_upload_page_url()


def build_reminder_post(extra: str = "") -> dict:
    """飞书 post 富文本（Markdown 链接在群里不渲染，须用 tag=a）。"""
    url = public_upload_url()
    today = date.today().strftime("%Y-%m-%d")
    rows: list[list[dict[str, str]]] = [
        [{"tag": "text", "text": f"🧾 每日餐费提醒（{today}）\n\n"}],
        [{"tag": "a", "text": "👉 点击上传餐费截图并填写信息", "href": url}],
        [
            {
                "tag": "text",
                "text": (
                    "\n\n操作步骤：\n"
                    "1. 点击上方蓝色链接\n"
                    "2. 填写姓名（与飞书一致）\n"
                    "3. 上传餐费截图，系统自动识别日期与金额\n\n"
                    f"链接（可复制到浏览器）：\n{url}\n\n"
                    "也可私聊机器人发截图，或发送「餐费记录」「餐费统计」。"
                ),
            }
        ],
    ]
    tail = (extra or "").strip()
    if tail:
        rows.append([{"tag": "text", "text": f"\n{tail}"}])
    return {"zh_cn": {"title": "每日餐费提醒", "content": rows}}


def build_reminder_message(extra: str = "") -> str:
    """纯文本备用（含明文 URL）。"""
    url = public_upload_url()
    today = date.today().strftime("%Y-%m-%d")
    lines = [
        f"🧾 每日餐费提醒（{today}）",
        "",
        "👉 请点击上传餐费截图并填写信息：",
        url,
        "",
        "操作步骤：",
        "1. 打开上方链接",
        "2. 填写姓名（与飞书一致）",
        "3. 上传餐费截图，系统自动识别日期与金额",
        "",
        "也可私聊机器人直接发截图，或发送「餐费记录」「餐费统计」查询。",
    ]
    tail = (extra or "").strip()
    if tail:
        lines.extend(["", tail])
    return "\n".join(lines)


def send_group_reminder(*, chat_id: str = "", extra: str = "") -> dict[str, Any]:
    """向配置的群（或指定 chat_id）发送提醒。"""
    cfg = load_config()
    cid = (chat_id or cfg.get("reminder_chat_id") or "").strip()
    if not cid:
        return {"ok": False, "error": "未配置群 chat_id（oc_xxx）"}
    if not cid.startswith("oc_"):
        return {"ok": False, "error": "chat_id 应以 oc_ 开头，可在飞书群设置或 lark-cli 群列表中获取"}

    from services.meal_feishu_config import is_configured

    if not is_configured():
        return {"ok": False, "error": "飞书应用未配置，请先在餐费页完成 lark-cli 连接"}

    extra_text = extra or cfg.get("reminder_extra_text") or ""
    post = build_reminder_post(extra_text)
    plain = build_reminder_message(extra_text)
    from services import meal_feishu_lark_cli as lc

    ok, detail = lc.send_chat_post(cid, post)
    if not ok:
        ok, detail = lc.send_chat_text(cid, plain)
    if ok:
        logger.info("[meal_reminder] 已发送群提醒 chat_id=%s", cid[:12])
        return {
            "ok": True,
            "chat_id": cid,
            "upload_url": public_upload_url(),
            "message": plain,
        }
    return {"ok": False, "error": detail, "upload_url": public_upload_url()}


def _cron_trigger(cfg: dict):
    from apscheduler.triggers.cron import CronTrigger

    hour = int(cfg.get("reminder_hour", 9))
    minute = int(cfg.get("reminder_minute", 0))
    days = (cfg.get("reminder_days") or "mon-fri").strip().lower()
    if days in ("daily", "everyday", "*", "all"):
        day_of_week = "*"
    else:
        day_of_week = days
    return CronTrigger(
        hour=hour,
        minute=minute,
        day_of_week=day_of_week,
        timezone="Asia/Shanghai",
    )


def refresh_reminder_schedule() -> dict[str, Any]:
    """根据配置注册/移除 APScheduler 任务（后端启动或保存配置时调用）。"""
    try:
        from services.scheduler import scheduler_service, _APSCHEDULER_AVAILABLE
    except ImportError:
        return {"ok": False, "error": "scheduler 不可用"}

    if not _APSCHEDULER_AVAILABLE or scheduler_service.scheduler is None:
        return {"ok": False, "error": "apscheduler 未安装"}

    sched = scheduler_service.scheduler
    try:
        sched.remove_job(JOB_ID)
    except Exception:
        pass

    cfg = load_config()
    if not cfg.get("reminder_enabled"):
        return {"ok": True, "scheduled": False, "reason": "reminder_disabled"}

    chat_id = (cfg.get("reminder_chat_id") or "").strip()
    if not chat_id:
        return {"ok": True, "scheduled": False, "reason": "no_chat_id"}

    def _job():
        try:
            send_group_reminder()
        except Exception as e:
            logger.exception("[meal_reminder] 定时任务失败: %s", e)

    trigger = _cron_trigger(cfg)
    sched.add_job(
        _job,
        trigger=trigger,
        id=JOB_ID,
        replace_existing=True,
        name="[餐费] 飞书群上传提醒",
    )
    logger.info(
        "[meal_reminder] 已注册定时任务 %s:%02d %s chat=%s…",
        cfg.get("reminder_hour", 9),
        int(cfg.get("reminder_minute", 0)),
        cfg.get("reminder_days", "mon-fri"),
        chat_id[:10],
    )
    return {
        "ok": True,
        "scheduled": True,
        "job_id": JOB_ID,
        "upload_url": public_upload_url(),
    }


def reminder_status() -> dict[str, Any]:
    cfg = load_config()
    next_run: Optional[str] = None
    try:
        from services.scheduler import scheduler_service

        if scheduler_service.scheduler:
            job = scheduler_service.scheduler.get_job(JOB_ID)
            if job and job.next_run_time:
                next_run = job.next_run_time.isoformat()
    except Exception:
        pass
    return {
        "enabled": bool(cfg.get("reminder_enabled")),
        "chat_id": cfg.get("reminder_chat_id", ""),
        "chat_name": cfg.get("reminder_chat_name", ""),
        "hour": int(cfg.get("reminder_hour", 9)),
        "minute": int(cfg.get("reminder_minute", 0)),
        "days": cfg.get("reminder_days", "mon-fri"),
        "extra_text": cfg.get("reminder_extra_text", ""),
        "upload_url": public_upload_url(),
        "next_run": next_run,
    }
