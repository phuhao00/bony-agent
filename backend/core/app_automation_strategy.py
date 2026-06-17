"""Resolve automation strategy for desktop applications."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Dict, List, Optional

from core.creative_software import CREATIVE_APP_PROFILES, get_creative_app_profile
from core.desktop_app_registry import get_desktop_app

CLI_MODES: Dict[str, List[str]] = {
    "blender": ["blender_batch_python", "batch_python", "python", "blender_batch_render", "batch_render", "render"],
    "unity": ["unity_batch_method", "batch_method", "batch"],
    "unreal": ["unreal_editor_headless", "headless", "pythonscript"],
    "photoshop": ["photoshop_extendscript", "jsx", "extendscript"],
}

OS_SCRIPT_APPS: Dict[str, List[str]] = {
    "photoshop": ["export_png", "activate"],
    "finder": ["batch_rename"],
}


@dataclass
class StrategyResult:
    app_id: str
    strategy: str
    reason: str
    suggested_modes: List[str]
    profile: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def list_automation_modes(app_id: str) -> List[str]:
    aid = (app_id or "").strip().lower()
    modes: List[str] = []
    if aid in CLI_MODES:
        modes.extend(CLI_MODES[aid])
    if aid in OS_SCRIPT_APPS:
        modes.extend([f"os_script_{m}" for m in OS_SCRIPT_APPS[aid]])
    modes.extend(["generic_launch", "generic_gui"])
    return modes


def resolve_strategy(app_id: str, user_goal: str = "", *, mode: str = "") -> StrategyResult:
    aid = (app_id or "").strip().lower()
    goal = (user_goal or "").lower()
    m = (mode or "").strip().lower().replace("-", "_")

    profile = get_creative_app_profile(aid)
    app_entry = get_desktop_app(aid)

    if m.startswith("os_script") or (aid in OS_SCRIPT_APPS and any(k in goal for k in ("导出", "export", "applescript"))):
        return StrategyResult(
            app_id=aid,
            strategy="os_script",
            reason="App has OS script templates or mode requests os_script",
            suggested_modes=[f"os_script_{x}" for x in OS_SCRIPT_APPS.get(aid, ["generic"])],
            profile=profile or app_entry,
        )

    if aid in CREATIVE_APP_PROFILES:
        cli_modes = CLI_MODES.get(aid, [])
        if m in cli_modes or any(k in goal for k in ("批处理", "batch", "脚本", "script", "渲染", "render", "jsx", "python")):
            return StrategyResult(
                app_id=aid,
                strategy="cli_batch",
                reason="Creative/DCC app with CLI batch profile",
                suggested_modes=cli_modes,
                profile=profile,
            )

    if m in ("generic_launch", "launch"):
        return StrategyResult(
            app_id=aid,
            strategy="launch_only",
            reason="Launch application only",
            suggested_modes=["generic_launch"],
            profile=app_entry,
        )

    if m in ("generic_gui", "gui", "gui_native") or aid not in CREATIVE_APP_PROFILES:
        return StrategyResult(
            app_id=aid,
            strategy="gui_native",
            reason="No CLI profile; use native GUI automation",
            suggested_modes=["generic_gui"],
            profile=app_entry or profile,
        )

    return StrategyResult(
        app_id=aid,
        strategy="cli_batch",
        reason="Default to CLI when creative profile exists",
        suggested_modes=CLI_MODES.get(aid, ["generic_gui"]),
        profile=profile,
    )
