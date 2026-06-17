"""
OpenCut FastAPI Router
"""

import asyncio
import os
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, UploadFile, File, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from opencut.media_asset import MediaAssetManager
from opencut.models import (
    ElementRef,
    TimelineElement,
    TProject,
)
from opencut.renderer import export_project, render_frame
from opencut.project_store import ProjectStore
from opencut.timeline_manager import TimelineManager
from tools.media_common import OUTPUT_DIR, UPLOAD_DIR
from utils.logger import setup_logger

logger = setup_logger("opencut_api")

router = APIRouter(prefix="/opencut", tags=["opencut"])

# 存储目录
OPENCUT_STORAGE_DIR = os.path.join(OUTPUT_DIR, "..", "opencut")
OPENCUT_STORAGE_DIR = os.path.abspath(OPENCUT_STORAGE_DIR)

_project_store = ProjectStore(OPENCUT_STORAGE_DIR)
_asset_manager = MediaAssetManager(os.path.join(OPENCUT_STORAGE_DIR, "media"))

# 内存中的 TimelineManager 实例（生产环境应使用缓存/数据库）
_timeline_managers: Dict[str, TimelineManager] = {}


def _get_timeline_manager(project_id: str) -> TimelineManager:
    project = _project_store.load(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    if project_id not in _timeline_managers:
        _timeline_managers[project_id] = TimelineManager(project)
    else:
        # 同步项目状态
        _timeline_managers[project_id].project = project
    return _timeline_managers[project_id]


def _save_and_sync(project: TProject):
    _project_store.save(project)
    if project.metadata.id in _timeline_managers:
        _timeline_managers[project.metadata.id].project = project


# ------------------------------------------------------------------
# 请求模型
# ------------------------------------------------------------------
class CreateProjectRequest(BaseModel):
    name: str = "New project"


class RenameProjectRequest(BaseModel):
    name: str


class CommandRequest(BaseModel):
    command_type: str
    params: Dict[str, Any] = Field(default_factory=dict)


class UpdateViewStateRequest(BaseModel):
    zoom_level: Optional[float] = None
    scroll_left: Optional[float] = None
    playhead_time: Optional[float] = None


# ------------------------------------------------------------------
# 项目 API
# ------------------------------------------------------------------
@router.post("/projects")
async def create_project(req: CreateProjectRequest):
    project = _project_store.create(req.name)
    _save_and_sync(project)
    return {"success": True, "project": project.model_dump(by_alias=True, mode="json")}


@router.get("/projects")
async def list_projects():
    return {"success": True, "projects": _project_store.list_all()}


@router.get("/projects/{project_id}")
async def get_project(project_id: str):
    project = _project_store.load(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return {"success": True, "project": project.model_dump(by_alias=True, mode="json")}


@router.put("/projects/{project_id}")
async def update_project(project_id: str, req: Dict[str, Any]):
    project = _project_store.load(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    # 合并更新
    data = project.model_dump(by_alias=True)
    data.update(req)
    project = TProject.model_validate(data)
    _save_and_sync(project)
    return {"success": True, "project": project.model_dump(by_alias=True, mode="json")}


@router.delete("/projects/{project_id}")
async def delete_project(project_id: str):
    if _project_store.delete(project_id):
        _timeline_managers.pop(project_id, None)
        return {"success": True}
    raise HTTPException(status_code=404, detail="Project not found")


@router.post("/projects/{project_id}/rename")
async def rename_project(project_id: str, req: RenameProjectRequest):
    project = _project_store.load(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    project.metadata.name = req.name
    _save_and_sync(project)
    return {"success": True, "project": project.model_dump(by_alias=True, mode="json")}


# ------------------------------------------------------------------
# Command API
# ------------------------------------------------------------------
@router.post("/projects/{project_id}/command")
async def execute_command(project_id: str, req: CommandRequest):
    manager = _get_timeline_manager(project_id)
    result = _dispatch_command(manager, req.command_type, req.params)
    manager.update_project_duration()
    _save_and_sync(manager.project)
    return {
        "success": True,
        "result": result.model_dump(mode="json") if result else None,
        "project": manager.project.model_dump(by_alias=True, mode="json"),
    }


@router.post("/projects/{project_id}/undo")
async def undo_command(project_id: str):
    manager = _get_timeline_manager(project_id)
    manager.undo()
    _save_and_sync(manager.project)
    return {"success": True, "project": manager.project.model_dump(by_alias=True, mode="json")}


@router.post("/projects/{project_id}/redo")
async def redo_command(project_id: str):
    manager = _get_timeline_manager(project_id)
    manager.redo()
    _save_and_sync(manager.project)
    return {"success": True, "project": manager.project.model_dump(by_alias=True, mode="json")}


def _dispatch_command(manager: TimelineManager, command_type: str, params: Dict[str, Any]):
    if command_type == "addTrack":
        return manager.add_track(
            track_type=params["trackType"],
            index=params.get("index"),
        )
    elif command_type == "removeTrack":
        return manager.remove_track(track_id=params["trackId"])
    elif command_type == "toggleTrackMute":
        return manager.toggle_track_mute(track_id=params["trackId"])
    elif command_type == "toggleTrackVisibility":
        return manager.toggle_track_visibility(track_id=params["trackId"])
    elif command_type == "insertElement":
        element_data = params["element"]
        element = _parse_element(element_data)
        return manager.insert_element(
            element=element,
            track_id=params.get("trackId"),
            start_time=params.get("startTime"),
        )
    elif command_type == "deleteElements":
        refs = [ElementRef.model_validate(r) for r in params["elementRefs"]]
        return manager.delete_elements(element_refs=refs)
    elif command_type == "moveElements":
        return manager.move_elements(moves=params["moves"])
    elif command_type == "splitElements":
        refs = [ElementRef.model_validate(r) for r in params["elementRefs"]]
        return manager.split_elements(element_refs=refs, split_time=params["splitTime"])
    elif command_type == "updateElementTrim":
        ref = ElementRef.model_validate(params["elementRef"])
        return manager.update_element_trim(
            element_ref=ref,
            trim_start=params.get("trimStart"),
            trim_end=params.get("trimEnd"),
            start_time=params.get("startTime"),
            duration=params.get("duration"),
        )
    elif command_type == "updateElements":
        return manager.update_elements(updates=params["updates"])
    else:
        raise HTTPException(status_code=400, detail=f"Unknown command type: {command_type}")


def _parse_element(data: Dict[str, Any]) -> TimelineElement:
    from opencut.commands.element_commands import _rebuild_element
    return _rebuild_element(data)


# ------------------------------------------------------------------
# 媒体资源 API
# ------------------------------------------------------------------
@router.post("/media/upload")
async def upload_media(file: UploadFile = File(...)):
    """上传并注册媒体文件"""
    try:
        suffix = os.path.splitext(file.filename or "")[1]
        upload_path = os.path.join(UPLOAD_DIR, f"{os.urandom(8).hex()}{suffix}")
        with open(upload_path, "wb") as f:
            content = await file.read()
            f.write(content)

        asset = _asset_manager.register(upload_path, name=file.filename or "")
        return {"success": True, "asset": asset.to_dict()}
    except Exception as e:
        logger.error("Upload media failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/media")
async def list_media():
    return {"success": True, "assets": [a.to_dict() for a in _asset_manager.list_all()]}


@router.get("/media/{asset_id}")
async def get_media(asset_id: str):
    asset = _asset_manager.get(asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="Asset not found")
    return {"success": True, "asset": asset.to_dict()}


@router.delete("/media/{asset_id}")
async def delete_media(asset_id: str):
    if _asset_manager.delete(asset_id):
        return {"success": True}
    raise HTTPException(status_code=404, detail="Asset not found")


# ------------------------------------------------------------------
# 渲染/导出 API
# ------------------------------------------------------------------
@router.post("/projects/{project_id}/render")
async def render_project(project_id: str, req: Optional[Dict[str, Any]] = None):
    req = req or {}
    project = _project_store.load(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")

    output_path = _project_store.export_path(project_id)
    result = await asyncio.to_thread(
        export_project,
        project=project,
        asset_manager=_asset_manager,
        output_path=output_path,
        options=req,
    )
    if result.get("success"):
        _save_and_sync(project)
    return {"success": result.get("success"), "result": result}


@router.get("/projects/{project_id}/frame")
async def get_frame(project_id: str, time: float = 0.0, width: int = 640, height: int = 360):
    project = _project_store.load(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")

    output_path = _project_store.frame_path(project_id, time)
    if not os.path.exists(output_path):
        result = await asyncio.to_thread(
            render_frame,
            project=project,
            asset_manager=_asset_manager,
            time=time,
            output_path=output_path,
            width=width,
            height=height,
        )
        if not result.get("success"):
            raise HTTPException(status_code=500, detail=result.get("error", "Frame render failed"))

    from fastapi.responses import FileResponse
    return FileResponse(output_path, media_type="image/png")



# ------------------------------------------------------------------
# 视图状态 API
# ------------------------------------------------------------------
@router.post("/projects/{project_id}/view-state")
async def update_view_state(project_id: str, req: UpdateViewStateRequest):
    project = _project_store.load(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")

    if project.timeline_view_state is None:
        from opencut.models import TTimelineViewState
        project.timeline_view_state = TTimelineViewState()

    if req.zoom_level is not None:
        project.timeline_view_state.zoom_level = req.zoom_level
    if req.scroll_left is not None:
        project.timeline_view_state.scroll_left = req.scroll_left
    if req.playhead_time is not None:
        project.timeline_view_state.playhead_time = req.playhead_time

    _save_and_sync(project)
    return {"success": True, "project": project.model_dump(by_alias=True, mode="json")}


# ------------------------------------------------------------------
# 前端友好 API（适配 /media/opencut-pro）
# ------------------------------------------------------------------
class AddSceneElementRequest(BaseModel):
    trackId: str
    assetId: str
    startTime: float
    duration: Optional[float] = None


@router.get("/assets")
async def list_assets_frontend():
    """前端资源库列表"""
    return {
        "success": True,
        "assets": [a.to_frontend_dict() for a in _asset_manager.list_all()],
    }


@router.post("/assets/upload")
async def upload_asset_frontend(file: UploadFile = File(...)):
    """前端资源上传"""
    try:
        suffix = os.path.splitext(file.filename or "")[1]
        upload_path = os.path.join(UPLOAD_DIR, f"{os.urandom(8).hex()}{suffix}")
        with open(upload_path, "wb") as f:
            content = await file.read()
            f.write(content)
        asset = _asset_manager.register(upload_path, name=file.filename or "")
        return {"success": True, "asset": asset.to_frontend_dict()}
    except Exception as e:
        logger.error("Upload asset failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/projects/{project_id}/scenes/{scene_id}/elements")
async def add_scene_element(project_id: str, scene_id: str, req: AddSceneElementRequest):
    """向指定场景轨道添加媒体片段"""
    project = _project_store.load(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")

    asset = _asset_manager.get(req.assetId)
    if asset is None:
        raise HTTPException(status_code=404, detail="Asset not found")

    scene = next((s for s in project.scenes if s.id == scene_id), None)
    if scene is None:
        raise HTTPException(status_code=404, detail="Scene not found")

    duration = req.duration or asset.duration or 5.0
    element_data = {
        "type": asset.asset_type,
        "name": asset.name,
        "duration": duration,
        "startTime": req.startTime,
        "mediaId": req.assetId,
    }
    element = _parse_element(element_data)

    manager = _get_timeline_manager(project_id)
    result = manager.insert_element(element=element, track_id=req.trackId, start_time=req.startTime)
    manager.update_project_duration()
    _save_and_sync(manager.project)

    element_id = result.selection.selected_elements[0].element_id if result and result.selection else element.id
    return {"success": True, "elementId": element_id}


@router.post("/projects/{project_id}/export")
async def export_project_frontend(project_id: str, req: Optional[Dict[str, Any]] = None):
    """导出项目为 MP4，返回可访问 URL"""
    logger.info("Export request: project_id=%s options=%s", project_id, req)
    project = _project_store.load(project_id)
    if project is None:
        logger.warning("Export project not found: %s", project_id)
        raise HTTPException(status_code=404, detail="Project not found")

    output_path = _project_store.export_path(project_id)
    logger.info("Export output path: %s", output_path)
    result = await asyncio.to_thread(
        export_project,
        project=project,
        asset_manager=_asset_manager,
        output_path=output_path,
        options=req or {},
    )
    if not result.get("success"):
        logger.error("Export failed: %s", result.get("error"))
        raise HTTPException(status_code=500, detail=result.get("error", "Export failed"))

    _save_and_sync(project)
    filename = os.path.basename(output_path)
    file_size = os.path.getsize(output_path) if os.path.exists(output_path) else 0
    logger.info("Export success: %s size=%s duration=%s", filename, file_size, result.get("duration"))
    return {"success": True, "path": output_path, "url": f"/api/backend/opencut/exports/{filename}"}


@router.get("/media-file")
async def serve_media(path: str = Query(..., description="媒体文件绝对路径")):
    """代理本地媒体文件给前端预览"""
    if not path or not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Media not found")
    abs_path = os.path.abspath(path)
    # 简单安全检查：只允许访问存储目录下的文件
    allowed_roots = [
        os.path.abspath(OPENCUT_STORAGE_DIR),
        os.path.abspath(UPLOAD_DIR),
        os.path.abspath(OUTPUT_DIR),
    ]
    if not any(abs_path.startswith(root) for root in allowed_roots):
        raise HTTPException(status_code=403, detail="Access denied")
    return FileResponse(abs_path)


@router.get("/exports/{filename}")
async def serve_export(filename: str):
    """下载已导出的视频文件"""
    file_path = os.path.join(_project_store.exports_dir, filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Export not found")
    return FileResponse(file_path, media_type="video/mp4", filename=filename)
