"""飞书 · 运维指令与状态采集（通过 @机器人 / 私聊 文本触发）"""
from __future__ import annotations

import logging
import os
import shutil
import socket
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from services.meal_feishu_config import load_config

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).parent.parent.parent
_LOG_CANDIDATES = [
    PROJECT_ROOT / "logs" / "agent.log",
    PROJECT_ROOT / "backend" / "agent.log",
    PROJECT_ROOT / "agent.log",
]

_OPS_KW = {
    "运维",
    "运维帮助",
    "运维状态",
    "运维健康",
    "运维飞书",
    "运维餐费",
    "运维日志",
    "运维提醒",
    "运维通知",
    "运维对话",
    "运维部署",
    "运维确认",
    "运维解析",
    "运维Jenkins",
}


def _extract_ops_command(text: str) -> tuple[str, str]:
    text = (text or "").strip()
    if text in _OPS_KW:
        return text, ""
    if text.startswith("运维"):
        rest = text[2:].strip()
        if not rest:
            return "运维", ""
        parts = rest.split(None, 1)
        sub = parts[0]
        tail = parts[1].strip() if len(parts) > 1 else ""
        mapping = {
            "帮助": "运维帮助",
            "状态": "运维状态",
            "健康": "运维健康",
            "飞书": "运维飞书",
            "餐费": "运维餐费",
            "日志": "运维日志",
            "提醒": "运维提醒",
            "通知": "运维通知",
            "对话": "运维对话",
            "部署": "运维部署",
            "确认": "运维确认",
            "解析": "运维解析",
            "Jenkins": "运维Jenkins",
            "jenkins": "运维Jenkins",
        }
        return mapping.get(sub, f"运维{sub}"), tail
    return "", text


def is_ops_command(text: str) -> bool:
    cmd, _ = _extract_ops_command(text)
    return bool(cmd) or (text or "").strip().startswith("运维")


def ops_enabled() -> bool:
    return bool(load_config().get("ops_enabled", True))


def is_ops_allowed(
    sender_open_id: str,
    *,
    is_group: bool,
    at_bot: bool,
) -> bool:
    if not ops_enabled():
        return False
    oid = (sender_open_id or "").strip()
    admins = load_config().get("ops_admin_open_ids") or []
    if isinstance(admins, str):
        admins = [a.strip() for a in admins.split(",") if a.strip()]
    if admins:
        return oid in admins
    if is_group:
        return at_bot
    return bool(oid)


def _port_open(host: str, port: int, timeout: float = 0.8) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def _dir_size_mb(path: Path) -> Optional[float]:
    if not path.exists():
        return None
    total = 0
    try:
        for p in path.rglob("*"):
            if p.is_file():
                total += p.stat().st_size
    except OSError:
        return None
    return round(total / (1024 * 1024), 1)


def _tail_log_lines(max_lines: int = 25) -> tuple[str, str]:
    n = max(5, min(int(max_lines), 40))
    for path in _LOG_CANDIDATES:
        if not path.is_file():
            continue
        try:
            with path.open("r", encoding="utf-8", errors="replace") as f:
                lines = f.readlines()
            tail = "".join(lines[-n:]).strip()
            return str(path.relative_to(PROJECT_ROOT)), tail or "(空)"
        except Exception as e:
            return str(path.name), f"读取失败: {e}"
    return "", "未找到日志文件（logs/agent.log）"


