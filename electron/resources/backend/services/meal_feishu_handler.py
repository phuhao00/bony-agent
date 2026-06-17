"""餐费 · 飞书消息处理（文本命令 + 图片上传）"""
from __future__ import annotations

import json
import logging
import re
import threading
import uuid
from datetime import date
from pathlib import Path

from services import meal_feishu_api as fs
from services.meal_feishu_config import is_configured
from routers import meal_receipt_router as meal

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).parent.parent.parent
_RECEIPT_DIR = PROJECT_ROOT / "storage" / "uploads" / "meal" / "feishu"

_MEAL_KW = {
    "餐费", "吃饭", "饭补", "餐费记录", "我的餐费", "餐费统计",
    "餐费导出", "餐费删除", "餐费补录",
}
_DATE_RE = re.compile(r"\b(\d{4}-\d{1,2}-\d{1,2})\b")
_MONTH_RE = re.compile(r"\b(\d{4}-\d{1,2})\b")
_AMOUNT_RE = re.compile(r"(\d+(?:\.\d+)?)\b")


def _parse_month(rest: str) -> str:
    rest = (rest or "").strip().lower()
    if rest in ("全部", "all", "所有"):
        return ""
    m = _MONTH_RE.search(rest)
    if m:
        y, mo = m.group(1).split("-")
        return f"{int(y):04d}-{int(mo):02d}"
    return meal.current_month()


def _extract_command(text: str) -> tuple[str, str]:
    text = text.strip()
    if text in _MEAL_KW:
        return text, ""
    parts = text.split(None, 1)
    if parts and parts[0] in _MEAL_KW:
        return parts[0], (parts[1] if len(parts) > 1 else "").strip()
    if text.startswith("餐费"):
        sub = text[2:].strip()
        if not sub:
            return "餐费", ""
        p2 = sub.split(None, 1)
        return "餐费", sub
    return "", text


