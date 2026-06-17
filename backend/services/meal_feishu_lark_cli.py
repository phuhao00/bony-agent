"""餐费 · 通过本机 lark-cli 调用飞书（凭证存 ~/.lark-cli，无需手填 Secret）"""
from __future__ import annotations

import json
import logging
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

_ANSI_RE = re.compile(r"\x1b\[[0-9;]*m")
_CLI_NOISE_RE = re.compile(
    r"ev_poll_posix|FD from fork parent still in poll list",
    re.I,
)


def _strip_cli_noise(text: str) -> str:
    if not text:
        return ""
    kept = [ln for ln in text.splitlines() if not _CLI_NOISE_RE.search(ln)]
    return "\n".join(kept).strip()


def _is_only_cli_noise(text: str) -> bool:
    return bool(text.strip()) and not _strip_cli_noise(text).strip()


def _cli_send_success(parsed: Optional[dict[str, Any]]) -> bool:
    if not parsed:
        return False
    code = parsed.get("code")
    if code in (0, "0"):
        return True
    data = parsed.get("data")
    if isinstance(data, dict) and (
        data.get("message_id") or data.get("msg_id") or data.get("body")
    ):
        return True
    return False


def _agent_home() -> Optional[Path]:
    raw = (
        os.getenv("AI_MEDIA_AGENT_HOME", "").strip()
        or (
            os.getenv("STORAGE_DIR", "").strip().rstrip("/\\").removesuffix("storage")
            if os.getenv("STORAGE_DIR", "").strip()
            else ""
        )
    )
    if raw:
        return Path(raw)
    home = Path.home()
    if os.name == "nt":
        local = os.getenv("LOCALAPPDATA", "") or str(home / "AppData" / "Local")
        return Path(local) / "ai-media-agent"
    if sys.platform == "darwin":
        return home / "Library" / "Application Support" / "ai-media-agent"
    return home / ".config" / "ai-media-agent"


def _lark_cli_candidates() -> list[str]:
    home = Path.home()
    agent = _agent_home()
    ext = ".exe" if os.name == "nt" else ""
    out: list[str] = []
    env_bin = os.getenv("LARK_CLI_BIN", "").strip()
    if env_bin:
        out.append(env_bin)
    if agent:
        base = agent / "lark-cli" / "node_modules"
        out.extend(
            [
                str(base / "@larksuite" / "cli" / "bin" / f"lark-cli{ext}"),
                str(agent / "bin" / f"lark-cli{ext}"),
            ]
        )
    out.extend(
        [
            str(home / ".local" / "bin" / "lark-cli"),
            "/opt/homebrew/bin/lark-cli",
            "/usr/local/bin/lark-cli",
            "lark-cli",
        ]
    )
    seen: set[str] = set()
    deduped: list[str] = []
    for p in out:
        if p not in seen:
            seen.add(p)
            deduped.append(p)
    return deduped


def get_executable() -> str:
    for cand in _lark_cli_candidates():
        if cand == "lark-cli":
            continue
        if Path(cand).is_file():
            return cand
    return "lark-cli"


def child_env() -> dict[str, str]:
    home = str(Path.home())
    agent = _agent_home()
    sep = ";" if os.name == "nt" else ":"
    extras = [
        str(agent / "lark-cli" / "node_modules" / ".bin") if agent else "",
        str(agent / "node" / "bin") if agent else "",
        str(agent / "bin") if agent else "",
        str(Path(home) / ".local" / "bin"),
        "/opt/homebrew/bin",
        "/usr/local/bin",
    ]
    path = sep.join([e for e in extras if e] + [os.environ.get("PATH", "")])
    env = {**os.environ, "HOME": home, "PATH": path}
    if agent:
        env["AI_MEDIA_AGENT_HOME"] = str(agent)
    return env


def run_cli(args: list[str], timeout: int = 60) -> tuple[int, str, str]:
    exe = get_executable()
    try:
        r = subprocess.run(
            [exe, *args],
            capture_output=True,
            text=True,
            timeout=timeout,
            env=child_env(),
        )
        return r.returncode, r.stdout or "", r.stderr or ""
    except FileNotFoundError:
        return 127, "", "未找到 lark-cli，请先安装：npm install -g @larksuite/cli"
    except subprocess.TimeoutExpired:
        return 124, "", "lark-cli 执行超时"
    except Exception as e:
        return 1, "", str(e)


