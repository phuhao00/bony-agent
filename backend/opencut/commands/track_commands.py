"""
轨道相关命令
"""

from typing import Optional

from opencut.models import CommandResult, SceneTracks, TProject

from .base import Command
from .helpers import build_empty_track, deep_copy_tracks, find_track_and_index, get_scene


class AddTrackCommand(Command):
    """添加轨道"""

    def __init__(self, track_type: str, index: Optional[int] = None):
        import uuid
        self.track_type = track_type
        self.index = index
        self.track_id = str(uuid.uuid4())
        self.saved_state: Optional[SceneTracks] = None

    def execute(self, project: TProject) -> Optional[CommandResult]:
        scene = get_scene(project)
        self.saved_state = deep_copy_tracks(scene.tracks)

        new_track = build_empty_track(self.track_type, self.track_id)
        tracks = scene.tracks

        if self.track_type == "audio":
            idx = self.index if self.index is not None else len(tracks.audio)
            idx = max(0, min(idx, len(tracks.audio)))
            tracks.audio.insert(idx, new_track)
        else:
            idx = self.index if self.index is not None else len(tracks.overlay)
            idx = max(0, min(idx, len(tracks.overlay)))
            tracks.overlay.insert(idx, new_track)

        return None

    def undo(self, project: TProject) -> None:
        scene = get_scene(project)
        if self.saved_state:
            scene.tracks = deep_copy_tracks(self.saved_state)


class RemoveTrackCommand(Command):
    """删除轨道"""

    def __init__(self, track_id: str):
        self.track_id = track_id
        self.saved_state: Optional[SceneTracks] = None

    def execute(self, project: TProject) -> Optional[CommandResult]:
        scene = get_scene(project)
        self.saved_state = deep_copy_tracks(scene.tracks)

        track, container, idx = find_track_and_index(scene.tracks, self.track_id)
        if track is None:
            return None

        # 不能删除主轨道
        if container == "main":
            raise ValueError("Cannot remove main track")

        if container == "overlay":
            scene.tracks.overlay.pop(idx)
        elif container == "audio":
            scene.tracks.audio.pop(idx)

        return None

    def undo(self, project: TProject) -> None:
        scene = get_scene(project)
        if self.saved_state:
            scene.tracks = deep_copy_tracks(self.saved_state)


class ToggleTrackMuteCommand(Command):
    """切换轨道静音"""

    def __init__(self, track_id: str):
        self.track_id = track_id
        self.saved_state: Optional[SceneTracks] = None

    def execute(self, project: TProject) -> Optional[CommandResult]:
        scene = get_scene(project)
        self.saved_state = deep_copy_tracks(scene.tracks)
        track, _, _ = find_track_and_index(scene.tracks, self.track_id)
        if track and hasattr(track, "muted"):
            track.muted = not track.muted
        return None

    def undo(self, project: TProject) -> None:
        scene = get_scene(project)
        if self.saved_state:
            scene.tracks = deep_copy_tracks(self.saved_state)


class ToggleTrackVisibilityCommand(Command):
    """切换轨道可见性"""

    def __init__(self, track_id: str):
        self.track_id = track_id
        self.saved_state: Optional[SceneTracks] = None

    def execute(self, project: TProject) -> Optional[CommandResult]:
        scene = get_scene(project)
        self.saved_state = deep_copy_tracks(scene.tracks)
        track, _, _ = find_track_and_index(scene.tracks, self.track_id)
        if track and hasattr(track, "hidden"):
            track.hidden = not track.hidden
        return None

    def undo(self, project: TProject) -> None:
        scene = get_scene(project)
        if self.saved_state:
            scene.tracks = deep_copy_tracks(self.saved_state)