def collect_ops_status() -> dict[str, Any]:
    """采集本机 Agent / 飞书 / 餐费相关运维快照。"""
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    cfg = load_config()
    out: dict[str, Any] = {"ok": True, "checked_at": now}

    # 进程端口
    backend_port = int(os.getenv("BACKEND_PORT", "8000") or 8000)
    web_port = int(os.getenv("WEB_PORT", "3000") or 3000)
    out["ports"] = {
        "backend": {"port": backend_port, "open": _port_open("127.0.0.1", backend_port)},
        "web": {"port": web_port, "open": _port_open("127.0.0.1", web_port)},
    }

    # 飞书连接
    try:
        from services import meal_feishu_ws as fws
        from services.meal_feishu_config import is_configured, uses_lark_cli
        from services import meal_feishu_lark_cli as lc

        out["feishu"] = {
            "configured": is_configured(),
            "use_lark_cli": uses_lark_cli(),
            "connection_mode": fws.connection_mode(),
            "ws_connected": fws.is_connected(),
            "ws_error": (fws.last_error() or "")[:300],
            "lark_cli_installed": lc.is_installed(),
            "lark_cli_ready": lc.lark_cli_app_ready() if lc.is_installed() else False,
        }
    except Exception as e:
        out["feishu"] = {"error": str(e)[:200]}

    # 餐费
    try:
        from routers import meal_receipt_router as meal

        meal.init_db()
        db_path = PROJECT_ROOT / "storage" / "meal" / "meal_receipts.db"
        out["meal"] = {
            "db_exists": db_path.is_file(),
            "db_mb": round(db_path.stat().st_size / (1024 * 1024), 2) if db_path.is_file() else 0,
            "record_count": len(meal.list_all(month="")),
            "reminder_enabled": bool(cfg.get("reminder_enabled")),
            "reminder_chat": (cfg.get("reminder_chat_name") or cfg.get("reminder_chat_id") or "")[:40],
            "reminder_chat_id": (cfg.get("reminder_chat_id") or "").strip(),
        }
    except Exception as e:
        out["meal"] = {"error": str(e)[:200]}

    # 定时提醒任务
    try:
        from services.meal_feishu_reminder import reminder_status

        job = reminder_status()
        out["reminder_job"] = {
            "id": "meal_feishu_group_reminder" if job.get("enabled") else "",
            "next_run": job.get("next_run"),
            "enabled": job.get("enabled"),
            "error": "",
        }
    except Exception as e:
        out["reminder_job"] = {"error": str(e)[:200]}

    # 磁盘
    storage = PROJECT_ROOT / "storage"
    out["storage_mb"] = {
        "storage": _dir_size_mb(storage),
        "meal_uploads": _dir_size_mb(storage / "uploads" / "meal"),
        "outputs": _dir_size_mb(storage / "outputs"),
    }

    du = shutil.disk_usage(PROJECT_ROOT)
    out["disk_free_gb"] = round(du.free / (1024**3), 1)

    try:
        from services.jenkins_service import get_jenkins_config, health_check

        jcfg = get_jenkins_config()
        h = health_check() if jcfg.get("enabled") else {"ok": False, "error": "未启用"}
        out["jenkins"] = {
            "configured": bool(jcfg.get("enabled")),
            "allowed_jobs": len(jcfg.get("allowed_jobs") or []),
            **h,
        }
    except Exception as e:
        out["jenkins"] = {"ok": False, "error": str(e)[:120], "configured": False}

    return out


def _fmt_bool(ok: bool) -> str:
    return "✅" if ok else "❌"


def format_ops_status_markdown(status: Optional[dict[str, Any]] = None) -> str:
    s = status or collect_ops_status()
    lines = [f"**🛠 运维快照** · {s.get('checked_at', '')}", ""]

    ports = s.get("ports") or {}
    be = ports.get("backend") or {}
    web = ports.get("web") or {}
    lines.append(
        f"**服务端口**  后端 {be.get('port')} {_fmt_bool(be.get('open'))} · "
        f"前端 {web.get('port')} {_fmt_bool(web.get('open'))}"
    )

    fei = s.get("feishu") or {}
    if fei.get("error"):
        lines.append(f"**飞书**  ❌ {fei['error']}")
    else:
        lines.append(
            f"**飞书**  配置 {_fmt_bool(fei.get('configured'))} · "
            f"连接 {_fmt_bool(fei.get('ws_connected'))} · "
            f"模式 {fei.get('connection_mode') or '—'}"
        )
        if fei.get("ws_error"):
            lines.append(f"  ⚠️ {fei['ws_error'][:180]}")

    meal = s.get("meal") or {}
    if meal.get("error"):
        lines.append(f"**餐费**  ❌ {meal['error']}")
    else:
        lines.append(
            f"**餐费**  记录 {meal.get('record_count', 0)} 条 · "
            f"库 {meal.get('db_mb', 0)} MB · "
            f"群提醒 {'开' if meal.get('reminder_enabled') else '关'}"
        )

    job = s.get("reminder_job") or {}
    if job.get("next_run"):
        lines.append(f"**定时提醒**  下次 {job.get('next_run')}")
    elif job.get("error"):
        lines.append(f"**定时提醒**  {job['error'][:120]}")

    free = s.get("disk_free_gb")
    stor = s.get("storage_mb") or {}
    lines.append(
        f"**磁盘**  剩余约 {free} GB · storage {stor.get('storage') or '—'} MB"
    )
    lines.extend(["", "发送 `运维帮助` 查看全部指令。"])
    return "\n".join(lines)


