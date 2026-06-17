"""Project + asset metadata API for Labs canvases.

Provides Unity-style project management: each project owns canvas nodes,
chat messages and uploaded/generated assets. File bytes are still stored via
POST /upload; this router only keeps metadata and references.
"""

import json
import os
import uuid
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/media-assets", tags=["media-assets"])

ProjectType = Literal["short-drama", "music", "podcast"]
AssetType = Literal["image", "video", "audio", "text", "reference"]

PROJECT_ROOT = Path(__file__).parent.parent.parent
STORAGE_FILE = Path(os.environ.get("MEDIA_ASSETS_DB", PROJECT_ROOT / "storage" / "media_assets.json"))
STORAGE_FILE.parent.mkdir(parents=True, exist_ok=True)

_db: dict[str, Any] = {"projects": []}


def _load_db() -> dict[str, Any]:
    global _db
    if STORAGE_FILE.exists():
        try:
            with open(STORAGE_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, dict) and "projects" in data:
                    _db = data
        except Exception:
            pass
    return _db


def _save_db() -> None:
    try:
        with open(STORAGE_FILE, "w", encoding="utf-8") as f:
            json.dump(_db, f, ensure_ascii=False, indent=2)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to persist project db: {exc}")


_load_db()


class CreateProjectRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    type: ProjectType
    nodes: Optional[List[Dict[str, Any]]] = Field(default_factory=list)
    messages: Optional[List[Dict[str, Any]]] = Field(default_factory=list)
    brief: Optional[Dict[str, Any]] = None


class UpdateProjectRequest(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=120)
    nodes: Optional[List[Dict[str, Any]]] = None
    messages: Optional[List[Dict[str, Any]]] = None
    brief: Optional[Dict[str, Any]] = None
    assets: Optional[List[Dict[str, Any]]] = None


class AddAssetRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    type: AssetType
    url: str
    path: Optional[str] = None
    size: Optional[int] = None
    metadata: Optional[dict[str, Any]] = None


class UpdateAssetRequest(BaseModel):
    name: Optional[str] = None
    metadata: Optional[dict[str, Any]] = None


def _find_project(project_id: str):
    for p in _db["projects"]:
        if p.get("id") == project_id:
            return p
    raise HTTPException(status_code=404, detail="Project not found")


@router.get("/projects")
async def list_projects(type: Optional[ProjectType] = None):
    projects = _db["projects"]
    if type:
        projects = [p for p in projects if p.get("type") == type]
    return {"projects": sorted(projects, key=lambda p: p.get("updatedAt", 0), reverse=True)}


@router.post("/projects")
async def create_project(req: CreateProjectRequest):
    now = int(__import__("time").time() * 1000)
    project = {
        "id": str(uuid.uuid4()),
        "name": req.name,
        "type": req.type,
        "createdAt": now,
        "updatedAt": now,
        "nodes": req.nodes or [],
        "messages": req.messages or [],
        "brief": req.brief,
        "assets": [],
    }
    _db["projects"].append(project)
    _save_db()
    return project


@router.get("/projects/{project_id}")
async def get_project(project_id: str):
    return _find_project(project_id)


@router.put("/projects/{project_id}")
async def update_project(project_id: str, req: UpdateProjectRequest):
    project = _find_project(project_id)
    if req.name is not None:
        project["name"] = req.name
    if req.nodes is not None:
        project["nodes"] = req.nodes
    if req.messages is not None:
        project["messages"] = req.messages
    if req.brief is not None:
        project["brief"] = req.brief
    if req.assets is not None:
        project["assets"] = req.assets
    project["updatedAt"] = int(__import__("time").time() * 1000)
    _save_db()
    return project


@router.delete("/projects/{project_id}")
async def delete_project(project_id: str):
    _find_project(project_id)
    _db["projects"] = [p for p in _db["projects"] if p.get("id") != project_id]
    _save_db()
    return {"success": True}


@router.post("/projects/{project_id}/assets")
async def add_asset(project_id: str, req: AddAssetRequest):
    project = _find_project(project_id)
    asset = {
        "id": str(uuid.uuid4()),
        "name": req.name,
        "type": req.type,
        "url": req.url,
        "path": req.path,
        "size": req.size,
        "createdAt": int(__import__("time").time() * 1000),
        "metadata": req.metadata or {},
    }
    project.setdefault("assets", []).append(asset)
    project["updatedAt"] = asset["createdAt"]
    _save_db()
    return asset


@router.delete("/projects/{project_id}/assets/{asset_id}")
async def remove_asset(project_id: str, asset_id: str):
    project = _find_project(project_id)
    assets = project.get("assets", [])
    before = len(assets)
    project["assets"] = [a for a in assets if a.get("id") != asset_id]
    if len(project["assets"]) == before:
        raise HTTPException(status_code=404, detail="Asset not found")
    project["updatedAt"] = int(__import__("time").time() * 1000)
    _save_db()
    return {"success": True}
