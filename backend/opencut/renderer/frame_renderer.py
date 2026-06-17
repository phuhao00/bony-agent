"""
单帧渲染器

为预览面板生成指定时间的 PNG 帧
"""

import os
import shutil
import subprocess
from typing import Any, Dict, List

from opencut.media_asset import MediaAssetManager
from opencut.models import TProject
from opencut.renderer.filter_graph import build_ffmpeg_command
from opencut.renderer.scene_builder import build_scene
from utils.logger import setup_logger

logger = setup_logger("opencut_frame_renderer")


def render_frame(
    project: TProject,
    asset_manager: MediaAssetManager,
    time: float,
    output_path: str,
    width: int = 640,
    height: int = 360,
) -> Dict[str, Any]:
    """渲染指定时间的单帧"""
    if not shutil.which("ffmpeg"):
        return {"success": False, "error": "FFmpeg not installed", "local_path": ""}

    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)

    media_assets = {a.asset_id: a for a in asset_manager.list_all()}
    render_tree = build_scene(project, media_assets, is_preview=True)

    # 临时导出一段短视频，然后取一帧
    total_duration = max(time + 0.1, 1.0)
    temp_video = output_path.replace(".png", "_temp.mp4")

    cmd = build_ffmpeg_command(
        video_nodes=render_tree.get("video", []),
        audio_nodes=[],  # 预览帧不需要音频
        background_nodes=render_tree.get("background", []),
        output_path=temp_video,
        width=width,
        height=height,
        fps=project.settings.fps.to_float(),
        total_duration=total_duration,
    )

    try:
        subprocess.run(cmd, capture_output=True, check=True)
        # 提取指定时间的帧
        frame_cmd = [
            "ffmpeg", "-y", "-i", temp_video,
            "-ss", str(time), "-vframes", "1",
            "-q:v", "2", output_path,
        ]
        subprocess.run(frame_cmd, capture_output=True, check=True)
        if os.path.exists(temp_video):
            os.remove(temp_video)
        return {"success": True, "local_path": output_path}
    except subprocess.CalledProcessError as e:
        err = e.stderr[-500:] if e.stderr else str(e)
        logger.error("Frame render failed: %s", err)
        return {"success": False, "error": err, "local_path": ""}
