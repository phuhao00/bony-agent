"""
OpenCut 外部运行时适配层（占位实现）

OpenCut (https://github.com/OpenCut-app/OpenCut) 目前重写中，尚未提供
可编程的 Headless API 或 MCP server。本模块预留接口，一旦官方发布
Headless / MCP / CLI 能力，即可在此实现真实调用，无需改动上层 Agent。

当前行为：
- 所有方法返回占位提示，并记录日志。
- 项目文件生成仍通过 opencut_tools.generate_opencut_project 完成。
"""

import os
from typing import Any, Dict, List, Optional

from utils.logger import setup_logger

logger = setup_logger("opencut_bridge")


class OpenCutClient:
    """
    OpenCut 运行时客户端占位类。

    未来可扩展为：
    - HTTP 客户端：调用 opencut serve --headless 暴露的 REST API
    - MCP 客户端：通过 mcp_client 连接 OpenCut MCP server
    - 子进程客户端：调用 opencut-cli 命令行
    """

    def __init__(self, base_url: str = "", mcp_server_name: str = ""):
        self.base_url = base_url or os.getenv("OPENCUT_BASE_URL", "http://localhost:8080")
        self.mcp_server_name = mcp_server_name or os.getenv("OPENCUT_MCP_SERVER", "")
        self._available = False
        logger.info(
            "[OpenCutClient] initialized (placeholder) | base_url=%s mcp=%s",
            self.base_url,
            self.mcp_server_name,
        )

    def healthcheck(self) -> Dict[str, Any]:
        """检查 OpenCut 运行时是否可用"""
        return {
            "available": False,
            "reason": "OpenCut Headless/MCP API 尚未发布，当前为占位实现。",
            "base_url": self.base_url,
        }

    def render_project(self, project_path: str, output_path: str, **kwargs) -> Dict[str, Any]:
        """渲染 OpenCut 项目文件为成片"""
        return {
            "success": False,
            "local_path": "",
            "message": (
                "OpenCut Headless 渲染服务尚未可用。"
                "请先使用 opencut_tools 中的 FFmpeg 工具完成剪辑。"
            ),
            "project_path": project_path,
            "output_path": output_path,
        }

    def list_effects(self) -> List[Dict[str, Any]]:
        """列出 OpenCut 可用特效/转场"""
        return [
            {"id": "fade", "name": "淡入淡出", "available_via_ffmpeg": True},
            {"id": "wipeleft", "name": "向左擦除", "available_via_ffmpeg": True},
            {"id": "zoomin", "name": "放大", "available_via_ffmpeg": True},
            {"id": "blur", "name": "高斯模糊", "available_via_ffmpeg": True},
            {"id": "sepia", "name": "复古", "available_via_ffmpeg": True},
        ]

    def import_project(self, project_path: str) -> Dict[str, Any]:
        """将 OpenCut 项目文件导入当前编辑器"""
        return {
            "success": False,
            "message": "OpenCut 项目导入 API 尚未可用。",
            "project_path": project_path,
        }
