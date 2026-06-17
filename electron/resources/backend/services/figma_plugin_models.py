"""Pydantic schemas for the Figma Plugin Bridge."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class FigmaPluginCommand(BaseModel):
    id: str
    method: str
    params: Dict[str, Any] = Field(default_factory=dict)


class FigmaPluginResponse(BaseModel):
    id: str
    success: bool
    result: Optional[Any] = None
    error: Optional[str] = None


class FigmaPluginMessage(BaseModel):
    type: str
    payload: Optional[Any] = None


class CreateFrameParams(BaseModel):
    name: str = "Frame"
    width: float = 1440
    height: float = 900
    x: float = 0
    y: float = 0
    fills: Optional[List[Dict[str, Any]]] = None


class CreateRectangleParams(BaseModel):
    name: str = "Rectangle"
    width: float = 100
    height: float = 100
    x: float = 0
    y: float = 0
    fills: Optional[List[Dict[str, Any]]] = None
    corner_radius: Optional[float] = Field(default=None, alias="cornerRadius")
    parent_id: Optional[str] = Field(default=None, alias="parentId")


class CreateTextParams(BaseModel):
    name: str = "Text"
    content: str = ""
    x: float = 0
    y: float = 0
    font_size: float = Field(default=24, alias="fontSize")
    font_weight: str = Field(default="normal", alias="fontWeight")
    fills: Optional[List[Dict[str, Any]]] = None
    parent_id: Optional[str] = Field(default=None, alias="parentId")


class ApplyAutoLayoutParams(BaseModel):
    node_id: str = Field(..., alias="nodeId")
    direction: str = "VERTICAL"
    item_spacing: float = Field(default=16, alias="itemSpacing")
    padding: float = 24


class ExportNodeParams(BaseModel):
    node_id: str = Field(..., alias="nodeId")
    format: str = "PNG"
    scale: float = 1


class RunCodeParams(BaseModel):
    code: str
