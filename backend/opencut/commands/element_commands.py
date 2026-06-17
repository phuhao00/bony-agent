"""
元素相关命令
"""

import uuid
from typing import Dict, List, Optional

from opencut.models import (
    AudioElement,
    CommandResult,
    EffectElement,
    ElementRef,
    GraphicElement,
    ImageElement,
    RetimeConfig,
    SceneTracks,
    StickerElement,
    TextElement,
    TimelineElement,
    TProject,
    VideoElement,
)

from .base import Command, create_element_selection
from .helpers import (
    can_element_go_on_track,
    deep_copy_tracks,
    find_element,
    find_track,
    find_track_and_index,
    get_scene,
)


def _ensure_element_id(element: TimelineElement, element_id: str) -> TimelineElement:
    """确保元素有 ID"""
    data = element.model_dump(by_alias=True)
    data["id"] = element_id
    return _rebuild_element(data)


def _rebuild_element(data: dict) -> TimelineElement:
    t = data.get("type")
    if t == "video":
        return VideoElement.model_validate(data)
    elif t == "image":
        return ImageElement.model_validate(data)
    elif t == "audio":
        return AudioElement.model_validate(data)
    elif t == "text":
        return TextElement.model_validate(data)
    elif t == "sticker":
        return StickerElement.model_validate(data)
    elif t == "graphic":
        return GraphicElement.model_validate(data)
    elif t == "effect":
        return EffectElement.model_validate(data)
    raise ValueError(f"Unknown element type: {t}")


class InsertElementCommand(Command):
    """插入元素到轨道"""

    def __init__(
        self,
        element: TimelineElement,
        track_id: Optional[str] = None,
        start_time: Optional[float] = None,
    ):
        self.element = element
        self.track_id = track_id
        self.start_time = start_time
        self.element_id = str(uuid.uuid4())
        self.saved_state: Optional[SceneTracks] = None
        self.target_track_id: Optional[str] = None

    def execute(self, project: TProject) -> Optional[CommandResult]:
        scene = get_scene(project)
        self.saved_state = deep_copy_tracks(scene.tracks)

        # 确定目标轨道
        target_track = None
        if self.track_id:
            target_track = find_track(scene.tracks, self.track_id)
        if target_track is None:
            # 自动选择第一个兼容轨道
            candidates = [scene.tracks.main] + list(scene.tracks.overlay)
            for track in candidates:
                if can_element_go_on_track(self.element, track):
                    target_track = track
                    break
            if target_track is None and self.element.type == "audio":
                if scene.tracks.audio:
                    target_track = scene.tracks.audio[0]

        if target_track is None:
            raise ValueError(f"No compatible track for element type {self.element.type}")

        if not can_element_go_on_track(self.element, target_track):
            raise ValueError(f"Element type {self.element.type} cannot go on track type {target_track.type}")

        new_element = _ensure_element_id(self.element, self.element_id)
        if self.start_time is not None:
            new_element.start_time = self.start_time

        target_track.elements.append(new_element)
        # 按 start_time 排序
        target_track.elements.sort(key=lambda e: e.start_time)

        self.target_track_id = target_track.id
        return create_element_selection([ElementRef(track_id=target_track.id, element_id=self.element_id)])

    def undo(self, project: TProject) -> None:
        scene = get_scene(project)
        if self.saved_state:
            scene.tracks = deep_copy_tracks(self.saved_state)


class DeleteElementsCommand(Command):
    """删除元素"""

    def __init__(self, element_refs: List[ElementRef]):
        self.element_refs = element_refs
        self.saved_state: Optional[SceneTracks] = None

    def execute(self, project: TProject) -> Optional[CommandResult]:
        scene = get_scene(project)
        self.saved_state = deep_copy_tracks(scene.tracks)

        ids_to_delete = {ref.element_id for ref in self.element_refs}
        scene.tracks.main.elements = [el for el in scene.tracks.main.elements if el.id not in ids_to_delete]
        for track in scene.tracks.overlay:
            track.elements = [el for el in track.elements if el.id not in ids_to_delete]
        for track in scene.tracks.audio:
            track.elements = [el for el in track.elements if el.id not in ids_to_delete]

        return create_element_selection([])

    def undo(self, project: TProject) -> None:
        scene = get_scene(project)
        if self.saved_state:
            scene.tracks = deep_copy_tracks(self.saved_state)