def parse_json_blob(text: str) -> Optional[dict[str, Any]]:
    if not text:
        return None
    cleaned = _ANSI_RE.sub("", text.strip())
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        data = json.loads(cleaned[start : end + 1])
        return data if isinstance(data, dict) else None
    except json.JSONDecodeError:
        return None


def is_installed() -> bool:
    code, _, _ = run_cli(["--version"], timeout=12)
    return code == 0


def config_show() -> dict[str, Any]:
    code, out, err = run_cli(["config", "show"], timeout=20)
    data = parse_json_blob(out) or {}
    data["_exit_code"] = code
    if code != 0 and err:
        data["_error"] = err.strip()[:300]
    return data


def doctor_summary() -> dict[str, Any]:
    code, out, err = run_cli(["doctor"], timeout=25)
    data = parse_json_blob(out) or {}
    data["_exit_code"] = code
    if code != 0 and err:
        data["_error"] = err.strip()[:300]
    return data


def lark_cli_app_ready() -> bool:
    show = config_show()
    app_id = (show.get("appId") or "").strip()
    secret = show.get("appSecret")
    has_secret = secret not in (None, "", "****") or bool(app_id)
    return bool(app_id) and has_secret


def integration_probe() -> dict[str, Any]:
    installed = is_installed()
    show = config_show() if installed else {}
    app_id = (show.get("appId") or "").strip()
    doctor = doctor_summary() if installed else {}
    app_ok = False
    for chk in doctor.get("checks") or []:
        if isinstance(chk, dict) and chk.get("name") == "app_resolved":
            app_ok = chk.get("status") == "pass"
            break
    return {
        "lark_cli_installed": installed,
        "lark_cli_app_id": app_id,
        "lark_cli_app_id_prefix": (app_id[:8] + "…") if len(app_id) > 8 else app_id,
        "lark_cli_configured": lark_cli_app_ready(),
        "lark_cli_app_resolved": app_ok,
        "lark_cli_config_path": show.get("Config file path") or "",
        "lark_cli_error": show.get("_error") or "",
    }


def sync_from_lark_cli() -> tuple[bool, str, dict[str, Any]]:
    """从 lark-cli 读取 appId，启用 use_lark_cli（不复制 appSecret）。"""
    from services.meal_feishu_config import save_config

    if not is_installed():
        return False, "未安装 lark-cli。请执行：npm install -g @larksuite/cli", {}
    show = config_show()
    app_id = (show.get("appId") or "").strip()
    if not app_id:
        return (
            False,
            "lark-cli 尚未绑定应用。请在本页点「初始化飞书应用」或终端执行：lark-cli config init --new",
            {"config_show": show},
        )
    c = save_config({"app_id": app_id, "use_lark_cli": True})
    return True, f"已同步应用 {app_id[:12]}…（凭证由 lark-cli 托管）", {
        "app_id": c.get("app_id", ""),
        "use_lark_cli": True,
    }


def api_request(
    method: str,
    path: str,
    *,
    data: Optional[dict] = None,
    params: Optional[dict] = None,
    as_who: str = "bot",
    timeout: int = 60,
) -> tuple[int, Optional[dict[str, Any]], str]:
    args = ["api", method.upper(), path, "--as", as_who, "--format", "json"]
    if params:
        args.extend(["--params", json.dumps(params, ensure_ascii=False)])
    if data is not None:
        args.extend(["--data", json.dumps(data, ensure_ascii=False)])
    code, out, err = run_cli(args, timeout=timeout)
    parsed = parse_json_blob(out)
    if code != 0 and not parsed:
        return code, None, (err or out or "lark-cli api 失败").strip()[:400]
    return code, parsed, (err or "").strip()[:200]


def get_bot_open_id() -> str:
    code, body, _ = api_request("GET", "/open-apis/bot/v3/info", as_who="bot")
    if code == 0 and body and body.get("code") == 0:
        bot = body.get("bot") or {}
        return (bot.get("open_id") or "").strip()
    return ""


def get_user_name(open_id: str, chat_id: str = "") -> str:
    if not open_id:
        return "用户"
    code, body, _ = api_request(
        "GET",
        f"/open-apis/contact/v3/users/{open_id}",
        params={"user_id_type": "open_id"},
        as_who="bot",
    )
    if code == 0 and body and body.get("code") == 0:
        u = (body.get("data") or {}).get("user") or {}
        name = (u.get("name") or u.get("en_name") or "").strip()
        if name:
            return name
    return "用户"


