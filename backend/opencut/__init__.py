"""
OpenCut 专业视频编辑器子系统

借鉴 OpenCut classic (https://github.com/opencut-app/opencut-classic) 的设计思想：
- Project -> Scene -> Tracks -> Elements 的层级数据模型
- Command 模式实现剪辑操作的执行与撤销
- TimelineManager 提供统一的编辑 API
- FFmpeg 替代 Rust/WASM 完成渲染与导出
"""

from .models import TProject, TScene, TimelineTrack, TimelineElement, SceneTracks
from .timeline_manager import TimelineManager

__all__ = [
    "TProject",
    "TScene",
    "TimelineTrack",
    "TimelineElement",
    "SceneTracks",
    "TimelineManager",
]
