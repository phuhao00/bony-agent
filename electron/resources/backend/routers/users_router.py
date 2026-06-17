"""
用户管理路由（管理员专用）: /users/*
- GET    /users          用户列表（分页）
- GET    /users/{id}     用户详情
- PUT    /users/{id}     更新用户（角色/状态/邮箱）
- DELETE /users/{id}     删除用户
- POST   /users/{id}/reset-password  重置密码
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from typing import Optional

from utils.auth_db import (
    list_users, count_users, get_user_by_id,
    update_user, delete_user, get_user_by_username
)
from utils.auth import hash_password, require_admin, get_current_user

router = APIRouter(prefix="/users", tags=["用户管理"])


# ── Schemas ───────────────────────────────────────────

class UpdateUserRequest(BaseModel):
    email: Optional[str] = None
    role: Optional[str] = Field(None, pattern="^(admin|editor|viewer)$")
    is_active: Optional[bool] = None


class ResetPasswordRequest(BaseModel):
    new_password: str = Field(..., min_length=6)


# ── 路由 ──────────────────────────────────────────────

@router.get("", response_model=dict)
async def get_users(skip: int = 0, limit: int = 50,
                    _admin: dict = Depends(require_admin)):
    users = list_users(skip=skip, limit=limit)
    total = count_users()
    safe = [_safe(u) for u in users]
    return {"users": safe, "total": total, "skip": skip, "limit": limit}


@router.get("/{user_id}", response_model=dict)
async def get_user(user_id: str, _admin: dict = Depends(require_admin)):
    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    return {"user": _safe(user)}


@router.put("/{user_id}", response_model=dict)
async def update_user_info(user_id: str, req: UpdateUserRequest,
                           current_user: dict = Depends(require_admin)):
    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    # 防止取消自己的管理员身份
    if user_id == current_user["id"] and req.role and req.role != "admin":
        raise HTTPException(status_code=400, detail="不能修改自己的角色")
    updates = {}
    if req.email is not None:
        updates["email"] = req.email
    if req.role is not None:
        updates["role"] = req.role
    if req.is_active is not None:
        if user_id == current_user["id"] and not req.is_active:
            raise HTTPException(status_code=400, detail="不能禁用自己的账户")
        updates["is_active"] = 1 if req.is_active else 0
    updated = update_user(user_id, **updates)
    return {"success": True, "user": _safe(updated)}


@router.delete("/{user_id}", response_model=dict)
async def remove_user(user_id: str, current_user: dict = Depends(require_admin)):
    if user_id == current_user["id"]:
        raise HTTPException(status_code=400, detail="不能删除自己的账户")
    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    delete_user(user_id)
    return {"success": True, "message": f"用户 {user['username']} 已删除"}


@router.post("/{user_id}/reset-password", response_model=dict)
async def reset_password(user_id: str, req: ResetPasswordRequest,
                         _admin: dict = Depends(require_admin)):
    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    update_user(user_id, password_hash=hash_password(req.new_password))
    return {"success": True, "message": f"用户 {user['username']} 的密码已重置"}


# ── 工具 ──────────────────────────────────────────────

def _safe(user: dict) -> dict:
    return {k: v for k, v in user.items() if k != "password_hash"}
