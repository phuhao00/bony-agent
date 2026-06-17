"""餐费 · 飞书消息接入（lark-cli event 或 lark-oapi 长连接）"""
from __future__ import annotations

import json
import logging
import os
import subprocess
import threading
import time
from typing import Optional

from services.meal_feishu_config import is_configured, load_config, uses_lark_cli
from services.meal_feishu_api import reset_client_cache, get_bot_open_id

logger = logging.getLogger(__name__)

_ws_client = None
_ws_thread: Optional[threading.Thread] = None
_subscribe_proc: Optional[subprocess.Popen] = None
_connected = False
_last_error = ""
_mode = ""


def is_connected() -> bool:
    if _subscribe_proc is not None and _subscribe_proc.poll() is not None:
        return False
    return _connected


def last_error() -> str:
    return _last_error


def connection_mode() -> str:
    return _mode


def _no_proxy_env() -> None:
    _no_proxy = "feishu.cn,.feishu.cn,larksuite.com,.larksuite.com,msg-frontier.feishu.cn"
    os.environ.setdefault("NO_PROXY", _no_proxy)
    os.environ.setdefault("no_proxy", _no_proxy)


def _terminate_subscribe_proc() -> None:
    """结束本进程内的 lark-cli 订阅子进程，释放单实例锁。"""
    global _subscribe_proc, _connected
    proc = _subscribe_proc
    if not proc:
        return
    if proc.poll() is None:
        try:
            proc.terminate()
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            try:
                proc.kill()
                proc.wait(timeout=2)
            except Exception:
                pass
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass
    _subscribe_proc = None
    _connected = False
    time.sleep(0.3)


def _subscribe_args(*, force: bool) -> list[str]:
    args = [
        "event",
        "+subscribe",
        "--as",
        "bot",
        "--event-types",
        "im.message.receive_v1,card.action.trigger",
        "--quiet",
    ]
    if force:
        args.append("--force")
    return args


def _format_subscribe_exit(code: int, err_tail: str) -> str:
    err = (err_tail or "").strip()
    if "Only one subscriber" in err or "competing consumers" in err:
        return (
            "已有其他 lark-cli 事件订阅在运行（同一应用只能有一个订阅端）。"
            "请先在其他终端 Ctrl+C 结束 `lark-cli event +subscribe`，"
            "再点「断开」后重新「同步并连接」；本服务已自动使用 --force 尝试接管。"
            f" 详情: {err[:240]}"
        )
    return f"lark-cli 订阅退出(code={code}) {err[:300]}".strip()


def _start_lark_cli_subscribe() -> tuple[bool, str]:
    global _subscribe_proc, _connected, _last_error, _mode, _ws_thread

    from services import meal_feishu_lark_cli as lc
    from services.feishu_vote_handler import dispatch_platform_event
    from services.meal_feishu_handler import handle_im_message_event

    if not lc.is_installed():
        return False, "未安装 lark-cli：npm install -g @larksuite/cli"

    ok, msg, _ = lc.sync_from_lark_cli()
    if not ok:
        return False, msg

    if _subscribe_proc and _subscribe_proc.poll() is None:
        _connected = True
        _mode = "lark-cli-event"
        return True, "已在监听飞书消息（lark-cli）"

    _terminate_subscribe_proc()

    exe = lc.get_executable()
    # 餐费页「连接」需接管订阅；--force 绕过 lark-cli 单实例锁（勿与其它常驻 subscribe 并行）
    args = _subscribe_args(force=True)

    def _run():
        global _subscribe_proc, _connected, _last_error
        try:
            _subscribe_proc = subprocess.Popen(
                [exe, *args],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
                env=lc.child_env(),
            )
            time.sleep(0.6)
            early_code = _subscribe_proc.poll()
            if early_code is not None:
                err_tail = ""
                if _subscribe_proc.stderr:
                    err_tail = _subscribe_proc.stderr.read() or ""
                _connected = False
                _last_error = _format_subscribe_exit(early_code, err_tail)
                logger.warning("[meal_feishu_ws] 订阅未启动: %s", _last_error)
                return
            _connected = True
            _last_error = ""
            get_bot_open_id()
            logger.info("[meal_feishu_ws] lark-cli event +subscribe 已启动 (--force)")
            assert _subscribe_proc.stdout is not None
            for raw in _subscribe_proc.stdout:
                line = (raw or "").strip()
                if not line or line[0] != "{":
                    continue
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    continue
                et, payload = lc.normalize_platform_event(obj)
                if et == "im.message.receive_v1" and payload:
                    try:
                        handle_im_message_event(payload)
                    except Exception as e:
                        logger.exception(f"[meal_feishu_ws] 处理消息事件: {e}")
                elif et == "card.action.trigger" and payload:
                    try:
                        dispatch_platform_event(obj)
                    except Exception as e:
                        logger.exception(f"[meal_feishu_ws] 处理卡片回调: {e}")
            code = _subscribe_proc.wait()
            _connected = False
            err_tail = ""
            if _subscribe_proc.stderr:
                err_tail = (_subscribe_proc.stderr.read() or "")[-500:]
            _last_error = _format_subscribe_exit(code, err_tail)
            logger.warning("[meal_feishu_ws] %s", _last_error)
        except Exception as e:
            _connected = False
            _last_error = str(e)[:200]
            logger.error(f"[meal_feishu_ws] lark-cli 订阅失败: {e}")

    _ws_thread = threading.Thread(target=_run, name="meal-feishu-lark-cli", daemon=True)
    _ws_thread.start()
    _mode = "lark-cli-event"
    return True, "正在通过 lark-cli 监听飞书消息…"


