"""飞书投票：模版化创建、交互卡片发送、结果统计。"""
from __future__ import annotations

import json
import logging
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).parent.parent.parent
VOTES_DIR = PROJECT_ROOT / "storage" / "feishu_votes"

VOTE_ACTION = "feishu_vote"


def _now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def _plain(text: str) -> dict:
    return {"tag": "plain_text", "content": text}


def _md(text: str) -> dict:
    # JSON 2.0 卡片 body 仅支持 tag=markdown，lark_md 会报 200621
    return {"tag": "markdown", "content": text}


def _callback_btn(label: str, value: dict, btn_type: str = "default") -> dict:
    return {
        "tag": "button",
        "text": _plain(label),
        "type": btn_type,
        "size": "medium",
        "width": "fill",
        "behaviors": [{"type": "callback", "value": value}],
    }


def _divider() -> dict:
    return {"tag": "hr"}


def _caption(text: str) -> dict:
    """JSON 2.0 已废弃 note，用 markdown 展示辅助说明。"""
    return {"tag": "markdown", "content": f"*{text}*"}


def _header(title: str, template: str = "blue", subtitle: str = "") -> dict:
    h: dict[str, Any] = {"title": _plain(title), "template": template}
    if subtitle:
        h["subtitle"] = _plain(subtitle)
    return h


def _wrap(header_dict: dict, *body_elements) -> dict:
    return {
        "schema": "2.0",
        "config": {
            "update_multi": True,
            "style": {
                "text_size": {
                    "normal_v2": {"default": "normal", "pc": "normal", "mobile": "normal"}
                }
            },
        },
        "header": header_dict,
        "body": {"direction": "vertical", "elements": list(body_elements)},
    }


VOTE_TEMPLATES: list[dict[str, Any]] = [
    {
        "id": "yes_no",
        "name": "是否同意",
        "emoji": "✅",
        "description": "二元表决，适合方案确认、政策投票",
        "mode": "single",
        "anonymous": False,
        "options": [
            {"id": "yes", "label": "同意"},
            {"id": "no", "label": "反对"},
            {"id": "abstain", "label": "弃权"},
        ],
    },
    {
        "id": "single_choice",
        "name": "单选投票",
        "emoji": "📋",
        "description": "从多个选项中选一项，每人一票",
        "mode": "single",
        "anonymous": False,
        "options": [
            {"id": "a", "label": "选项 A"},
            {"id": "b", "label": "选项 B"},
            {"id": "c", "label": "选项 C"},
        ],
    },
    {
        "id": "multi_choice",
        "name": "多选投票",
        "emoji": "☑️",
        "description": "可选多项，适合兴趣调研、技能收集",
        "mode": "multi",
        "anonymous": False,
        "max_choices": 3,
        "options": [
            {"id": "opt1", "label": "选项 1"},
            {"id": "opt2", "label": "选项 2"},
            {"id": "opt3", "label": "选项 3"},
            {"id": "opt4", "label": "选项 4"},
        ],
    },
    {
        "id": "rating",
        "name": "满意度评分",
        "emoji": "⭐",
        "description": "1-5 分评分，适合活动/会议反馈",
        "mode": "single",
        "anonymous": True,
        "options": [
            {"id": "5", "label": "⭐⭐⭐⭐⭐ 非常满意"},
            {"id": "4", "label": "⭐⭐⭐⭐ 满意"},
            {"id": "3", "label": "⭐⭐⭐ 一般"},
            {"id": "2", "label": "⭐⭐ 不满意"},
            {"id": "1", "label": "⭐ 非常不满意"},
        ],
    },
    {
        "id": "lunch",
        "name": "午餐地点",
        "emoji": "🍱",
        "description": "团队午餐选址，快速统计偏好",
        "mode": "single",
        "anonymous": False,
        "options": [
            {"id": "cn", "label": "中式快餐"},
            {"id": "jp", "label": "日料"},
            {"id": "west", "label": "西餐"},
            {"id": "bbq", "label": "烧烤火锅"},
        ],
    },
    {
        "id": "meeting_time",
        "name": "会议时间",
        "emoji": "📅",
        "description": "协调会议时段，找出最多人空闲的时间",
        "mode": "multi",
        "anonymous": False,
        "max_choices": 2,
        "options": [
            {"id": "mon_am", "label": "周一上午"},
            {"id": "mon_pm", "label": "周一下午"},
            {"id": "tue_am", "label": "周二上午"},
            {"id": "tue_pm", "label": "周二下午"},
            {"id": "wed_am", "label": "周三上午"},
        ],
    },
    {
        "id": "team_building",
        "name": "团建活动",
        "emoji": "🎉",
        "description": "团建方案票选，支持附加说明",
        "mode": "single",
        "anonymous": False,
        "options": [
            {"id": "outdoor", "label": "户外拓展"},
            {"id": "dinner", "label": "聚餐 K 歌"},
            {"id": "escape", "label": "密室逃脱"},
            {"id": "board", "label": "桌游派对"},
        ],
    },
]


