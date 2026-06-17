from dataclasses import asdict, dataclass
from typing import Any, Dict, List, Optional


@dataclass(frozen=True)
class PlatformAction:
    id: str
    name: str
    capability_id: str
    risk_level: str
    requires_approval: bool
    supported: bool
    notes: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class PlatformProfile:
    id: str
    name: str
    category: str
    connection_methods: List[str]
    recommended_method: str
    auth_modes: List[str]
    status: str
    maturity: str
    actions: List[PlatformAction]
    notes: str = ""

    def to_dict(self) -> Dict[str, Any]:
        data = asdict(self)
        data["actions"] = [action.to_dict() for action in self.actions]
        return data


PLATFORM_PROFILES: Dict[str, PlatformProfile] = {
    "feishu": PlatformProfile(
        id="feishu",
        name="飞书 / Lark",
        category="collaboration",
        connection_methods=["official_api", "bot_webhook", "lark_cli", "mcp"],
        recommended_method="official_api",
        auth_modes=["tenant_access_token", "user_oauth", "webhook_secret"],
        status="planned",
        maturity="priority",
        notes="优先接入消息、文档、日历、多维表格；写入/发送类动作必须审批。",
        actions=[
            PlatformAction("read_messages", "Read messages", "platform_read", "medium", False, True),
            PlatformAction("send_message", "Send message", "platform_message", "high", True, True),
            PlatformAction(
                "read_docs",
                "Read docs",
                "platform_read",
                "medium",
                False,
                True,
                notes="raw_content；可选 include_blocks=1 拉块 id/类型/文本摘要（blocks_page_size、blocks_max_pages、blocks_full、续页 blocks_page_token）",
            ),
            PlatformAction(
                "write_docs",
                "Write docs",
                "platform_message",
                "high",
                True,
                True,
                notes="追加段落或新建 docx；批量更新块：batch_updates（简化 text/segments）或原生 requests，≤200/次、块 ID 不可重复",
            ),
            PlatformAction("calendar_read", "Read calendar", "platform_read", "medium", False, True),
            PlatformAction("calendar_write", "Create or update calendar events", "platform_message", "high", True, True),
            PlatformAction("base_read", "Read Base records", "platform_read", "medium", False, True),
            PlatformAction("base_write", "Write Base records", "platform_message", "high", True, True),
        ],
    ),
    "discord": PlatformProfile(
        id="discord",
        name="Discord",
        category="community",
        connection_methods=["official_api", "bot_token", "webhook", "mcp"],
        recommended_method="official_api",
        auth_modes=["bot_token", "webhook_url", "oauth"],
        status="planned",
        maturity="next",
        notes="优先接入频道读取、消息发送、频道管理；管理类动作需要审批。",
        actions=[
            PlatformAction("read_channels", "Read channels", "platform_read", "medium", False, True),
            PlatformAction("send_message", "Send message", "platform_message", "high", True, True),
            PlatformAction("manage_channels", "Manage channels", "platform_message", "high", True, True),
        ],
    ),
    "wechat": PlatformProfile(
        id="wechat",
        name="微信",
        category="messaging",
        connection_methods=["desktop_rpa", "browser_rpa", "semi_auto_playbook", "official_account_api"],
        recommended_method="desktop_rpa",
        auth_modes=["qr_session", "official_account_token"],
        status="planned",
        maturity="guarded",
        notes="个人微信优先半自动模式（Connector：`SemiAutoIMConnector`，凭证 `semi_auto_enabled`）；避免不可控登录态和自动群发风险。",
        actions=[
            PlatformAction("read_visible_chat", "Read visible chat", "screen_read", "medium", False, True),
            PlatformAction("send_message", "Send message", "platform_message", "high", True, True),
        ],
    ),
    "qq": PlatformProfile(
        id="qq",
        name="QQ",
        category="messaging",
        connection_methods=["desktop_rpa", "browser_rpa", "semi_auto_playbook"],
        recommended_method="desktop_rpa",
        auth_modes=["qr_session"],
        status="planned",
        maturity="guarded",
        notes="优先 `semi_auto_enabled` 半自动 playbook；发送类动作必须审批。",
        actions=[
            PlatformAction("read_visible_chat", "Read visible chat", "screen_read", "medium", False, True),
            PlatformAction("send_message", "Send message", "platform_message", "high", True, True),
        ],
    ),
    "dingtalk": PlatformProfile(
        id="dingtalk",
        name="钉钉",
        category="collaboration",
        connection_methods=["official_api", "bot_webhook", "desktop_rpa", "semi_auto_playbook"],
        recommended_method="official_api",
        auth_modes=["app_key_secret", "robot_webhook", "oauth"],
        status="planned",
        maturity="next",
        notes="官方 API/机器人未配置时可启用半自动 playbook；写入类仍走审批。",
        actions=[
            PlatformAction("send_message", "Send message", "platform_message", "high", True, True),
            PlatformAction("read_org", "Read organization", "platform_read", "medium", False, True),
            PlatformAction("calendar_write", "Create calendar events", "platform_message", "high", True, True),
        ],
    ),
}


def list_platform_profiles(connector_statuses: Optional[List[Dict[str, Any]]] = None) -> List[Dict[str, Any]]:
    connector_by_id = {item.get("platform_id"): item for item in (connector_statuses or [])}
    profiles: List[Dict[str, Any]] = []
    for profile in PLATFORM_PROFILES.values():
        item = profile.to_dict()
        connector = connector_by_id.get(profile.id)
        if connector:
            item["connector_status"] = connector.get("status")
            item["connected"] = bool(connector.get("connected"))
            item["has_credentials"] = bool(connector.get("has_credentials"))
        else:
            item["connector_status"] = "not_implemented"
            item["connected"] = False
            item["has_credentials"] = False
        profiles.append(item)
    return profiles


def get_platform_profile(platform_id: str, connector_status: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
    profile = PLATFORM_PROFILES.get(platform_id)
    if not profile:
        return None
    connector_statuses = [connector_status] if connector_status else None
    return list_platform_profiles(connector_statuses=connector_statuses)[0]