def reply_text(message_id: str, text: str) -> bool:
    code, body, err = api_request(
        "POST",
        f"/open-apis/im/v1/messages/{message_id}/reply",
        data={
            "msg_type": "text",
            "content": json.dumps({"text": text}, ensure_ascii=False),
        },
        as_who="bot",
    )
    if code == 0 and body and body.get("code") == 0:
        return True
    logger.error("[meal_feishu_lark_cli] reply 失败: %s %s", body, err)
    return False


def download_message_resource(
    message_id: str, file_key: str, save_path: str, res_type: str = "image",
) -> bool:
    p = Path(save_path)
    p.parent.mkdir(parents=True, exist_ok=True)
    args = [
        "im",
        "+messages-resources-download",
        "--as",
        "bot",
        "--message-id",
        message_id,
        "--file-key",
        file_key,
        "--type",
        res_type,
        "-o",
        str(p),
    ]
    code, out, err = run_cli(args, timeout=90)
    if code == 0 and p.is_file() and p.stat().st_size > 0:
        return True
    logger.error("[meal_feishu_lark_cli] download 失败: %s %s", out[:200], err[:200])
    return False


def parse_im_chats_list(stdout: str) -> list[dict[str, str]]:
    """解析 `im chats list` 的 items（兼容带 [page N] 日志的 stdout）。"""
    data = parse_json_blob(stdout)
    if not data:
        return []
    nested = data.get("data")
    raw: list[Any] = []
    if isinstance(nested, dict) and isinstance(nested.get("items"), list):
        raw = nested["items"]
    elif isinstance(data.get("items"), list):
        raw = data["items"]
    out: list[dict[str, str]] = []
    for it in raw:
        if not isinstance(it, dict):
            continue
        cid = str(it.get("chat_id") or "").strip()
        if not cid or not cid.startswith("oc_"):
            continue
        mode = str(it.get("chat_mode") or "").strip()
        if mode and mode != "group":
            continue
        name = str(it.get("name") or "").strip() or cid
        out.append({"chat_id": cid, "name": name})
    out.sort(key=lambda x: x["name"])
    return out


def _list_group_chats_via_cli(*, as_who: str = "bot") -> tuple[list[dict[str, str]], str]:
    """`lark-cli im chats list` 回退（OpenAPI 无数据或缺 scope 时）。"""
    code, out, err = run_cli(
        [
            "im",
            "chats",
            "list",
            "--as",
            as_who,
            "--format",
            "json",
            "--page-all",
            "--page-limit",
            "25",
        ],
        timeout=120,
    )
    rows = parse_im_chats_list(out or "")
    if rows:
        return rows, ""
    detail = (err or out or "").strip()[:300]
    if code != 0 and detail:
        return [], detail
    return [], ""


def list_bot_group_chats(*, page_limit: int = 10) -> tuple[list[dict[str, str]], str]:
    """列出机器人已加入的群聊（OpenAPI → CLI 回退）。"""
    if not is_installed():
        return [], "未安装 lark-cli"

    merged: list[dict[str, str]] = []
    seen: set[str] = set()
    page_token = ""
    max_pages = max(1, min(page_limit, 20))
    api_error = ""

    for _ in range(max_pages):
        params: dict[str, Any] = {"page_size": 100}
        if page_token:
            params["page_token"] = page_token
        code, body, err = api_request(
            "GET",
            "/open-apis/im/v1/chats",
            params=params,
            as_who="bot",
            timeout=60,
        )
        if code != 0 or not body or body.get("code") != 0:
            api_error = err or str((body or {}).get("msg") or "OpenAPI 拉取群列表失败")
            break
        data = body.get("data") if isinstance(body.get("data"), dict) else {}
        chunk = parse_im_chats_list(json.dumps({"data": data}, ensure_ascii=False))
        for row in chunk:
            if row["chat_id"] not in seen:
                seen.add(row["chat_id"])
                merged.append(row)
        if not data.get("has_more"):
            break
        page_token = str(data.get("page_token") or "").strip()
        if not page_token:
            break

    if merged:
        merged.sort(key=lambda x: x["name"])
        return merged, ""

    cli_rows, cli_err = _list_group_chats_via_cli(as_who="bot")
    if not cli_rows:
        user_rows, user_err = _list_group_chats_via_cli(as_who="user")
        if user_rows:
            cli_rows = user_rows
        elif user_err and not cli_err:
            cli_err = user_err
    if cli_rows:
        cli_rows.sort(key=lambda x: x["name"])
        return cli_rows, ""

    hints = [
        "未找到群聊：请先将机器人拉入目标群，再点「刷新群列表」",
        "若已拉群仍为空，请在飞书开放平台为应用开通 im:chat 相关权限，并重新同步连接",
    ]
    if api_error:
        hints.insert(0, api_error[:200])
    if cli_err:
        hints.append(cli_err[:200])
    return [], " · ".join(h for h in hints if h)


