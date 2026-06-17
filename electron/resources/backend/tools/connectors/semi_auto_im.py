"""
半自动（人在回路）连接器：微信 / QQ / 钉钉。

不注入登录态、不后台代发消息；仅在校验用户显式开启半自动模式后，通过 execute_action
返回结构化操作指引，供人工执行或交给 Computer Use 生成浏览器/桌面步骤。
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from .base import BaseConnector, ConnectorStatus, PublishResult

_PLATFORM_DISPLAY = {
    "wechat": "微信（个人客户端）",
    "qq": "QQ",
    "dingtalk": "钉钉",
}


def _safe_params(params: Dict[str, Any]) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for k, v in (params or {}).items():
        if k in ("text", "content", "title", "chat_id", "target", "note"):
            s = str(v)[:4000] if v is not None else ""
            out[k] = s
    return out


def _playbook_read_visible(platform: str, params: Dict[str, Any]) -> Dict[str, Any]:
    label = _PLATFORM_DISPLAY.get(platform, platform)
    surface = str(params.get("preferred_surface") or "desktop_client").lower()
    steps: List[str] = [
        f"在已登录的 {label} 中打开目标会话窗口，置于前台。",
        "确认界面无遮挡，仅截取/复述当前可见聊天记录（勿滚动批量导出他人隐私）。",
        "将需要 AI 处理的可见文本复制到剪贴板，或记下要点后与 Agent 对话说明上下文。",
    ]
    if surface == "web":
        steps.insert(1, f"若使用网页版 {label}，请确认会话已完成扫码/二次验证，且为本人账号。")
    return {
        "goal_hint": f"协助整理当前 {label} 会话中我可见的聊天要点（不代操作客户端）。",
        "steps": steps,
        "computer_use_template": (
            f"在用户已手动打开并已登录的 {label} 窗口中，根据用户指示查看当前可见聊天内容；"
            "不要尝试自动登录或绕过验证；不要群发或添加好友。"
        ),
    }


def _playbook_send_message(platform: str, params: Dict[str, Any]) -> Dict[str, Any]:
    label = _PLATFORM_DISPLAY.get(platform, platform)
    text = str(params.get("text") or params.get("content") or "").strip()
    target = str(params.get("target") or params.get("chat_id") or "").strip()
    steps = [
        f"打开 {label}，进入已由你选定的会话（目标：{target or '请手动选择'}）。",
        "核对收件人与会话，确认不是误触工作群或外部客户。",
        f"将下列草稿粘贴至输入框，人工润色后亲自点击发送：\n{text or '（请从审批参数中复制正文）'}",
        "发送后如需留痕，可本地截图或依赖客户端同步记录。",
    ]
    return {
        "goal_hint": f"在 {label} 中向指定会话发送已审批的草稿（须本人最终点击发送）。",
        "steps": steps,
        "draft_text": text[:8000] if text else None,
        "computer_use_template": (
            f"用户已批准向 {label} 发送一条消息；"
            "仅在用户明确指示且窗口已打开时，协助定位输入框；"
            "必须由用户本人完成发送确认，不得自动提交。"
        ),
    }


def _playbook_read_org_dingtalk(params: Dict[str, Any]) -> Dict[str, Any]:
    _ = params
    return {
        "goal_hint": "查看钉钉组织架构或成员可见信息（仅人工在管理后台或已授权客户端操作）。",
        "steps": [
            "使用具有权限的钉钉账号登录管理后台或客户端「通讯录」。",
            "按需在界面上搜索部门/成员；不要将完整通讯录导出给未授权方。",
            "将本次任务需要的少量结构化信息（如部门名、人数）口述或复制给 Agent。",
        ],
        "computer_use_template": (
            "仅在用户已登录钉钉且自行导航到通讯录/管理视图的前提下，协助阅读当前屏幕可见的组织信息；"
            "不要尝试突破权限或批量导出。"
        ),
    }


def _playbook_calendar_write_dingtalk(params: Dict[str, Any]) -> Dict[str, Any]:
    title = str(params.get("title") or "").strip()
    return {
        "goal_hint": "在钉钉日历中创建或更新日程（人工保存）。",
        "steps": [
            "打开钉钉日历，选择正确日历与视图。",
            f"新建或编辑日程：{title or '（请填写标题与时间）'}，核对与会者与提醒。",
            "亲自点击保存；若需同步给其他系统，再复制会议链接或描述给 Agent。",
        ],
        "computer_use_template": (
            "用户需在钉钉日历界面自行创建/编辑事件；"
            "可协助核对表单字段，不得在未确认时代替用户提交。"
        ),
    }


class SemiAutoIMConnector(BaseConnector):
    @property
    def platform_name(self) -> str:
        return _PLATFORM_DISPLAY.get(self.platform_id, self.platform_id)

    @property
    def required_credentials(self) -> List[str]:
        return ["semi_auto_enabled"]

    def validate_credentials(self) -> bool:
        v = self.credentials.get("semi_auto_enabled")
        if v is True:
            return True
        if isinstance(v, str) and v.strip().lower() in ("1", "true", "yes", "on"):
            return True
        return False

    async def verify_connection(self) -> bool:
        if not self.validate_credentials():
            return False
        self.status = ConnectorStatus.CONNECTED
        return True

    async def get_account_info(self) -> Dict[str, Any]:
        return {
            "username": f"{self.platform_name} · 半自动",
            "platform": self.platform_id,
            "mode": "semi_auto",
            "risk_note": "未持有服务端 token；一切发送与登录由用户在本机完成。",
        }

    async def publish_content(
        self,
        content_type: str,
        title: str,
        content: str,
        media_urls: Optional[List[str]] = None,
        options: Optional[Dict[str, Any]] = None,
    ) -> PublishResult:
        return PublishResult(
            success=False,
            platform=self.platform_id,
            error="半自动模式不支持通用 publish_content；请使用平台动作矩阵或 Computer Use 指引。",
            metadata={"content_type": content_type, "title": title[:200] if title else ""},
        )

    async def execute_action(self, action_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
        safe = _safe_params(params or {})
        pid = (self.platform_id or "").lower()
        aid = (action_id or "").strip()

        if aid == "read_visible_chat":
            body = _playbook_read_visible(pid, safe)
        elif aid == "send_message":
            body = _playbook_send_message(pid, safe)
        elif pid == "dingtalk" and aid == "read_org":
            body = _playbook_read_org_dingtalk(safe)
        elif pid == "dingtalk" and aid == "calendar_write":
            body = _playbook_calendar_write_dingtalk(safe)
        else:
            body = {
                "goal_hint": f"在 {_PLATFORM_DISPLAY.get(pid, pid)} 上完成「{aid}」",
                "steps": [
                    "本动作为半自动模式：请在本机客户端内自行完成关键操作。",
                    "将界面状态与任务目标告知 Agent，或复用 Computer Use 在已登录会话中协助。",
                ],
                "computer_use_template": (
                    "仅在用户已手动登录并明确授权的前提下协助界面操作；禁止自动登录或隐蔽发送。"
                ),
            }

        return {
            "success": True,
            "status": "semi_auto_playbook",
            "platform": self.platform_id,
            "action_id": aid,
            "semi_auto": True,
            "params_echo": safe,
            "playbook": body,
            "message": "未执行真实远程自动化；请按 playbook 人工操作或使用 Computer Use（人在回路）。",
        }