def _help_text() -> str:
    return (
        "🛠 **飞书运维指令**（群聊需 @机器人）\n\n"
        "• `运维状态` / `运维健康` — 服务、飞书、餐费、磁盘快照\n"
        "• `运维飞书` — 飞书连接与 lark-cli 状态\n"
        "• `运维餐费` — 餐费库与记录概况\n"
        "• `运维日志` [行数] — 最近日志（默认 20 行，最多 40）\n"
        "• `运维提醒` — 餐费群提醒定时任务\n"
        "• `运维通知` — 将状态摘要发到当前会话（群聊发群消息）\n\n"
        "**对话 → 部署指令（需确认后执行）**\n"
        "• `运维对话` [小时数] — 拉取当前群最近对话，AI 生成运维计划\n"
        "• `运维部署` <说明> — 按文字说明生成计划（如在群里：@机器人 运维部署 重启飞书并发状态）\n"
        "• `运维确认` <计划ID> — 执行上一步返回的计划（白名单动作，无任意 shell）\n"
        "• `运维 Jenkins` — 列出白名单 Jenkins Job 及最近构建\n\n"
        "**Jenkins 部署（需确认）**\n"
        "• 群里：`运维部署 触发 deploy-xxx 分支 main` → AI 计划 → `运维确认 <ID>`\n\n"
        "**自然语言自动构建（无需确认）**\n"
        "• 群里 @机器人：`帮我把 main 部署一下` / `构建 deploy-agent-backend`\n"
        "• 识别到部署意图后直接触发白名单 Jenkins Job（仅 `ops_admin_open_ids`）\n"
        "• 配置：`ops_auto_jenkins_build`、`ops_auto_jenkins_cooldown_sec` 见 feishu_config.json\n\n"
        "Web：**飞书工作台 → 运维** 可拉群聊、预览计划、Jenkins 面板触发构建。\n"
        "权限：在 `storage/meal/feishu_config.json` 配置 `ops_admin_open_ids` 可限制操作人。"
    )