def list_chat_members(
    chat_id: str,
    *,
    page_limit: int = 30,
) -> tuple[list[dict[str, str]], str]:
    """获取群成员（open_id + 显示名），用于餐费页姓名模糊选择。"""
    cid = (chat_id or "").strip()
    if not cid:
        return [], "未指定群 chat_id"
    if not cid.startswith("oc_"):
        return [], "chat_id 应以 oc_ 开头"
    if not is_installed():
        return [], "未安装 lark-cli"

    merged: list[dict[str, str]] = []
    seen: set[str] = set()
    page_token = ""
    max_pages = max(1, min(page_limit, 50))

    for _ in range(max_pages):
        params: dict[str, Any] = {
            "member_id_type": "open_id",
            "page_size": 100,
        }
        if page_token:
            params["page_token"] = page_token
        path = f"/open-apis/im/v1/chats/{cid}/members"
        code, body, err = api_request(
            "GET",
            path,
            params=params,
            as_who="bot",
            timeout=60,
        )
        if code != 0 or not body or body.get("code") != 0:
            detail = err or str((body or {}).get("msg") or "拉取群成员失败")
            if merged:
                return merged, ""
            return [], detail[:300]
        data = body.get("data") if isinstance(body.get("data"), dict) else {}
        for it in data.get("items") or []:
            if not isinstance(it, dict):
                continue
            oid = str(it.get("member_id") or "").strip()
            if not oid or oid in seen:
                continue
            seen.add(oid)
            name = str(it.get("name") or "").strip() or oid
            merged.append({"open_id": oid, "name": name})
        if not data.get("has_more"):
            break
        page_token = str(data.get("page_token") or "").strip()
        if not page_token:
            break

    merged.sort(key=lambda x: x["name"])
    return merged, ""


def _cli_send_result(code: int, out: str, err: str) -> tuple[bool, str]:
    """解析 lark-cli im +messages-send 输出（stdout/stderr 均可能有 JSON）。"""
    clean_out = _strip_cli_noise(out)
    clean_err = _strip_cli_noise(err)

    for blob in (out, clean_out, err, clean_err):
        parsed = parse_json_blob(blob)
        if _cli_send_success(parsed):
            return True, ""

    # gRPC/ev_poll 噪音写入 stderr 时，消息往往已成功发出
    if _is_only_cli_noise(err) and not clean_err.strip():
        if code == 0 or _cli_send_success(parse_json_blob(out)):
            return True, ""
        logger.warning(
            "[lark-cli] im send stderr noise only (code=%s), treating as success",
            code,
        )
        return True, ""

    parsed = parse_json_blob(clean_out) or parse_json_blob(clean_err) or parse_json_blob(out) or parse_json_blob(err)
    msg = ""
    if parsed:
        err_obj = parsed.get("error")
        if isinstance(err_obj, dict):
            msg = str(err_obj.get("message") or err_obj.get("msg") or "")
        msg = msg or str(parsed.get("msg") or parsed.get("message") or "")
    if not msg:
        msg = (clean_err or clean_out or err or out or "发送失败").strip()
    msg = _ANSI_RE.sub("", msg)
    if _CLI_NOISE_RE.search(msg) and "{" in msg:
        inner = parse_json_blob(msg)
        if inner:
            err_obj = inner.get("error")
            if isinstance(err_obj, dict):
                msg = str(err_obj.get("message") or inner.get("msg") or msg)
    if _is_only_cli_noise(msg):
        return True, ""
    return False, msg[:400]


def send_chat_markdown(chat_id: str, markdown: str) -> tuple[bool, str]:
    """向群聊发送 markdown 消息（bot 身份）。"""
    if not chat_id.strip():
        return False, "chat_id 为空"
    args = [
        "im",
        "+messages-send",
        "--as",
        "bot",
        "--chat-id",
        chat_id.strip(),
        "--markdown",
        markdown,
    ]
    code, out, err = run_cli(args, timeout=45)
    return _cli_send_result(code, out, err)


def send_chat_post(chat_id: str, post_body: dict[str, Any]) -> tuple[bool, str]:
    """发送飞书 post 富文本（支持可点击链接 tag=a、@ tag=at）。"""
    if not chat_id.strip():
        return False, "chat_id 为空"
    content_str = json.dumps(post_body, ensure_ascii=False)
    args = [
        "im",
        "+messages-send",
        "--as",
        "bot",
        "--chat-id",
        chat_id.strip(),
        "--msg-type",
        "post",
        "--content",
        content_str,
    ]
    code, out, err = run_cli(args, timeout=45)
    return _cli_send_result(code, out, err)