def _start_lark_oapi() -> tuple[bool, str]:
    global _ws_client, _ws_thread, _connected, _last_error, _mode

    try:
        import lark_oapi as lark
        from lark_oapi.api.im.v1 import P2ImMessageReceiveV1
        from lark_oapi.ws import Client as WSClient
    except ImportError:
        return False, "请安装依赖：pip install lark-oapi，或改用 lark-cli 连接"

    cfg = load_config()
    reset_client_cache()
    _no_proxy_env()

    from services.feishu_vote_handler import build_lark_oapi_card_response, dispatch_platform_event
    from services.meal_feishu_handler import handle_im_message_event

    def _on_card_action(data) -> object:
        try:
            ev = data.event
            if not ev:
                return build_lark_oapi_card_response(None)
            op = getattr(ev, "operator", None)
            action = getattr(ev, "action", None)
            event_dict = {
                "operator": {
                    "open_id": (getattr(op, "open_id", "") or "") if op else "",
                    "name": (getattr(op, "name", "") or "") if op else "",
                },
                "action": {
                    "value": getattr(action, "value", None) if action else None,
                },
            }
            result = dispatch_platform_event(
                {"header": {"event_type": "card.action.trigger"}, "event": event_dict}
            )
            return build_lark_oapi_card_response(result)
        except Exception as e:
            logger.exception("[meal_feishu_ws] 卡片回调异常: %s", e)
            return build_lark_oapi_card_response(
                {"toast": {"type": "error", "content": f"处理失败: {str(e)[:60]}"}}
            )

    def _on_message(data: P2ImMessageReceiveV1) -> None:
        try:
            ev = data.event
            if not ev or not ev.message:
                return
            event_dict = {
                "message": {
                    "message_id": ev.message.message_id,
                    "chat_id": ev.message.chat_id,
                    "chat_type": ev.message.chat_type,
                    "message_type": ev.message.message_type,
                    "content": ev.message.content,
                    "mentions": [
                        {"id": {"open_id": (m.id.open_id if m.id else "")}}
                        for m in (ev.message.mentions or [])
                    ],
                },
                "sender": {
                    "sender_id": {
                        "open_id": (
                            ev.sender.sender_id.open_id
                            if ev.sender and ev.sender.sender_id
                            else ""
                        ),
                    },
                },
            }
            handle_im_message_event(event_dict)
        except Exception as e:
            logger.exception(f"[meal_feishu_ws] 回调异常: {e}")

    event_handler = (
        lark.EventDispatcherHandler.builder("", "")
        .register_p2_im_message_receive_v1(_on_message)
        .register_p2_card_action_trigger(_on_card_action)
        .build()
    )

    def _run():
        global _connected, _last_error
        try:
            ws = WSClient(
                cfg["app_id"],
                cfg["app_secret"],
                event_handler=event_handler,
                log_level=lark.LogLevel.INFO,
            )
            _connected = True
            _last_error = ""
            get_bot_open_id()
            logger.info("[meal_feishu_ws] 飞书长连接启动 (lark-oapi)")
            ws.start()
        except Exception as e:
            _connected = False
            _last_error = str(e)[:200]
            logger.error(f"[meal_feishu_ws] 连接失败: {e}")

    _ws_thread = threading.Thread(target=_run, name="meal-feishu-ws", daemon=True)
    _ws_thread.start()
    _mode = "lark-oapi"
    return True, "正在连接飞书…（lark-oapi 长连接）"


def start() -> tuple[bool, str]:
    """启动飞书消息监听。"""
    global _ws_thread, _connected, _last_error

    if not is_configured():
        return False, "请先完成 lark-cli 应用配置（本页「初始化」→「同步并连接」）"

    if uses_lark_cli():
        return _start_lark_cli_subscribe()

    if _connected and _ws_thread and _ws_thread.is_alive():
        return True, "已在连接中"

    return _start_lark_oapi()


def stop() -> None:
    global _last_error
    _last_error = ""
    _terminate_subscribe_proc()
    logger.info("[meal_feishu_ws] 已断开飞书监听")