def _handle_meal_text(command: str, args: str, sender_id: str, sender_name: str) -> str:
    sub, rest = "", args
    if command in ("餐费", "吃饭", "饭补"):
        p = args.split(None, 1)
        if p and p[0] in ("记录", "列表", "统计", "汇总", "导出", "删除", "补录", "帮助"):
            sub = p[0]
            rest = p[1].strip() if len(p) > 1 else ""
    else:
        sub = {
            "餐费记录": "记录", "我的餐费": "记录", "餐费统计": "统计",
            "餐费导出": "导出", "餐费删除": "删除", "餐费补录": "补录",
        }.get(command, "")

    if sub in ("记录", "列表"):
        month = _parse_month(rest)
        records = meal.list_by_emp(sender_id, month=month)
        s = meal.summarize(records)
        if not records:
            return f"📭 {month or '全部'} 暂无餐费记录，直接发截图即可登记。"
        lines = []
        for r in records[:20]:
            bill = float(r["amount"])
            reimb = meal.reimbursement_amount(bill)
            amt = f"¥{reimb}" + (f"(票¥{bill})" if reimb < bill else "")
            lines.append(f"**{r['meal_date']}**  {amt}  {r.get('merchant') or ''}")
        extra = f"\n…共 {len(records)} 条" if len(records) > 20 else ""
        cap = s.get("daily_cap", 30)
        bill = s.get("total_bill", s["total"])
        tail = f"\n\n可报销 ¥{s['total']} · {s['days']} 天 · 日均 ¥{s['avg']}"
        if bill != s["total"] or s.get("capped_days"):
            tail += f"\n（日封顶 ¥{cap:g}，票据 ¥{bill}，{s.get('capped_days', 0)} 天超标）"
        return f"💰 {sender_name} · {month or '全部'}\n" + "\n".join(lines) + extra + tail

    if sub in ("统计", "汇总"):
        month = _parse_month(rest)
        records = meal.list_by_emp(sender_id, month=month)
        s = meal.summarize(records)
        cap = s.get("daily_cap", 30)
        bill = s.get("total_bill", s["total"])
        extra = ""
        if bill != s["total"] or s.get("capped_days"):
            extra = f"\n票据合计 ¥{bill} · 日封顶 ¥{cap:g} · {s.get('capped_days', 0)} 天按封顶计"
        return (
            f"📊 {sender_name} · {month or '全部'}\n"
            f"可报销 ¥{s['total']} · {s['days']} 天 · 日均 ¥{s['avg']} · {s['count']} 条"
            + extra
        )

    if sub == "导出":
        return "📤 请在 Web 控制台「公司定制 → 餐费票据」导出 Excel（全员统计页可导出）。"

    if sub == "删除":
        m = _DATE_RE.search(rest)
        if not m:
            return "用法：餐费删除 2026-06-02"
        y, mo, d = m.group(1).split("-")
        md = f"{int(y):04d}-{int(mo):02d}-{int(d):02d}"
        ok = meal.delete_receipt(sender_id, md)
        return f"🗑️ 已删除 {md}" if ok else f"{md} 无记录"

    if sub == "补录":
        if not rest:
            return "用法：餐费补录 2026-06-02 35.5 [商家]"
        dm = _DATE_RE.search(rest)
        if dm:
            y, mo, d = dm.group(1).split("-")
            md = f"{int(y):04d}-{int(mo):02d}-{int(d):02d}"
            after = rest[dm.end():].strip()
        else:
            md = date.today().strftime("%Y-%m-%d")
            after = rest
        am = _AMOUNT_RE.search(after)
        if not am:
            return "未识别到金额"
        amount = round(float(am.group(1)), 2)
        merchant = after[am.end():].strip()
        ok, status, record = meal.upsert_receipt(
            employee_id=sender_id, employee_name=sender_name, meal_date=md,
            amount=amount, merchant=merchant, source="feishu_manual", overwrite=True,
        )
        if ok and record:
            return f"✅ 已{status}：{md} · ¥{amount} · {merchant or '—'}"
        return "❌ 补录失败"

    from services.meal_feishu_profile import personal_meal_links
    from services.meal_feishu_reminder import public_upload_url

    links = personal_meal_links(sender_id, sender_name) if sender_id else {}
    url = links.get("upload") or public_upload_url()
    hist = links.get("history") or ""
    lines = [
        "💰 **每日餐费票据**",
        f"🔗 上传：{url}",
    ]
    if hist:
        lines.append(f"📜 我的提交记录：{hist}")
    lines.extend(
        [
            "• 私聊直接发**餐费截图** → 自动识别（每人每天一条）",
            "• `餐费记录` / `餐费统计` / `餐费补录` / `餐费删除`",
        ]
    )
    return "\n".join(lines)


def _handle_image(
    message_id: str, sender_id: str, sender_name: str,
    image_key: str, overwrite: bool = False,
) -> None:
    fs.reply_text(message_id, "🔍 正在识别餐费票据，请稍候…")
    save_dir = _RECEIPT_DIR / sender_id
    save_dir.mkdir(parents=True, exist_ok=True)
    img_path = str(save_dir / f"{uuid.uuid4().hex}.jpg")
    if not fs.download_message_resource(message_id, image_key, img_path, res_type="image"):
        fs.reply_text(message_id, "❌ 图片下载失败，请确认应用权限：im:message.resource:read")
        return
    with open(img_path, "rb") as f:
        content = f.read()
    result = meal.process_upload(
        employee_id=sender_id,
        employee_name=sender_name,
        files=[(content, "receipt.jpg")],
        overwrite=overwrite,
        source="feishu_image",
    )
    st = result.get("status")
    if st in ("created", "updated") and result.get("record"):
        r = result["record"]
        pending = "（待处理）" if r.get("pending_review") else ""
        fs.reply_text(
            message_id,
            f"✅ 餐费已登记{pending}\n日期：{r.get('meal_date')}\n金额：¥{r.get('amount')} {r.get('currency', 'CNY')}\n"
            f"商家：{r.get('merchant') or '—'}",
        )
    elif st == "exists":
        rec = result.get("recognized") or {}
        ex = result.get("record") or {}
        fs.reply_text(
            message_id,
            f"⚠️ {rec.get('date') or ex.get('meal_date')} 已有记录 ¥{ex.get('amount')}。\n"
            f"新识别 ¥{rec.get('amount')}。请再发一张相同图片并回复「覆盖」以更新（或 Web 端修改）。",
        )
    else:
        fs.reply_text(message_id, f"❌ {result.get('error', '识别失败')}")