def list_templates() -> list[dict[str, Any]]:
    return [dict(t) for t in VOTE_TEMPLATES]


def get_template(template_id: str) -> Optional[dict[str, Any]]:
    for t in VOTE_TEMPLATES:
        if t["id"] == template_id:
            return dict(t)
    return None


def _poll_path(poll_id: str) -> Path:
    return VOTES_DIR / f"{poll_id}.json"


def _ensure_dir() -> None:
    VOTES_DIR.mkdir(parents=True, exist_ok=True)


def _load_poll(poll_id: str) -> Optional[dict[str, Any]]:
    path = _poll_path(poll_id)
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        logger.exception("[vote] load poll %s failed", poll_id)
        return None


def _save_poll(poll: dict[str, Any]) -> None:
    _ensure_dir()
    poll_id = poll["id"]
    _poll_path(poll_id).write_text(
        json.dumps(poll, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def list_polls(limit: int = 50) -> list[dict[str, Any]]:
    _ensure_dir()
    polls: list[dict[str, Any]] = []
    for path in sorted(VOTES_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            poll = json.loads(path.read_text(encoding="utf-8"))
            polls.append(_poll_summary(poll))
        except Exception:
            continue
        if len(polls) >= limit:
            break
    return polls


def _poll_summary(poll: dict[str, Any]) -> dict[str, Any]:
    stats = compute_stats(poll)
    return {
        "id": poll.get("id"),
        "title": poll.get("title"),
        "template_id": poll.get("template_id"),
        "status": poll.get("status", "draft"),
        "mode": poll.get("mode"),
        "anonymous": poll.get("anonymous", False),
        "chat_id": poll.get("chat_id"),
        "chat_name": poll.get("chat_name"),
        "created_at": poll.get("created_at"),
        "sent_at": poll.get("sent_at"),
        "closed_at": poll.get("closed_at"),
        "total_voters": stats["total_voters"],
        "total_votes": stats["total_votes"],
        "message_id": poll.get("message_id"),
    }


def create_poll(body: dict[str, Any]) -> dict[str, Any]:
    template_id = str(body.get("template_id") or "single_choice").strip()
    template = get_template(template_id)
    if not template:
        return {"ok": False, "error": f"未知模版: {template_id}"}

    title = str(body.get("title") or "").strip()
    if not title:
        return {"ok": False, "error": "请填写投票标题"}

    description = str(body.get("description") or "").strip()
    chat_id = str(body.get("chat_id") or "").strip()
    chat_name = str(body.get("chat_name") or "").strip()

    raw_options = body.get("options")
    if isinstance(raw_options, list) and raw_options:
        options = []
        for i, opt in enumerate(raw_options):
            if isinstance(opt, dict):
                oid = str(opt.get("id") or f"opt{i+1}").strip()
                label = str(opt.get("label") or "").strip()
            else:
                oid = f"opt{i+1}"
                label = str(opt).strip()
            if label:
                options.append({"id": oid, "label": label})
        if not options:
            return {"ok": False, "error": "至少需要一个投票选项"}
    else:
        options = [dict(o) for o in template.get("options", [])]

    poll_id = str(body.get("id") or uuid.uuid4())
    poll = {
        "id": poll_id,
        "title": title,
        "description": description,
        "template_id": template_id,
        "mode": str(body.get("mode") or template.get("mode") or "single"),
        "anonymous": bool(body.get("anonymous", template.get("anonymous", False))),
        "max_choices": int(body.get("max_choices") or template.get("max_choices") or 1),
        "options": options,
        "chat_id": chat_id,
        "chat_name": chat_name,
        "status": "draft",
        "message_id": "",
        "created_at": _now_iso(),
        "sent_at": None,
        "closed_at": None,
        "deadline": str(body.get("deadline") or "").strip() or None,
        "votes": [],
        "created_by": str(body.get("created_by") or "").strip(),
    }
    _save_poll(poll)
    return {"ok": True, "poll": _poll_summary(poll), "poll_full": poll}


def get_poll(poll_id: str, *, include_votes: bool = False) -> dict[str, Any]:
    poll = _load_poll(poll_id)
    if not poll:
        return {"ok": False, "error": "投票不存在"}
    result: dict[str, Any] = {"ok": True, "poll": _poll_summary(poll)}
    if include_votes:
        result["poll_full"] = poll
    return result


def compute_stats(poll: dict[str, Any]) -> dict[str, Any]:
    votes: list[dict] = poll.get("votes") or []
    options: list[dict] = poll.get("options") or []
    option_counts = {o["id"]: 0 for o in options}
    voter_ids: set[str] = set()

    for v in votes:
        oid = v.get("option_id")
        if oid in option_counts:
            option_counts[oid] += 1
        uid = v.get("voter_id") or ""
        if uid:
            voter_ids.add(uid)

    total_votes = sum(option_counts.values())
    rows = []
    for opt in options:
        oid = opt["id"]
        count = option_counts.get(oid, 0)
        pct = round(count / total_votes * 100, 1) if total_votes else 0.0
        rows.append(
            {
                "option_id": oid,
                "label": opt.get("label", oid),
                "count": count,
                "percent": pct,
            }
        )
    rows.sort(key=lambda r: r["count"], reverse=True)

    leader = rows[0] if rows and rows[0]["count"] > 0 else None
    return {
        "total_voters": len(voter_ids),
        "total_votes": total_votes,
        "by_option": rows,
        "leader": leader,
        "participation_hint": _participation_hint(poll, len(voter_ids)),
    }


def _participation_hint(poll: dict[str, Any], voters: int) -> str:
    if poll.get("status") == "closed":
        return "投票已结束"
    if voters == 0:
        return "等待首位参与者"
    if voters < 5:
        return "参与人数较少，可提醒群成员"
    return "参与活跃"


def build_stats_markdown(poll: dict[str, Any], stats: dict[str, Any]) -> str:
    lines = ["**实时统计**"]
    for row in stats.get("by_option") or []:
        bar_len = min(20, int(row["percent"] / 5))
        bar = "█" * bar_len + "░" * (20 - bar_len)
        lines.append(
            f"- {row['label']}: **{row['count']}** 票 ({row['percent']}%) `{bar}`"
        )
    lines.append(
        f"\n共 **{stats['total_voters']}** 人参与 · **{stats['total_votes']}** 票"
    )
    if stats.get("leader"):
        lines.append(f"🏆 领先: **{stats['leader']['label']}**")
    return "\n".join(lines)


def build_vote_card(poll: dict[str, Any]) -> dict[str, Any]:
    stats = compute_stats(poll)
    status = poll.get("status", "draft")
    closed = status == "closed"

    subtitle_parts = []
    if poll.get("description"):
        subtitle_parts.append(poll["description"][:60])
    if poll.get("deadline"):
        subtitle_parts.append(f"截止 {poll['deadline']}")
    subtitle = " · ".join(subtitle_parts)

    header_color = "grey" if closed else "blue"
    if poll.get("template_id") == "rating":
        header_color = "purple" if not closed else "grey"

    elements: list[dict] = []
    if poll.get("description"):
        elements.append(_md(poll["description"]))

    mode_label = "多选" if poll.get("mode") == "multi" else "单选"
    anon_label = "匿名" if poll.get("anonymous") else "实名"
    meta = f"📌 {mode_label} · {anon_label}"
    if poll.get("mode") == "multi" and poll.get("max_choices", 1) > 1:
        meta += f" · 最多选 {poll['max_choices']} 项"
    elements.append(_caption(meta))
    elements.append(_divider())

    if closed:
        elements.append(_md("**投票已结束**"))
    else:
        for opt in poll.get("options") or []:
            elements.append(
                _callback_btn(
                    opt["label"],
                    {
                        "action": VOTE_ACTION,
                        "poll_id": poll["id"],
                        "option_id": opt["id"],
                    },
                    btn_type="primary" if poll.get("template_id") == "yes_no" and opt["id"] == "yes" else "default",
                )
            )

    elements.append(_divider())
    elements.append(_md(build_stats_markdown(poll, stats)))

    if not closed and stats["total_voters"] > 0:
        elements.append(_caption("点击选项即可投票，结果实时更新"))

    return _wrap(_header(poll["title"], template=header_color, subtitle=subtitle), *elements)


def record_vote(
    poll_id: str,
    option_id: str,
    voter_id: str,
    voter_name: str = "",
) -> dict[str, Any]:
    poll = _load_poll(poll_id)
    if not poll:
        return {"ok": False, "error": "投票不存在", "toast": "投票不存在"}
    if poll.get("status") == "closed":
        return {"ok": False, "error": "投票已结束", "toast": "投票已结束"}

    valid_ids = {o["id"] for o in poll.get("options") or []}
    if option_id not in valid_ids:
        return {"ok": False, "error": "无效选项", "toast": "无效选项"}

    votes: list[dict] = poll.setdefault("votes", [])
    mode = poll.get("mode", "single")
    anonymous = poll.get("anonymous", False)
    max_choices = int(poll.get("max_choices") or 1)

    existing = [v for v in votes if v.get("voter_id") == voter_id]
    opt_label = next(
        (o["label"] for o in poll.get("options", []) if o["id"] == option_id),
        option_id,
    )

    if mode == "single":
        if existing:
            if existing[0].get("option_id") == option_id:
                return {
                    "ok": True,
                    "changed": False,
                    "toast": f"你已投给「{opt_label}」",
                    "poll": poll,
                    "card": build_vote_card(poll),
                }
            votes[:] = [v for v in votes if v.get("voter_id") != voter_id]
        votes.append(
            {
                "option_id": option_id,
                "voter_id": voter_id if not anonymous else "",
                "voter_name": voter_name if not anonymous else "匿名",
                "voted_at": _now_iso(),
            }
        )
        toast = f"已投票：{opt_label}"
    else:
        chosen = {v.get("option_id") for v in existing}
        if option_id in chosen:
            votes[:] = [
                v
                for v in votes
                if not (v.get("voter_id") == voter_id and v.get("option_id") == option_id)
            ]
            toast = f"已取消：{opt_label}"
        else:
            if len(existing) >= max_choices:
                return {
                    "ok": False,
                    "error": f"最多选 {max_choices} 项",
                    "toast": f"最多选 {max_choices} 项",
                }
            votes.append(
                {
                    "option_id": option_id,
                    "voter_id": voter_id if not anonymous else "",
                    "voter_name": voter_name if not anonymous else "匿名",
                    "voted_at": _now_iso(),
                }
            )
            toast = f"已选择：{opt_label}"

    _save_poll(poll)
    return {
        "ok": True,
        "changed": True,
        "toast": toast,
        "poll": poll,
        "card": build_vote_card(poll),
        "stats": compute_stats(poll),
    }


def vote_setup_status() -> dict[str, Any]:
    """投票功能所需的飞书接入状态与配置引导。"""
    from routers import meal_receipt_router as meal
    from services import meal_feishu_lark_cli as lc
    from services.meal_feishu_config import is_configured
    from utils.meal_public_url import meal_public_web_base

    base = meal.feishu_integration_status()
    agent_web = meal_public_web_base().rstrip("/")
    backend_public = (
        os.getenv("CLOUDFLARE_BACKEND_DOMAIN")
        or os.getenv("BACKEND_PUBLIC_URL")
        or os.getenv("PUBLIC_API_URL")
        or ""
    ).strip().rstrip("/")
    if not backend_public:
        backend_public = "http://127.0.0.1:8000"
    webhook_backend = f"{backend_public.rstrip('/')}/meal/feishu/webhook"
    webhook_frontend = f"{agent_web.rstrip('/')}/api/meal/feishu/webhook"

    probe = lc.integration_probe() if lc.is_installed() else {}
    app_id = str(probe.get("lark_cli_app_id") or base.get("feishu_app_id_prefix") or "").strip()
    configured = is_configured()
    ws_connected = bool(base.get("ws_connected"))
    lark_cli_ok = bool(probe.get("lark_cli_configured"))
    has_https_webhook = webhook_backend.startswith("https://") or webhook_frontend.startswith("https://")

    dev_console = "https://open.feishu.cn/app"
    if app_id.startswith("cli_"):
        dev_console = f"https://open.feishu.cn/app/{app_id}/baseinfo"

    steps = [
        {
            "id": "lark_cli",
            "title": "① 配置 lark-cli 并连接",
            "done": lark_cli_ok and ws_connected,
            "hint": "「连接飞书」→ 同步 lark-cli → 连接（保持服务运行）",
            "action": "connect",
            "required": True,
        },
        {
            "id": "interactive_card",
            "title": "② 启用「交互卡片」能力",
            "done": False,
            "hint": "开发者后台 → 应用能力 → 机器人 → 开启「交互卡片 / Interactive Card」",
            "action": "developer_console",
            "required": True,
        },
        {
            "id": "card_callback",
            "title": "③ 订阅「卡片回传交互」回调",
            "done": False,
            "hint": "开发配置 → 事件与回调 → 已订阅的回调 → 添加「卡片回传交互」(card.action.trigger)",
            "action": "developer_console",
            "required": True,
        },
        {
            "id": "callback_mode",
            "title": "④ 配置回调接收方式（二选一）",
            "done": ws_connected or has_https_webhook,
            "hint": (
                "长连接：回调配置选「使用长连接接收回调」并先在本页连接；"
                f"或 HTTP：请求地址填 {webhook_backend}"
            ),
            "action": "developer_console",
            "required": True,
        },
        {
            "id": "publish_version",
            "title": "⑤ 创建并发布应用版本",
            "done": False,
            "hint": "开发者后台 → 版本管理与发布 → 创建版本 → 发布（配置变更必须发布才生效）",
            "action": "developer_console",
            "required": True,
        },
        {
            "id": "bot_in_chat",
            "title": "⑥ 机器人已加入投票群",
            "done": configured,
            "hint": "把机器人拉进目标群；发送卡片只要求此项，点击投票还要求 ②–⑤",
            "action": None,
            "required": True,
        },
    ]

    ready_to_send = configured and lark_cli_ok
    ready_for_callbacks = ws_connected or has_https_webhook

    return {
        "configured": configured,
        "lark_cli_configured": lark_cli_ok,
        "lark_cli_app_id": app_id,
        "ws_connected": ws_connected,
        "connection_mode": base.get("connection_mode") or "",
        "ws_error": base.get("ws_error") or "",
        "ready_to_send": ready_to_send,
        "ready_for_callbacks": ready_for_callbacks,
        "card_callback_error_hint": (
            "若点击投票按钮提示 Card callback isn't configured，说明 ②③④⑤ 未在飞书开发者后台完成。"
        ),
        "webhook_url": webhook_backend,
        "webhook_url_frontend": webhook_frontend,
        "lark_cli_page": f"{agent_web}/lark-cli",
        "developer_console_url": dev_console,
        "developer_event_url": (
            f"https://open.feishu.cn/app/{app_id}/event" if app_id.startswith("cli_") else dev_console
        ),
        "steps": steps,
        "callback_modes": [
            {
                "id": "websocket",
                "name": "长连接（推荐本地 / 有 app_secret 时）",
                "description": "事件与回调 → 订阅方式选「使用长连接接收回调」，本页保持「连接飞书」在线。",
                "active": ws_connected,
            },
            {
                "id": "http_webhook",
                "name": "HTTP 回调（tunnel / 公网）",
                "description": f"请求地址填 {webhook_backend} 或 {webhook_frontend}",
                "active": has_https_webhook,
            },
        ],
    }


def send_poll(poll_id: str) -> dict[str, Any]:
    from services import meal_feishu_lark_cli as lc
    from services.meal_feishu_config import is_configured

    if not is_configured():
        return {
            "ok": False,
            "error": "请先完成飞书连接：打开侧边栏「连接飞书」→ 同步 lark-cli → 连接",
        }
    if not lc.is_installed():
        return {"ok": False, "error": "未安装 lark-cli，请执行 npm install -g @larksuite/cli"}
    if not lc.lark_cli_app_ready():
        return {
            "ok": False,
            "error": "lark-cli 未绑定应用，请在「连接飞书」执行初始化并登录授权",
        }

    poll = _load_poll(poll_id)
    if not poll:
        return {"ok": False, "error": "投票不存在"}

    chat_id = str(poll.get("chat_id") or "").strip()
    if not chat_id:
        return {"ok": False, "error": "请先选择目标群聊"}

    card = build_vote_card(poll)
    ok, err, message_id = lc.send_chat_interactive(chat_id, card)
    if not ok:
        hint = ""
        low = (err or "").lower()
        if "chat" in low or "member" in low or "not in" in low:
            hint = " 请确认机器人已加入该群。"
        elif "scope" in low or "permission" in low:
            hint = " 请在飞书开发者后台开通 im:message:send_as_bot 并重新授权。"
        return {"ok": False, "error": (err or "发送失败") + hint}

    poll["status"] = "active"
    poll["sent_at"] = _now_iso()
    poll["message_id"] = message_id or ""
    _save_poll(poll)
    return {
        "ok": True,
        "message_id": message_id,
        "poll": _poll_summary(poll),
    }


def close_poll(poll_id: str) -> dict[str, Any]:
    poll = _load_poll(poll_id)
    if not poll:
        return {"ok": False, "error": "投票不存在"}
    poll["status"] = "closed"
    poll["closed_at"] = _now_iso()
    _save_poll(poll)
    return {"ok": True, "poll": _poll_summary(poll), "stats": compute_stats(poll)}


def get_stats(poll_id: str) -> dict[str, Any]:
    poll = _load_poll(poll_id)
    if not poll:
        return {"ok": False, "error": "投票不存在"}
    stats = compute_stats(poll)
    return {
        "ok": True,
        "poll": _poll_summary(poll),
        "stats": stats,
        "analysis": _build_analysis(poll, stats),
    }


def _build_analysis(poll: dict[str, Any], stats: dict[str, Any]) -> dict[str, Any]:
    rows = stats.get("by_option") or []
    total = stats.get("total_votes") or 0
    if total == 0:
        return {
            "summary": "暂无投票数据，发送卡片后等待群成员参与。",
            "insights": [],
        }

    leader = stats.get("leader")
    insights: list[str] = []
    if leader:
        insights.append(
            f"「{leader['label']}」领先，占比 {leader['percent']}%（{leader['count']} 票）"
        )

    if len(rows) >= 2 and rows[0]["count"] > 0:
        gap = rows[0]["count"] - rows[1]["count"]
        if gap <= 2:
            insights.append("前两名差距很小，结果仍可能变化")
        elif rows[0]["percent"] >= 60:
            insights.append("领先选项优势明显，可考虑提前截止")

    mode = poll.get("mode", "single")
    if mode == "multi":
        avg = round(total / max(stats["total_voters"], 1), 1)
        insights.append(f"多选模式下人均选择 {avg} 项")

    if poll.get("template_id") == "rating" and rows:
        weighted = 0
        weight_total = 0
        for row in rows:
            try:
                score = int(row["option_id"])
                weighted += score * row["count"]
                weight_total += row["count"]
            except ValueError:
                pass
        if weight_total:
            avg_score = round(weighted / weight_total, 2)
            insights.append(f"加权平均分 {avg_score} / 5")

    summary = f"共 {stats['total_voters']} 人参与，累计 {total} 票。"
    if leader:
        summary += f" 当前领先：{leader['label']}。"

    return {"summary": summary, "insights": insights}
