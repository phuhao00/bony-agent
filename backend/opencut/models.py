"""
OpenCut 风格数据模型

参考 OpenCut classic 的 TypeScript 类型：
- apps/web/src/project/types.ts
- apps/web/src/timeline/types.ts
- apps/web/src/effects/types.ts
- apps/web/src/masks/types.ts
- apps/web/src/animation/types.ts

所有 MediaTime 用 float 秒表示（OpenCut 原版用 120_000 ticks/second 整数）。
"""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, field_validator


# ------------------------------------------------------------------
# 基础类型
# ------------------------------------------------------------------
MediaTime = float
ParamValue = Union[float, str, bool]
ParamValues = Dict[str, ParamValue]


class FrameRate(BaseModel):
    """帧率，参考 OpenCut 的 FrameRate"""
    numerator: int = 30
    denominator: int = 1

    def to_float(self) -> float:
        return self.numerator / self.denominator


class TCanvasSize(BaseModel):
    width: int = 1280
    height: int = 720


class TBackgroundColor(BaseModel):
    type: Literal["color"] = "color"
    color: str = "#000000"


class TBackgroundBlur(BaseModel):
    type: Literal["blur"] = "blur"
    blur_intensity: float = Field(10.0, alias="blurIntensity")


TBackground = Union[TBackgroundColor, TBackgroundBlur]