def handle_ops_text(
    command: str,
    args: str,
    *,
    sender_open_id: str = "",
    chat_id: str = "",
    message_id: str = "",
) -> str:
    cmd = command or "运维"
    rest = (args or "").strip()

    if cmd in ("运维", "运维帮助"):
        return _help_text()

    if cmd in ("运维状态", "运维健康"):
        return format_ops_status_markdown()

    if cmd == "运维飞书":
        s = collect_ops_status()
        fei = s.get("feishu") or {}
        if fei.get("error"):
            return f"❌ 飞书：{fei['error']}"
        return (
            f"📡 **飞书接入**\n"
            f"已配置 {_fmt_bool(fei.get('configured'))} · lark-cli 模式 {_fmt_bool(fei.get('use_lark_cli'))}\n"
            f"lark-cli 已安装 {_fmt_bool(fei.get('lark_cli_installed'))} · "
            f"应用就绪 {_fmt_bool(fei.get('lark_cli_ready'))}\n"
            f"消息连接 {_fmt_bool(fei.get('ws_connected'))} · 模式 {fei.get('connection_mode') or '—'}\n"
            + (f"⚠️ {fei['ws_error'][:200]}" if fei.get("ws_error") else "")
        )

    if cmd == "运维餐费":
        s = collect_ops_status()
        m = s.get("meal") or {}
        if m.get("error"):
            return f"❌ 餐费：{m['error']}"
        return (
            f"🧾 **餐费模块**\n"
            f"记录 {m.get('record_count', 0)} 条 · 数据库 {m.get('db_mb', 0)} MB\n"
            f"群提醒 {'已开启' if m.get('reminder_enabled') else '未开启'}"
            + (f" · 群 {m.get('reminder_chat')}" if m.get("reminder_chat") else "")
        )

    if cmd == "运维日志":
        n = 20
        if rest:
            try:
                n = int(rest.split()[0])
            except ValueError:
                pass
        path, tail = _tail_log_lines(n)
        head = f"📋 **日志** `{path or '—'}` 最近 {n} 行\n\n"
        body = tail[-3500:] if len(tail) > 3500 else tail
        return head + f"```\n{body}\n```"

    if cmd == "运维提醒":
        s = collect_ops_status()
        job = s.get("reminder_job") or {}
        m = s.get("meal") or {}
        lines = ["⏰ **餐费群提醒**"]
        if m.get("reminder_enabled"):
            lines.append(f"已启用 · 目标群 {m.get('reminder_chat') or '未命名'}")
        else:
            lines.append("未启用（Web 餐费页可配置）")
        if job.get("id"):
            lines.append(f"任务 ID {job['id']}")
        if job.get("next_run"):
            lines.append(f"下次执行 {job['next_run']}")
        if job.get("error"):
            lines.append(f"⚠️ {job['error']}")
        return "\n".join(lines)

    if cmd == "运维通知":
        summary = format_ops_status_markdown()
        cid = (chat_id or "").strip()
        if cid.startswith("oc_"):
            from services import meal_feishu_lark_cli as lc

            plain = summary.replace("**", "")
            ok, detail = lc.send_chat_text(cid, plain[:4000])
            if ok:
                return "✅ 已向当前群发送运维摘要"
            return f"❌ 群消息发送失败：{detail[:200]}"
        if message_id:
            from services import meal_feishu_api as fs

            fs.reply_text(message_id, summary[:4000])
            return "✅ 已回复运维摘要"
        return summary

    if cmd in ("运维对话", "运维解析"):
        hours = 2.0
        if rest:
            try:
                hours = float(rest.split()[0])
            except ValueError:
                pass
        from services.feishu_ops_deploy import plan_from_context, format_plan_for_feishu

        r = plan_from_context(
            chat_id=chat_id,
            hours_back=hours,
            default_chat_id=chat_id,
        )
        if not r.get("ok"):
            return f"❌ {r.get('error', '生成计划失败')}"
        plan = {
            "plan_id": r.get("plan_id"),
            "summary": r.get("summary"),
            "confidence": r.get("confidence"),
            "actions": r.get("actions"),
        }
        extra = ""
        if r.get("pull_error"):
            extra = f"\n⚠️ 拉取部分失败: {r['pull_error'][:120]}"
        return format_plan_for_feishu(plan) + extra

    if cmd == "运维部署":
        from services.feishu_ops_deploy import plan_from_context, format_plan_for_feishu

        if not rest:
            return "用法：运维部署 重启飞书连接并推送状态到本群"
        r = plan_from_context(
            chat_id=chat_id,
            hours_back=2.0,
            instruction=rest,
            default_chat_id=chat_id,
        )
        if not r.get("ok"):
            return f"❌ {r.get('error', '生成计划失败')}"
        plan = {
            "plan_id": r.get("plan_id"),
            "summary": r.get("summary"),
            "confidence": r.get("confidence"),
            "actions": r.get("actions"),
        }
        return format_plan_for_feishu(plan)

    if cmd == "运维确认":
        pid = rest.split()[0] if rest else ""
        if not pid:
            return "用法：运维确认 <计划ID>（先 运维对话 或 运维部署 获取 ID）"
        from services.feishu_ops_deploy import execute_plan

        r = execute_plan(pid, sender_open_id=sender_open_id)
        if not r.get("ok"):
            return f"❌ {r.get('error', '执行失败')}"
        return str(r.get("message") or "已执行")[:4000]

    if cmd == "运维Jenkins":
        from services.jenkins_service import format_jobs_for_chat

        return format_jobs_for_chat()

    return _help_text()


def try_handle_ops_message(
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
    若文本为运维指令则处理并回复，返回 True。
    调用方应在餐费指令之前调用。
    """
    if not is_ops_command(text):
        return False
    if not is_ops_allowed(sender_open_id, is_group=is_group, at_bot=at_bot):
        from services import meal_feishu_api as fs

        fs.reply_text(message_id, "⛔ 无运维权限。请联系管理员在 feishu_config.json 配置 ops_admin_open_ids。")
        return True
    cmd, args = _extract_ops_command(text)
    if not cmd and text.strip().startswith("运维"):
        cmd, args = "运维", text.strip()[2:].strip()
    reply = handle_ops_text(
        cmd,
        args,
        sender_open_id=sender_open_id,
        chat_id=chat_id,
        message_id=message_id,
    )
    from services import meal_feishu_api as fs

    fs.reply_text(message_id, reply[:4000])
    logger.info("[feishu_ops] %s (%s) cmd=%s", sender_name, sender_open_id[:12], cmd)
    return True
