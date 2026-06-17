"""
操作系统级桌面自动化动作模型（元数据与能力映射）。

当前执行仍以 Computer Use（浏览器/页面）与本地文件/Shell 审批为主；本模块定义
「屏幕读取 / 鼠标 / 键盘 / 窗口 / 应用」等原子动作的注册表，供 Agent、能力与排错对齐。

原生 OS 驱动（Accessibility、全局键鼠等）经 native_desktop_service / Sidecar 桥接执行。
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Dict, List, Optional


@dataclass(frozen=True)
class DesktopActionProfile:
    id: str
    name: str
    maps_to_capability: str
    """对应 `core.capabilities.CAPABILITIES` 中的 capability id。"""
    implementation_track: str
    """computer_use_primary：优先走 Computer Use；native_bridge_active：本机 Sidecar/Python 桥。"""
    requires_approval_default: bool
    risk_notes: List[str]
    param_hints: List[str]

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


DESKTOP_ACTION_PROFILES: Dict[str, DesktopActionProfile] = {
    "capture_screen": DesktopActionProfile(
        id="capture_screen",
        name="截屏（桌面或窗口可见区域）",
        maps_to_capability="screen_read",
        implementation_track="computer_use_primary",
        requires_approval_default=False,
        risk_notes=["截屏可能包含敏感信息；仅用于用户授权场景。"],
        param_hints=["region", "window_title_hint", "monitor_index"],
    ),
    "ocr_screen_region": DesktopActionProfile(
        id="ocr_screen_region",
        name="屏幕区域 OCR",
        maps_to_capability="screen_read",
        implementation_track="computer_use_primary",
        requires_approval_default=False,
        risk_notes=["与截屏同级别隐私风险；结果勿外传。"],
        param_hints=["bbox", "language"],
    ),
    "mouse_move": DesktopActionProfile(
        id="mouse_move",
        name="鼠标移动",
        maps_to_capability="mouse_control",
        implementation_track="computer_use_primary",
        requires_approval_default=True,
        risk_notes=["全局鼠标在非浏览器场景需本机桥接；当前以 Computer Use 覆盖网页内控件为主。"],
        param_hints=["x", "y", "relative_to"],
    ),
    "mouse_click": DesktopActionProfile(
        id="mouse_click",
        name="鼠标点击",
        maps_to_capability="mouse_control",
        implementation_track="computer_use_primary",
        requires_approval_default=True,
        risk_notes=["误点可能造成下单或发送；必须审批或人工确认目标控件。"],
        param_hints=["button", "x", "y", "double"],
    ),
    "mouse_scroll": DesktopActionProfile(
        id="mouse_scroll",
        name="滚轮滚动",
        maps_to_capability="mouse_control",
        implementation_track="computer_use_primary",
        requires_approval_default=True,
        risk_notes=[],
        param_hints=["delta_y", "delta_x", "x", "y"],
    ),
    "keyboard_type": DesktopActionProfile(
        id="keyboard_type",
        name="文本输入",
        maps_to_capability="keyboard_input",
        implementation_track="computer_use_primary",
        requires_approval_default=True,
        risk_notes=["可能向错误焦点写入；执行前确认前台应用与输入框。"],
        param_hints=["text", "paste_instead_of_type"],
    ),
    "keyboard_hotkey": DesktopActionProfile(
        id="keyboard_hotkey",
        name="组合键/快捷键",
        maps_to_capability="keyboard_input",
        implementation_track="computer_use_primary",
        requires_approval_default=True,
        risk_notes=["系统级快捷键影响大；高危组合必须显式审批。"],
        param_hints=["keys", "platform_modifiers"],
    ),
    "window_focus": DesktopActionProfile(
        id="window_focus",
        name="窗口前置/聚焦",
        maps_to_capability="mouse_control",
        implementation_track="native_bridge_active",
        requires_approval_default=True,
        risk_notes=["经 native_desktop_service / Sidecar 执行窗口聚焦。"],
        param_hints=["process_name", "window_title_substring", "bundle_id"],
    ),
    "window_list": DesktopActionProfile(
        id="window_list",
        name="枚举可见窗口/应用",
        maps_to_capability="screen_read",
        implementation_track="native_bridge_active",
        requires_approval_default=False,
        risk_notes=["经 native_desktop_service 枚举窗口。"],
        param_hints=["include_minimized"],
    ),
    "app_foreground_state": DesktopActionProfile(
        id="app_foreground_state",
        name="前台应用与焦点状态查询",
        maps_to_capability="screen_read",
        implementation_track="native_bridge_active",
        requires_approval_default=False,
        risk_notes=["经 Sidecar 或 Python 桥读取前台应用。"],
        param_hints=[],
    ),
    "app_launch": DesktopActionProfile(
        id="app_launch",
        name="启动本地应用",
        maps_to_capability="app_launch",
        implementation_track="native_bridge_active",
        requires_approval_default=True,
        risk_notes=["与 local_computer launch_app 一致走审批。"],
        param_hints=["app_id", "argv", "working_dir"],
    ),
}


def list_desktop_action_profiles() -> List[Dict[str, Any]]:
    return [p.to_dict() for p in DESKTOP_ACTION_PROFILES.values()]


def get_desktop_action_profile(action_id: str) -> Optional[Dict[str, Any]]:
    p = DESKTOP_ACTION_PROFILES.get((action_id or "").strip().lower())
    return p.to_dict() if p else None


def plan_desktop_action(action_id: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    返回与能力表一致的规划卡片（不执行）。
    """
    aid = (action_id or "").strip().lower()
    if aid not in DESKTOP_ACTION_PROFILES:
        raise ValueError(f"Unknown desktop action: {action_id}")
    prof = DESKTOP_ACTION_PROFILES[aid]
    safe_params = {k: params[k] for k in list((params or {}).keys())[:24] if isinstance(k, str)}
    track = prof.implementation_track
    return {
        "action_id": aid,
        "profile": prof.to_dict(),
        "capability_id": prof.maps_to_capability,
        "requires_approval": prof.requires_approval_default,
        "params_echo": safe_params,
        "execution_hint": (
            "优先使用 Computer Use 在明确起点的浏览器或在线任务中完成等价操作。"
            if track == "computer_use_primary"
            else "经 native_desktop_service（Sidecar 或 Python 桥）执行；高危动作需审批。"
        ),
    }