def send_chat_text(chat_id: str, text: str) -> tuple[bool, str]:
    """纯文本消息（URL 单独一行时飞书常会识别为链接）。"""
    if not chat_id.strip():
        return False, "chat_id 为空"
    args = [
        "im",
        "+messages-send",
        "--as",
        "bot",
        "--chat-id",
        chat_id.strip(),
        "--text",
        text,
    ]
    code, out, err = run_cli(args, timeout=45)
    return _cli_send_result(code, out, err)


def _lark_api_error(body: Optional[dict[str, Any]], err: str = "") -> str:
    if body:
        code = body.get("code")
        if code not in (None, 0, "0"):
            err_obj = body.get("error")
            if isinstance(err_obj, dict):
                msg = str(err_obj.get("message") or err_obj.get("msg") or "")
                if msg:
                    return msg
            msg = str(body.get("msg") or body.get("message") or "")
            if msg:
                return msg
    return (err or "飞书 API 调用失败").strip()[:400]


def send_chat_interactive(
    chat_id: str, card: dict[str, Any]
) -> tuple[bool, str, str]:
    """发送飞书交互式卡片（JSON 2.0），返回 (ok, error, message_id)。"""
    if not chat_id.strip():
        return False, "chat_id 为空", ""
    # 飞书 interactive 消息 content 为卡片 JSON 本体（非 {"type":"card","data":...} 包装）
    content = json.dumps(card, ensure_ascii=False)

    code, body, err = api_request(
        "POST",
        "/open-apis/im/v1/messages",
        params={"receive_id_type": "chat_id"},
        data={
            "receive_id": chat_id.strip(),
            "msg_type": "interactive",
            "content": content,
        },
        as_who="bot",
        timeout=45,
    )
    if code == 0 and body and body.get("code") == 0:
        data = body.get("data") or {}
        message_id = ""
        if isinstance(data, dict):
            message_id = str(data.get("message_id") or data.get("msg_id") or "").strip()
        return True, "", message_id

    api_msg = _lark_api_error(body, err)
    if api_msg and "scope" in api_msg.lower():
        api_msg += "。请在飞书开发者后台为应用开通 im:message:send_as_bot 权限并重新授权。"

    args = [
        "im",
        "+messages-send",
        "--as",
        "bot",
        "--chat-id",
        chat_id.strip(),
        "--msg-type",
        "interactive",
        "--content",
        content,
    ]
    code, out, stderr = run_cli(args, timeout=45)
    ok, msg = _cli_send_result(code, out, stderr)
    message_id = ""
    if ok:
        for blob in (out, stderr):
            parsed = parse_json_blob(blob)
            if parsed:
                data = parsed.get("data") or parsed
                if isinstance(data, dict):
                    message_id = str(
                        data.get("message_id") or data.get("msg_id") or ""
                    ).strip()
                if message_id:
                    break
        return True, "", message_id
    cli_msg = msg or api_msg or "发送交互卡片失败"
    return False, cli_msg, ""


def normalize_event_payload(obj: dict[str, Any]) -> Optional[dict[str, Any]]:
    """将 lark-cli event NDJSON / 开放平台回调统一为 handler 所需 event 字典。"""
    if not obj:
        return None
    header = obj.get("header") or {}
    et = header.get("event_type") or obj.get("event_type") or ""
    if et == "im.message.receive_v1":
        event = obj.get("event")
        if isinstance(event, dict) and event.get("message"):
            return event
        if obj.get("message"):
            return obj
        return None
    if et == "card.action.trigger":
        event = obj.get("event")
        if isinstance(event, dict):
            return {"_event_type": et, "event": event, **event}
        if obj.get("action"):
            return {"_event_type": et, "event": obj, **obj}
    return None


def normalize_platform_event(obj: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    """返回 (event_type, payload) 供多类事件分发。"""
    if not obj:
        return "", {}
    header = obj.get("header") or {}
    et = str(header.get("event_type") or obj.get("event_type") or "").strip()
    if et == "im.message.receive_v1":
        event = normalize_event_payload(obj)
        if event:
            return et, event
    if et == "card.action.trigger":
        event = obj.get("event") or obj
        if isinstance(event, dict):
            return et, event
    return et, obj