class MoveElementsCommand(Command):
    """移动元素（时间或轨道）"""

    def __init__(self, moves: List[Dict[str, any]]):
        """
        moves: [{elementId, newTrackId?, newStartTime?}]
        """
        self.moves = moves
        self.saved_state: Optional[SceneTracks] = None

    def execute(self, project: TProject) -> Optional[CommandResult]:
        scene = get_scene(project)
        self.saved_state = deep_copy_tracks(scene.tracks)

        refs: List[ElementRef] = []
        for move in self.moves:
            element_id = move["elementId"]
            el, old_track = find_element(scene.tracks, element_id)
            if el is None or old_track is None:
                continue

            new_track_id = move.get("newTrackId")
            new_start_time = move.get("newStartTime")

            # 更新或移除旧轨道中的元素
            old_track.elements = [e for e in old_track.elements if e.id != element_id]

            if new_track_id:
                new_track = find_track(scene.tracks, new_track_id)
                if new_track and can_element_go_on_track(el, new_track):
                    if new_start_time is not None:
                        el.start_time = float(new_start_time)
                    new_track.elements.append(el)
                    new_track.elements.sort(key=lambda e: e.start_time)
                    refs.append(ElementRef(track_id=new_track.id, element_id=element_id))
                else:
                    # 无法放置，放回旧轨道
                    old_track.elements.append(el)
                    old_track.elements.sort(key=lambda e: e.start_time)
                    refs.append(ElementRef(track_id=old_track.id, element_id=element_id))
            else:
                if new_start_time is not None:
                    el.start_time = float(new_start_time)
                old_track.elements.append(el)
                old_track.elements.sort(key=lambda e: e.start_time)
                refs.append(ElementRef(track_id=old_track.id, element_id=element_id))

        return create_element_selection(refs)

    def undo(self, project: TProject) -> None:
        scene = get_scene(project)
        if self.saved_state:
            scene.tracks = deep_copy_tracks(self.saved_state)


class SplitElementsCommand(Command):
    """在指定时间切割元素"""

    def __init__(self, element_refs: List[ElementRef], split_time: float):
        self.element_refs = element_refs
        self.split_time = split_time
        self.saved_state: Optional[SceneTracks] = None
        self.new_element_ids: List[str] = []

    def execute(self, project: TProject) -> Optional[CommandResult]:
        scene = get_scene(project)
        self.saved_state = deep_copy_tracks(scene.tracks)

        refs: List[ElementRef] = []
        for ref in self.element_refs:
            el, track = find_element(scene.tracks, ref.element_id)
            if el is None or track is None:
                continue

            start = el.start_time
            end = start + el.duration
            if self.split_time <= start or self.split_time >= end:
                continue

            # 计算源时间上的切割点
            source_split = el.trim_start + (self.split_time - start)

            # 左片段
            left_data = el.model_dump(by_alias=True)
            left_data["duration"] = self.split_time - start
            left_data["trim_end"] = el.trim_start + el.duration - self.split_time + start
            left_element = _rebuild_element(left_data)

            # 右片段
            right_id = str(uuid.uuid4())
            right_data = el.model_dump(by_alias=True)
            right_data["id"] = right_id
            right_data["start_time"] = self.split_time
            right_data["duration"] = end - self.split_time
            right_data["trim_start"] = source_split
            right_element = _rebuild_element(right_data)

            # 替换
            track.elements = [e for e in track.elements if e.id != ref.element_id]
            track.elements.extend([left_element, right_element])
            track.elements.sort(key=lambda e: e.start_time)

            refs.append(ElementRef(track_id=track.id, element_id=left_element.id))
            refs.append(ElementRef(track_id=track.id, element_id=right_id))
            self.new_element_ids.extend([left_element.id, right_id])

        return create_element_selection(refs)

    def undo(self, project: TProject) -> None:
        scene = get_scene(project)
        if self.saved_state:
            scene.tracks = deep_copy_tracks(self.saved_state)


class UpdateElementTrimCommand(Command):
    """更新元素裁剪/时间"""

    def __init__(
        self,
        element_ref: ElementRef,
        trim_start: Optional[float] = None,
        trim_end: Optional[float] = None,
        start_time: Optional[float] = None,
        duration: Optional[float] = None,
    ):
        self.element_ref = element_ref
        self.trim_start = trim_start
        self.trim_end = trim_end
        self.start_time = start_time
        self.duration = duration
        self.saved_state: Optional[SceneTracks] = None

    def execute(self, project: TProject) -> Optional[CommandResult]:
        scene = get_scene(project)
        self.saved_state = deep_copy_tracks(scene.tracks)

        el, track = find_element(scene.tracks, self.element_ref.element_id)
        if el is None or track is None:
            return None

        if self.trim_start is not None:
            el.trim_start = max(0.0, float(self.trim_start))
        if self.trim_end is not None:
            el.trim_end = max(0.0, float(self.trim_end))
        if self.start_time is not None:
            el.start_time = float(self.start_time)
        if self.duration is not None:
            el.duration = max(0.0, float(self.duration))

        track.elements.sort(key=lambda e: e.start_time)
        return create_element_selection([ElementRef(track_id=track.id, element_id=el.id)])

    def undo(self, project: TProject) -> None:
        scene = get_scene(project)
        if self.saved_state:
            scene.tracks = deep_copy_tracks(self.saved_state)
