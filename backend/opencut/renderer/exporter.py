"""
OpenCut FFmpeg 导出器
"""

import os
import shutil
import subprocess
from typing import Any, Dict, List, Optional

from opencut.media_asset import MediaAssetManager
from opencut.models import TProject
from opencut.project_store import ProjectStore
from opencut.renderer.filter_graph import build_ffmpeg_command
from opencut.renderer.scene_builder import build_scene
from utils.logger import setup_logger

logger = setup_logger("opencut_exporter")


def _run_ffmpeg(cmd: List[str]) -> tuple:
    """运行 FFmpeg 命令"""
    try:
        logger.info("[ffmpeg] %s", " ".join(cmd))
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        return True, ""
    except subprocess.CalledProcessError as e:
        err = e.stderr[-1000:] if e.stderr else str(e)
        logger.error("[ffmpeg] export failed: %s", err)
        return False, err


def export_project(
    project: TProject,
    asset_manager: MediaAssetManager,
    output_path: str,
    options: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    导出项目为视频文件
    """
    options = options or {}
    logger.info("export_project options=%s output=%s", options, output_path)

    if not shutil.which("ffmpeg"):
        return {"success": False, "error": "FFmpeg not installed", "local_path": ""}

    width = options.get("width", project.settings.canvas_size.width)
    height = options.get("height", project.settings.canvas_size.height)
    fps = options.get("fps", project.settings.fps.to_float())
    format_name = options.get("format", "mp4")

    if not output_path.endswith(f".{format_name}"):
        output_path += f".{format_name}"

    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)

    # 计算总时长
    scene = project.current_scene()
    total_duration = 1.0
    if scene:
        for track in [scene.tracks.main, *scene.tracks.overlay, *scene.tracks.audio]:
            for el in track.elements:
                total_duration = max(total_duration, el.start_time + el.duration)

    media_assets = {a.asset_id: a for a in asset_manager.list_all()}
    render_tree = build_scene(project, media_assets, is_preview=False)

    cmd = build_ffmpeg_command(
        video_nodes=render_tree.get("video", []),
        audio_nodes=render_tree.get("audio", []),
        background_nodes=render_tree.get("background", []),
        output_path=output_path,
        width=width,
        height=height,
        fps=fps,
        total_duration=total_duration,
    )

    ok, err = _run_ffmpeg(cmd)
    if not ok:
        return {"success": False, "error": err, "local_path": ""}

    project.metadata.duration = total_duration
    project.metadata.thumbnail = output_path

    return {
        "success": True,
        "local_path": output_path,
        "duration": total_duration,
        "width": width,
        "height": height,
    }