def handle_im_message_event(event: dict) -> None:
    """处理飞书 im.message.receive_v1 事件体（WebSocket 或 Webhook）。"""
    if not is_configured():
        return
    try:
        msg = (event.get("message") or {})
        sender = (event.get("sender") or {})
        sender_id_obj = (sender.get("sender_id") or {})
        sender_open_id = sender_id_obj.get("open_id") or ""
        bot_oid = fs.get_bot_open_id()
        if bot_oid and sender_open_id == bot_oid:
            return

        chat_id = msg.get("chat_id") or ""
        message_id = msg.get("message_id") or ""
        chat_type = msg.get("chat_type") or ""
        is_group = chat_type == "group"
        msg_type = msg.get("message_type") or ""

        sender_name = fs.get_user_name(sender_open_id, chat_id=chat_id)

        if msg_type == "image":
            mentions = msg.get("mentions") or []
            at_bot = any(
                (m.get("id") or {}).get("open_id") == bot_oid for m in mentions if bot_oid
            )
            if is_group and not at_bot:
                return
            content_obj = json.loads(msg.get("content") or "{}")
            image_key = content_obj.get("image_key") or ""
            if not image_key:
                return
            threading.Thread(
                target=_handle_image,
                args=(message_id, sender_open_id, sender_name, image_key),
                daemon=True,
            ).start()
            return

        if msg_type != "text":
            return

        content_obj = json.loads(msg.get("content") or "{}")
        raw_text = (content_obj.get("text") or "").strip()
        mentions = msg.get("mentions") or []
        at_bot = any((m.get("id") or {}).get("open_id") == bot_oid for m in mentions if bot_oid)
        if not at_bot:
            at_bot = bool(re.search(r"@_user_\d+", raw_text))
        text = re.sub(r"@_user_\d+\s*", "", raw_text).strip()
        if not text:
            return

        if is_group and not at_bot:
            from services.feishu_ops import is_ops_command

            cmd, _ = _extract_command(text)
            if cmd not in _MEAL_KW and not is_ops_command(text):
                return

        from services.feishu_ops import try_handle_ops_message

        if try_handle_ops_message(
            text,
            sender_open_id=sender_open_id,
            sender_name=sender_name,
            chat_id=chat_id,
            message_id=message_id,
            is_group=is_group,
            at_bot=at_bot,
        ):
            return

        from services.feishu_ops_auto_build import try_auto_jenkins_from_chat

        if try_auto_jenkins_from_chat(
            text,
            sender_open_id=sender_open_id,
            sender_name=sender_name,
            chat_id=chat_id,
            message_id=message_id,
            is_group=is_group,
            at_bot=at_bot,
        ):
            return

        cmd, args = _extract_command(text)
        if cmd in _MEAL_KW or text.startswith("餐费"):
            reply = _handle_meal_text(cmd or "餐费", args, sender_open_id, sender_name)
            fs.reply_text(message_id, reply)
            return

        if text.strip() == "覆盖":
            fs.reply_text(message_id, "请重新发送要覆盖的餐费截图（将自动覆盖当天记录）。")

    except Exception as e:
        logger.exception(f"[meal_feishu] 事件处理异常: {e}")
