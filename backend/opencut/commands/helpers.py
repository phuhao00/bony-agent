"""
命令模式辅助函数
"""

import copy
from typing import List, Optional, Tuple

from opencut.models import (
    AudioTrack,
    EffectTrack,
    ElementRef,
    GraphicTrack,
    OverlayTrack,
    SceneTracks,
    TextTrack,
    TScene,
    TimelineElement,
    TimelineTrack,
    VideoTrack,
)


def deep_copy_tracks(tracks: SceneTracks) -> SceneTracks:
    """深拷贝轨道状态，用于 undo 快照"""
    return SceneTracks.model_validate_json(tracks.model_dump_json())


def get_scene(project) -> TScene:
    scene = project.current_scene()
    if scene is None:
        raise ValueError("No active scene")
    return scene


def find_track(tracks: SceneTracks, track_id: str) -> Optional[TimelineTrack]:
    if tracks.main.id == track_id:
        return tracks.main
    for track in tracks.overlay:
        if track.id == track_id:
            return track
    for track in tracks.audio:
        if track.id == track_id:
            return track
    return None


def find_track_and_index(tracks: SceneTracks, track_id: str) -> Tuple[Optional[TimelineTrack], str, int]:
    """查找轨道，返回 (track, container_name, index)"""
    if tracks.main.id == track_id:
        return tracks.main, "main", 0
    for i, track in enumerate(tracks.overlay):
        if track.id == track_id:
            return track, "overlay", i
    for i, track in enumerate(tracks.audio):
        if track.id == track_id:
            return track, "audio", i
    return None, "", -1


def find_element(tracks: SceneTracks, element_id: str) -> Tuple[Optional[TimelineElement], Optional[TimelineTrack]]:
    """查找元素及其所在轨道"""
    for track in [tracks.main, *tracks.overlay, *tracks.audio]:
        for el in track.elements:
            if el.id == element_id:
                return el, track
    return None, None


def remove_element_from_tracks(tracks: SceneTracks, element_id: str) -> SceneTracks:
    """从轨道中移除元素，返回新的 tracks"""
    new_tracks = deep_copy_tracks(tracks)
    new_tracks.main.elements = [el for el in new_tracks.main.elements if el.id != element_id]
    for track in new_tracks.overlay:
        track.elements = [el for el in track.elements if el.id != element_id]
    for track in new_tracks.audio:
        track.elements = [el for el in track.elements if el.id != element_id]
    return new_tracks


def build_empty_track(track_type: str, track_id: str = "", name: str = "") -> TimelineTrack:
    """创建空轨道"""
    import uuid
    from opencut.models import AudioTrack, EffectTrack, GraphicTrack, TextTrack, VideoTrack

    track_id = track_id or str(uuid.uuid4())
    if track_type == "video":
        return VideoTrack(id=track_id, name=name or "Video", elements=[])
    elif track_type == "text":
        return TextTrack(id=track_id, name=name or "Text", elements=[])
    elif track_type == "audio":
        return AudioTrack(id=track_id, name=name or "Audio", elements=[])
    elif track_type == "graphic":
        return GraphicTrack(id=track_id, name=name or "Graphic", elements=[])
    elif track_type == "effect":
        return EffectTrack(id=track_id, name=name or "Effect", elements=[])
    raise ValueError(f"Unknown track type: {track_type}")


def can_element_go_on_track(element: TimelineElement, track: TimelineTrack) -> bool:
    """检查元素是否可以放到某轨道"""
    if track.type == "video":
        return element.type in ("video", "image")
    if track.type == "text":
        return element.type == "text"
    if track.type == "audio":
        return element.type == "audio"
    if track.type == "graphic":
        return element.type in ("sticker", "graphic")
    if track.type == "effect":
        return element.type == "effect"
    return False
