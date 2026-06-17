"""
渲染树构建器

参考 OpenCut classic 的 apps/web/src/services/renderer/scene-builder.ts
"""

import os
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Union

from opencut.media_asset import MediaAssetData
from opencut.models import (
    AudioElement,
    AudioTrack,
    EffectTrack,
    GraphicTrack,
    ImageElement,
    SceneTracks,
    TextElement,
    TProject,
    VideoElement,
    VideoTrack,
)
from utils.logger import setup_logger

logger = setup_logger("opencut_scene_builder")


@dataclass
class TransformParams:
    x: float = 0.0  # 归一化 0-1（中心）
    y: float = 0.0
    scale_x: float = 1.0
    scale_y: float = 1.0
    rotation: float = 0.0
    opacity: float = 1.0


@dataclass
class VideoNode:
    type: str = "video"
    file_path: str = ""
    start_time: float = 0.0
    duration: float = 0.0
    trim_start: float = 0.0
    trim_end: float = 0.0
    transform: TransformParams = field(default_factory=TransformParams)
    retime: float = 1.0
    params: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ImageNode:
    type: str = "image"
    file_path: str = ""
    start_time: float = 0.0
    duration: float = 0.0
    transform: TransformParams = field(default_factory=TransformParams)
    params: Dict[str, Any] = field(default_factory=dict)


@dataclass
class TextNode:
    type: str = "text"
    text: str = ""
    start_time: float = 0.0
    duration: float = 0.0
    transform: TransformParams = field(default_factory=TransformParams)
    font_size: int = 48
    font_color: str = "white"
    position: str = "bottom"


@dataclass
class AudioNode:
    type: str = "audio"
    file_path: str = ""
    start_time: float = 0.0
    duration: float = 0.0
    trim_start: float = 0.0
    trim_end: float = 0.0
    volume: float = 1.0
    retime: float = 1.0


@dataclass
class BackgroundNode:
    type: str = "background"
    background_type: str = "color"
    color: str = "#000000"
    blur_intensity: float = 0.0


RenderNode = Union[VideoNode, ImageNode, TextNode, AudioNode, BackgroundNode]


def _get_transform_params(element) -> TransformParams:
    """从 element params 中提取 transform"""
    p = element.params or {}
    return TransformParams(
        x=float(p.get("positionX", p.get("x", 0.5))),
        y=float(p.get("positionY", p.get("y", 0.5))),
        scale_x=float(p.get("scaleX", p.get("scale", 1.0))),
        scale_y=float(p.get("scaleY", p.get("scale", 1.0))),
        rotation=float(p.get("rotation", 0.0)),
        opacity=float(p.get("opacity", 1.0)),
    )


def _element_to_video_node(element: VideoElement, asset: MediaAssetData) -> VideoNode:
    retime = element.retime.rate if element.retime else 1.0
    return VideoNode(
        file_path=asset.file_path if asset else element.media_id,
        start_time=element.start_time,
        duration=element.duration,
        trim_start=element.trim_start,
        trim_end=element.trim_end,
        transform=_get_transform_params(element),
        retime=retime,
        params=dict(element.params or {}),
    )


def _element_to_image_node(element: ImageElement, asset: MediaAssetData) -> ImageNode:
    return ImageNode(
        file_path=asset.file_path if asset else element.media_id,
        start_time=element.start_time,
        duration=element.duration,
        transform=_get_transform_params(element),
        params=dict(element.params or {}),
    )


def _element_to_text_node(element: TextElement) -> TextNode:
    p = element.params or {}
    return TextNode(
        text=str(p.get("text", "OpenCut")),
        start_time=element.start_time,
        duration=element.duration,
        transform=_get_transform_params(element),
        font_size=int(p.get("fontSize", 48)),
        font_color=str(p.get("fontColor", "white")),
        position=str(p.get("position", "bottom")),
    )


def _element_to_audio_node(element: AudioElement, asset: MediaAssetData) -> AudioNode:
    retime = element.retime.rate if element.retime else 1.0
    file_path = asset.file_path if asset else (element.source_url or element.media_id)
    p = element.params or {}
    return AudioNode(
        file_path=file_path,
        start_time=element.start_time,
        duration=element.duration,
        trim_start=element.trim_start,
        trim_end=element.trim_end,
        volume=float(p.get("volume", 1.0)),
        retime=retime,
    )


def build_scene(
    project: TProject,
    media_assets: Dict[str, MediaAssetData],
    is_preview: bool = False,
) -> Dict[str, List[RenderNode]]:
    """
    构建渲染树

    返回:
        {"video": [...], "audio": [...], "background": [...]}
    """
    scene = project.current_scene()
    if scene is None:
        return {"video": [], "audio": [], "background": []}

    tracks = scene.tracks
    width = project.settings.canvas_size.width
    height = project.settings.canvas_size.height

    video_nodes: List[RenderNode] = []
    audio_nodes: List[RenderNode] = []

    # 背景
    background_nodes: List[RenderNode] = []
    bg = project.settings.background
    if hasattr(bg, "type"):
        if bg.type == "color":
            background_nodes.append(BackgroundNode(background_type="color", color=bg.color))
        elif bg.type == "blur":
            background_nodes.append(BackgroundNode(background_type="blur", blur_intensity=bg.blur_intensity))

    # 主轨道（最底层）
    if not tracks.main.hidden:
        for el in tracks.main.elements:
            if el.hidden:
                continue
            asset = media_assets.get(el.media_id) if hasattr(el, "media_id") else None
            if el.type == "video":
                video_nodes.append(_element_to_video_node(el, asset))
            elif el.type == "image":
                video_nodes.append(_element_to_image_node(el, asset))

    # overlay 轨道（上层）
    for track in tracks.overlay:
        if track.hidden:
            continue
        for el in track.elements:
            if el.hidden:
                continue
            if el.type == "video":
                asset = media_assets.get(el.media_id) if hasattr(el, "media_id") else None
                video_nodes.append(_element_to_video_node(el, asset))
            elif el.type == "image":
                asset = media_assets.get(el.media_id) if hasattr(el, "media_id") else None
                video_nodes.append(_element_to_image_node(el, asset))
            elif el.type == "text":
                video_nodes.append(_element_to_text_node(el))
            # sticker/graphic 暂不支持

    # 音频轨道
    for track in tracks.audio:
        if track.muted:
            continue
        for el in track.elements:
            if el.hidden:
                continue
            asset = media_assets.get(el.media_id) if hasattr(el, "media_id") else None
            if el.type == "audio":
                audio_nodes.append(_element_to_audio_node(el, asset))

    # 主轨道元素的音频（如果启用）
    if not tracks.main.muted:
        for el in tracks.main.elements:
            if el.hidden or el.type != "video":
                continue
            if not getattr(el, "is_source_audio_enabled", True):
                continue
            asset = media_assets.get(el.media_id) if hasattr(el, "media_id") else None
            if asset:
                audio_nodes.append(_element_to_audio_node(el, asset))

    video_nodes.sort(key=lambda n: n.start_time)
    audio_nodes.sort(key=lambda n: n.start_time)

    return {
        "video": video_nodes,
        "audio": audio_nodes,
        "background": background_nodes,
    }
