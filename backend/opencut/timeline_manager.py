"""
OpenCut TimelineManager

参考 OpenCut classic 的 apps/web/src/core/managers/timeline-manager.ts
"""

import copy
from typing import Any, Dict, List, Optional

from opencut.commands import (
    AddTrackCommand,
    BatchCommand,
    Command,
    DeleteElementsCommand,
    InsertElementCommand,
    MoveElementsCommand,
    RemoveTrackCommand,
    SplitElementsCommand,
    ToggleTrackMuteCommand,
    ToggleTrackVisibilityCommand,
    UpdateElementTrimCommand,
)
from opencut.commands.base import CommandResult
from opencut.models import ElementRef, SceneTracks, TProject
from utils.logger import setup_logger

logger = setup_logger("opencut_timeline_manager")


class TimelineManager:
    """时间轴管理器"""

    def __init__(self, project: TProject):
        self.project = project
        self.command_history: List[Command] = []
        self.redo_stack: List[Command] = []

    # ------------------------------------------------------------------
    # 内部辅助
    # ------------------------------------------------------------------
    def _get_scene(self):
        scene = self.project.current_scene()
        if scene is None:
            raise ValueError("No active scene")
        return scene

    def _execute(self, command: Command) -> Optional[CommandResult]:
        result = command.execute(self.project)
        self.command_history.append(command)
        self.redo_stack.clear()
        return result

    def undo(self) -> Optional[CommandResult]:
        if not self.command_history:
            return None
        command = self.command_history.pop()
        command.undo(self.project)
        self.redo_stack.append(command)
        return None

    def redo(self) -> Optional[CommandResult]:
        if not self.redo_stack:
            return None
        command = self.redo_stack.pop()
        result = command.redo(self.project)
        self.command_history.append(command)
        return result

    # ------------------------------------------------------------------
    # Track 操作
    # ------------------------------------------------------------------
    def add_track(self, track_type: str, index: Optional[int] = None):
        return self._execute(AddTrackCommand(track_type=track_type, index=index))

    def remove_track(self, track_id: str):
        return self._execute(RemoveTrackCommand(track_id=track_id))

    def toggle_track_mute(self, track_id: str):
        return self._execute(ToggleTrackMuteCommand(track_id=track_id))

    def toggle_track_visibility(self, track_id: str):
        return self._execute(ToggleTrackVisibilityCommand(track_id=track_id))

    # ------------------------------------------------------------------
    # Element 操作
    # ------------------------------------------------------------------
    def insert_element(
        self,
        element: Any,
        track_id: Optional[str] = None,
        start_time: Optional[float] = None,
    ):
        return self._execute(InsertElementCommand(element=element, track_id=track_id, start_time=start_time))

    def delete_elements(self, element_refs: List[ElementRef]):
        return self._execute(DeleteElementsCommand(element_refs=element_refs))

    def move_elements(self, moves: List[Dict[str, Any]]):
        return self._execute(MoveElementsCommand(moves=moves))

    def split_elements(self, element_refs: List[ElementRef], split_time: float):
        return self._execute(SplitElementsCommand(element_refs=element_refs, split_time=split_time))

    def duplicate_elements(self, element_refs: List[ElementRef]):
        # TODO: implement duplicate
        raise NotImplementedError("Duplicate not yet implemented")

    def update_element_trim(
        self,
        element_ref: ElementRef,
        trim_start: Optional[float] = None,
        trim_end: Optional[float] = None,
        start_time: Optional[float] = None,
        duration: Optional[float] = None,
    ):
        return self._execute(
            UpdateElementTrimCommand(
                element_ref=element_ref,
                trim_start=trim_start,
                trim_end=trim_end,
                start_time=start_time,
                duration=duration,
            )
        )

    def update_elements(self, updates: List[Dict[str, Any]]):
        """批量通用更新"""
        commands: List[Command] = []
        for update in updates:
            ref_data = update.get("elementRef") or update.get("element_ref")
            ref = ElementRef.model_validate(ref_data)
            commands.append(
                UpdateElementTrimCommand(
                    element_ref=ref,
                    trim_start=update.get("trimStart"),
                    trim_end=update.get("trimEnd"),
                    start_time=update.get("startTime"),
                    duration=update.get("duration"),
                )
            )
        return self._execute(BatchCommand(commands))

    # ------------------------------------------------------------------
    # 查询
    # ------------------------------------------------------------------
    def get_total_duration(self) -> float:
        scene = self._get_scene()
        total = 0.0
        for track in [scene.tracks.main, *scene.tracks.overlay, *scene.tracks.audio]:
            for el in track.elements:
                total = max(total, el.start_time + el.duration)
        return total

    def get_last_frame_time(self) -> float:
        return self.get_total_duration()

    def get_track_by_id(self, track_id: str):
        scene = self._get_scene()
        from opencut.commands.helpers import find_track
        return find_track(scene.tracks, track_id)

    def get_element_by_id(self, element_id: str):
        scene = self._get_scene()
        from opencut.commands.helpers import find_element
        return find_element(scene.tracks, element_id)

    def update_project_duration(self):
        """根据轨道内容更新项目时长"""
        duration = self.get_total_duration()
        self.project.metadata.duration = max(duration, 1.0)