# ------------------------------------------------------------------
# 项目元数据与设置
# ------------------------------------------------------------------
class TProjectMetadata(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str = "New project"
    thumbnail: Optional[str] = None
    duration: MediaTime = 0.0
    created_at: datetime = Field(default_factory=datetime.utcnow, alias="createdAt")
    updated_at: datetime = Field(default_factory=datetime.utcnow, alias="updatedAt")


class TTimelineViewState(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    zoom_level: float = Field(1.0, alias="zoomLevel")
    scroll_left: float = Field(0.0, alias="scrollLeft")
    playhead_time: MediaTime = Field(0.0, alias="playheadTime")


class TProjectSettings(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    fps: FrameRate = Field(default_factory=FrameRate)
    canvas_size: TCanvasSize = Field(default_factory=TCanvasSize, alias="canvasSize")
    canvas_size_mode: Optional[Literal["preset", "custom"]] = Field("preset", alias="canvasSizeMode")
    last_custom_canvas_size: Optional[TCanvasSize] = Field(None, alias="lastCustomCanvasSize")
    original_canvas_size: Optional[TCanvasSize] = Field(None, alias="originalCanvasSize")
    background: TBackground = Field(default_factory=TBackgroundColor)


# ------------------------------------------------------------------
# 关键帧与动画
# ------------------------------------------------------------------
class CurveHandle(BaseModel):
    dt: MediaTime = 0.0
    dv: float = 0.0


class ScalarAnimationKey(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    time: MediaTime = 0.0  # relative to element start time
    value: float = 0.0
    left_handle: Optional[CurveHandle] = Field(None, alias="leftHandle")
    right_handle: Optional[CurveHandle] = Field(None, alias="rightHandle")
    segment_to_next: Literal["step", "linear", "bezier"] = Field("linear", alias="segmentToNext")
    tangent_mode: Literal["auto", "aligned", "broken", "flat"] = Field("auto", alias="tangentMode")


class DiscreteAnimationKey(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    time: MediaTime = 0.0
    value: Union[str, bool]


class ScalarChannel(BaseModel):
    keys: List[ScalarAnimationKey] = Field(default_factory=list)
    extrapolation_before: Literal["hold", "linear"] = Field("hold", alias="extrapolationBefore")
    extrapolation_after: Literal["hold", "linear"] = Field("hold", alias="extrapolationAfter")


class DiscreteChannel(BaseModel):
    keys: List[DiscreteAnimationKey] = Field(default_factory=list)


Channel = Union[ScalarChannel, DiscreteChannel]
ElementAnimations = Dict[str, Optional[Channel]]


# ------------------------------------------------------------------
# 特效 (Effect)
# ------------------------------------------------------------------
class Effect(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    type: str
    params: ParamValues = Field(default_factory=dict)
    enabled: bool = True


class EffectDefinition(BaseModel):
    type: str
    name: str
    keywords: List[str] = Field(default_factory=list)
    params: List[Dict[str, Any]] = Field(default_factory=list)


# ------------------------------------------------------------------
# 遮罩 (Mask)
# ------------------------------------------------------------------
class BaseMaskParams(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    feather: float = 0.0
    inverted: bool = False
    stroke_color: str = Field("#ffffff", alias="strokeColor")
    stroke_width: float = Field(0.0, alias="strokeWidth")
    stroke_align: Literal["inside", "center", "outside"] = Field("center", alias="strokeAlign")


class RectangleMaskParams(BaseMaskParams):
    center_x: float = Field(0.5, alias="centerX")
    center_y: float = Field(0.5, alias="centerY")
    width: float = 0.5
    height: float = 0.5
    rotation: float = 0.0
    scale: float = 1.0


class TextMaskParams(BaseMaskParams):
    content: str = "A"
    font_size: float = Field(48.0, alias="fontSize")
    font_family: str = Field("Arial", alias="fontFamily")
    center_x: float = Field(0.5, alias="centerX")
    center_y: float = Field(0.5, alias="centerY")
    rotation: float = 0.0
    scale: float = 1.0


class FreeformPathPoint(BaseModel):
    x: float = 0.0
    y: float = 0.0


class FreeformMaskParams(BaseMaskParams):
    path: List[FreeformPathPoint] = Field(default_factory=list)
    closed: bool = True
    center_x: float = Field(0.5, alias="centerX")
    center_y: float = Field(0.5, alias="centerY")
    rotation: float = 0.0
    scale: float = 1.0


class SplitMask(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    type: Literal["split"] = "split"
    params: RectangleMaskParams


class CinematicBarsMask(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    type: Literal["cinematic-bars"] = "cinematic-bars"
    params: RectangleMaskParams


class RectangleMask(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    type: Literal["rectangle"] = "rectangle"
    params: RectangleMaskParams


class EllipseMask(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    type: Literal["ellipse"] = "ellipse"
    params: RectangleMaskParams


class HeartMask(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    type: Literal["heart"] = "heart"
    params: RectangleMaskParams


class DiamondMask(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    type: Literal["diamond"] = "diamond"
    params: RectangleMaskParams


class StarMask(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    type: Literal["star"] = "star"
    params: RectangleMaskParams


class TextMask(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    type: Literal["text"] = "text"
    params: TextMaskParams


class FreeformMask(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    type: Literal["freeform"] = "freeform"
    params: FreeformMaskParams


Mask = Union[
    SplitMask,
    CinematicBarsMask,
    RectangleMask,
    EllipseMask,
    HeartMask,
    DiamondMask,
    StarMask,
    TextMask,
    FreeformMask,
]


# ------------------------------------------------------------------
# 元素 (Element)
# ------------------------------------------------------------------
class RetimeConfig(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    rate: float = 1.0
    maintain_pitch: bool = Field(True, alias="maintainPitch")


class BaseTimelineElement(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str = "Element"
    duration: MediaTime = 5.0
    start_time: MediaTime = Field(0.0, alias="startTime")
    trim_start: MediaTime = Field(0.0, alias="trimStart")
    trim_end: MediaTime = Field(0.0, alias="trimEnd")
    source_duration: Optional[MediaTime] = Field(None, alias="sourceDuration")
    animations: Optional[ElementAnimations] = Field(None, alias="animations")
    params: ParamValues = Field(default_factory=dict, alias="params")

    @field_validator("duration", "start_time", "trim_start", "trim_end", mode="before")
    @classmethod
    def ensure_float_time(cls, v):
        return float(v) if v is not None else 0.0


class VideoElement(BaseTimelineElement):
    type: Literal["video"] = "video"
    media_id: str = Field("", alias="mediaId")
    is_source_audio_enabled: bool = Field(True, alias="isSourceAudioEnabled")
    hidden: bool = False
    retime: Optional[RetimeConfig] = None
    effects: List[Effect] = Field(default_factory=list)
    masks: List[Mask] = Field(default_factory=list)


class ImageElement(BaseTimelineElement):
    type: Literal["image"] = "image"
    media_id: str = Field("", alias="mediaId")
    hidden: bool = False
    effects: List[Effect] = Field(default_factory=list)
    masks: List[Mask] = Field(default_factory=list)


class AudioElement(BaseTimelineElement):
    type: Literal["audio"] = "audio"
    media_id: str = Field("", alias="mediaId")
    source_url: Optional[str] = Field(None, alias="sourceUrl")
    source_type: Literal["upload", "library"] = Field("upload", alias="sourceType")
    hidden: bool = False
    retime: Optional[RetimeConfig] = None


class TextElement(BaseTimelineElement):
    type: Literal["text"] = "text"
    hidden: bool = False
    effects: List[Effect] = Field(default_factory=list)


class StickerElement(BaseTimelineElement):
    type: Literal["sticker"] = "sticker"
    sticker_id: str = Field("", alias="stickerId")
    intrinsic_width: Optional[float] = Field(None, alias="intrinsicWidth")
    intrinsic_height: Optional[float] = Field(None, alias="intrinsicHeight")
    hidden: bool = False
    effects: List[Effect] = Field(default_factory=list)


class GraphicElement(BaseTimelineElement):
    type: Literal["graphic"] = "graphic"
    definition_id: str = Field("", alias="definitionId")
    hidden: bool = False
    effects: List[Effect] = Field(default_factory=list)
    masks: List[Mask] = Field(default_factory=list)


class EffectElement(BaseTimelineElement):
    type: Literal["effect"] = "effect"
    effect_type: str = Field("", alias="effectType")


TimelineElement = Union[
    VideoElement,
    ImageElement,
    AudioElement,
    TextElement,
    StickerElement,
    GraphicElement,
    EffectElement,
]


# ------------------------------------------------------------------
# 轨道 (Track)
# ------------------------------------------------------------------
class BaseTrack(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str = "Track"


class VideoTrack(BaseTrack):
    type: Literal["video"] = "video"
    elements: List[Union[VideoElement, ImageElement]] = Field(default_factory=list)
    muted: bool = False
    hidden: bool = False


class TextTrack(BaseTrack):
    type: Literal["text"] = "text"
    elements: List[TextElement] = Field(default_factory=list)
    hidden: bool = False


class AudioTrack(BaseTrack):
    type: Literal["audio"] = "audio"
    elements: List[AudioElement] = Field(default_factory=list)
    muted: bool = False


class GraphicTrack(BaseTrack):
    type: Literal["graphic"] = "graphic"
    elements: List[Union[StickerElement, GraphicElement]] = Field(default_factory=list)
    hidden: bool = False


class EffectTrack(BaseTrack):
    type: Literal["effect"] = "effect"
    elements: List[EffectElement] = Field(default_factory=list)
    hidden: bool = False


TimelineTrack = Union[VideoTrack, TextTrack, AudioTrack, GraphicTrack, EffectTrack]
OverlayTrack = Union[VideoTrack, TextTrack, GraphicTrack, EffectTrack]


class SceneTracks(BaseModel):
    overlay: List[OverlayTrack] = Field(default_factory=list)
    main: VideoTrack = Field(default_factory=VideoTrack)
    audio: List[AudioTrack] = Field(default_factory=list)


# ------------------------------------------------------------------
# 场景与项目
# ------------------------------------------------------------------
class Bookmark(BaseModel):
    time: MediaTime = 0.0
    note: Optional[str] = None
    color: Optional[str] = None
    duration: Optional[MediaTime] = None


class TScene(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str = "Main scene"
    is_main: bool = Field(True, alias="isMain")
    tracks: SceneTracks = Field(default_factory=SceneTracks)
    bookmarks: List[Bookmark] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=datetime.utcnow, alias="createdAt")
    updated_at: datetime = Field(default_factory=datetime.utcnow, alias="updatedAt")


class TProject(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    metadata: TProjectMetadata = Field(default_factory=TProjectMetadata)
    scenes: List[TScene] = Field(default_factory=lambda: [TScene()])
    current_scene_id: str = Field("", alias="currentSceneId")
    settings: TProjectSettings = Field(default_factory=TProjectSettings)
    version: int = 1
    timeline_view_state: Optional[TTimelineViewState] = Field(None, alias="timelineViewState")

    def model_post_init(self, __context):
        if not self.scenes:
            self.scenes = [TScene()]
        if not self.current_scene_id and self.scenes:
            self.current_scene_id = self.scenes[0].id

    def current_scene(self) -> Optional[TScene]:
        for scene in self.scenes:
            if scene.id == self.current_scene_id:
                return scene
        return self.scenes[0] if self.scenes else None


# ------------------------------------------------------------------
# 选区与拖拽辅助类型
# ------------------------------------------------------------------
class ElementRef(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    track_id: str = Field(alias="trackId")
    element_id: str = Field(alias="elementId")


class EditorSelection(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    selected_elements: List[ElementRef] = Field(default_factory=list, alias="selectedElements")


class DropTarget(BaseModel):
    track_index: int = Field(alias="trackIndex")
    is_new_track: bool = Field(False, alias="isNewTrack")
    insert_position: Optional[Literal["above", "below"]] = Field(None, alias="insertPosition")
    x_position: MediaTime = Field(0.0, alias="xPosition")
    target_element: Optional[ElementRef] = Field(None, alias="targetElement")


# ------------------------------------------------------------------
# 命令结果
# ------------------------------------------------------------------
class CommandResult(BaseModel):
    selection: Optional[EditorSelection] = None
