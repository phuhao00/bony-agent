"""Rule-based action suggestions for System Assistant."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from core.app_catalog import list_apps
from core.system_environment import build_environment_profile, get_server_platform


def _check_failed(checks: List[Dict[str, Any]], name: str) -> bool:
    for c in checks:
        if c.get("name") == name and not c.get("success"):
            return True
    return False


def _missing_dev_tools(dev_tools: List[Dict[str, Any]]) -> List[str]:
    missing: List[str] = []
    for entry in dev_tools:
        cmd = (entry.get("command") or "").lower()
        if entry.get("success"):
            continue
        if "node" in cmd:
            missing.append("node")
        elif "python" in cmd:
            missing.append("python")
        elif "git" in cmd:
            missing.append("git")
    return missing


def build_suggestions(
    diagnostics: Optional[Dict[str, Any]] = None,
    environment: Optional[Dict[str, Any]] = None,
    *,
    computer_roots: Optional[List[Dict[str, Any]]] = None,
) -> List[Dict[str, Any]]:
    environment = environment or build_environment_profile()
    diagnostics = diagnostics or {}
    checks = diagnostics.get("checks") or []
    dev_tools = diagnostics.get("dev_tools") or []
    caps = environment.get("capabilities") or {}
    paths = environment.get("default_paths") or {}
    platform = environment.get("server_platform") or get_server_platform()

    suggestions: List[Dict[str, Any]] = []
    priority = 0

    def add(
        *,
        sid: str,
        title: str,
        description: str,
        recipe_id: str,
        params: Optional[Dict[str, Any]] = None,
        category: str,
        reason: str,
    ) -> None:
        nonlocal priority
        priority += 1
        suggestions.append(
            {
                "id": sid,
                "title": title,
                "description": description,
                "recipe_id": recipe_id,
                "params": params or {},
                "category": category,
                "priority": priority,
                "reason": reason,
            }
        )

    if _check_failed(checks, "ping"):
        add(
            sid="network-diagnose-ping",
            title="网络连通性诊断",
            description="Ping 失败，运行完整网络诊断",
            recipe_id="network.diagnose",
            category="network",
            reason="ping 检查未通过",
        )
    elif _check_failed(checks, "dns"):
        add(
            sid="network-diagnose-dns",
            title="DNS 解析诊断",
            description="DNS 解析异常，检查网络配置",
            recipe_id="network.diagnose",
            category="network",
            reason="DNS 检查未通过",
        )

    if platform in {"darwin", "win32"} and caps.get("network"):
        add(
            sid="network-flush-dns",
            title="刷新 DNS 缓存",
            description="清除本地 DNS 缓存，解决部分访问异常",
            recipe_id="network.flush_dns",
            category="network",
            reason="常用网络修复步骤",
        )

    missing = _missing_dev_tools(dev_tools)
    if missing or not dev_tools:
        add(
            sid="env-check",
            title="检查开发环境",
            description="检测 node、python、git 是否已安装",
            recipe_id="env.check_dev_tools",
            category="env",
            reason="开发工具状态未知或存在缺失",
        )
    for tool in missing[:3]:
        if caps.get("install"):
            add(
                sid=f"env-install-{tool}",
                title=f"安装 {tool}",
                description=f"通过包管理器安装 {tool}",
                recipe_id="env.install_dev_tool",
                params={"tool": tool},
                category="env",
                reason=f"{tool} 未检测到",
            )

    if caps.get("install"):
        apps = list_apps()[:4]
        for app in apps:
            add(
                sid=f"install-{app['id']}",
                title=f"安装 {app.get('name', app['id'])}",
                description=app.get("category", "应用"),
                recipe_id=environment.get("install_recipe_id") or "install.brew_cask",
                params={"app_id": app["id"]},
                category="install",
                reason="常用应用快捷安装",
            )

    organize_path = None
    if computer_roots:
        organize_path = computer_roots[0].get("path") or computer_roots[0].get("root_path")
    if not organize_path:
        organize_path = paths.get("downloads_path")

    if organize_path and caps.get("organize"):
        add(
            sid="organize-downloads",
            title="整理下载文件夹",
            description=f"预览整理：{organize_path}",
            recipe_id="organize.preview",
            params={"root_path": organize_path},
            category="organize",
            reason="保持下载目录整洁",
        )
        add(
            sid="organize-images",
            title="整理文件夹图片",
            description="按格式/日期/大小预览图片分类方案",
            recipe_id="organize.images_preview",
            params={"root_path": organize_path, "mode": "by_format"},
            category="organize",
            reason="批量归类散落图片",
        )
        add(
            sid="organize-images-exif",
            title="按拍摄日期整理图片",
            description="读取 EXIF 拍摄时间并按月归档",
            recipe_id="organize.images_preview",
            params={"root_path": organize_path, "mode": "by_exif_date"},
            category="organize",
            reason="照片按真实拍摄时间归类",
        )
        add(
            sid="dedupe-images",
            title="图片去重",
            description="检测重复图片并移至 Duplicates/ 子目录",
            recipe_id="organize.dedupe_images",
            params={"root_path": organize_path},
            category="organize",
            reason="释放重复照片占用空间",
        )
        add(
            sid="compress-images",
            title="批量压缩图片",
            description="将图片压缩为 JPEG 副本，保留原图",
            recipe_id="organize.compress_images",
            params={"root_path": organize_path, "quality": 80, "max_width": 1920},
            category="organize",
            reason="节省磁盘空间",
        )
        if caps.get("media_organize"):
            add(
                sid="images-to-video",
                title="图片制作幻灯片视频",
                description="将文件夹内图片合成为 MP4 幻灯片",
                recipe_id="organize.images_to_video",
                params={"root_path": organize_path, "duration_per_image": 3},
                category="organize",
                reason="快速生成相册视频",
            )

    if not diagnostics.get("checks") and not diagnostics.get("dev_tools"):
        add(
            sid="quick-diagnostics",
            title="一键环境诊断",
            description="检测网络连通性与开发工具",
            recipe_id="network.diagnose",
            category="network",
            reason="尚未运行诊断",
        )

    return suggestions
