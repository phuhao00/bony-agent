"""
认证路由: /auth/*
- POST /auth/login       登录，返回 JWT
- POST /auth/register    注册（管理员或开放注册时使用）////
- GET  /auth/me          获取当前用户信息
- POST /auth/change-password  修改密码
- POST /auth/logout      客户端注销（前端清除 token 即可）
"""
from fastapi import APIRouter, HTTPException, Depends, status
from pydantic import BaseModel, Field
from typing import Optional

from utils.auth_db import (
    get_user_by_username, create_user, update_user, update_last_login
)
from utils.auth import (
    hash_password, verify_password,
    create_access_token, get_current_user, require_admin
)

router = APIRouter(prefix="/auth", tags=["认证"])


# ── Schemas ───────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str
    password: str


class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=2, max_length=32)
    password: str = Field(..., min_length=6)
    email: Optional[str] = None
    role: str = Field("viewer", pattern="^(admin|editor|viewer)$")


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str = Field(..., min_length=6)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


# ── 路由 ──────────────────────────────────────────────

@router.post("/login", response_model=TokenResponse)
async def login(req: LoginRequest):
    user = get_user_by_username(req.username)
    if not user or not verify_password(req.password, user["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户名或密码错误"
        )
    if not user["is_active"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="账户已被禁用，请联系管理员"
        )
    update_last_login(user["id"])
    token = create_access_token(user["id"], user["username"], user["role"])
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": _safe_user(user),
    }


@router.post("/register", response_model=dict)
async def register(req: RegisterRequest, _admin: dict = Depends(require_admin)):
    """仅管理员可注册新账户（如需开放注册，移除 require_admin 依赖）"""
    if get_user_by_username(req.username):
        raise HTTPException(status_code=400, detail="用户名已存在")
    user = create_user(
        username=req.username,
        password_hash=hash_password(req.password),
        role=req.role,
        email=req.email,
    )
    return {"success": True, "user": _safe_user(user)}


@router.get("/me", response_model=dict)
async def get_me(current_user: dict = Depends(get_current_user)):
    return {"user": _safe_user(current_user)}


@router.post("/change-password", response_model=dict)
async def change_password(req: ChangePasswordRequest,
                          current_user: dict = Depends(get_current_user)):
    if not verify_password(req.old_password, current_user["password_hash"]):
        raise HTTPException(status_code=400, detail="旧密码错误")
    update_user(current_user["id"], password_hash=hash_password(req.new_password))
    return {"success": True, "message": "密码修改成功"}


@router.post("/logout", response_model=dict)
async def logout(_: dict = Depends(get_current_user)):
    # JWT 无状态，客户端清除 token 即可；此处可做 token 黑名单（暂未实现）
    return {"success": True, "message": "已登出"}


# ── 工具函数 ──────────────────────────────────────────

def _safe_user(user: dict) -> dict:
    """去除密码哈希，返回安全字段"""
    return {k: v for k, v in user.items() if k != "password_hash"}
