"""
JWT 认证工具 + 密码哈希
"""
import os
from datetime import datetime, timedelta
from typing import Optional

import bcrypt
from jose import JWTError, jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from utils.logger import setup_logger

logger = setup_logger("auth")

_DEFAULT_JWT_SECRET = "change-me-in-production-jwt-secret-key-2025"
SECRET_KEY = os.getenv("JWT_SECRET_KEY", _DEFAULT_JWT_SECRET)
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "1440"))  # 默认 24h


def validate_jwt_secret_on_startup() -> None:
    """Warn or fail when the default JWT secret is used in production."""
    env = os.getenv("ENVIRONMENT", os.getenv("NODE_ENV", "development")).lower()
    auth_required = os.getenv("AUTH_REQUIRED", "false").strip().lower() in ("1", "true", "yes")
    if SECRET_KEY == _DEFAULT_JWT_SECRET and (env in ("production", "prod") or auth_required):
        raise RuntimeError(
            "JWT_SECRET_KEY must be set to a strong random value when AUTH_REQUIRED or production mode is enabled"
        )
    if SECRET_KEY == _DEFAULT_JWT_SECRET:
        logger.warning("Using default JWT_SECRET_KEY — set JWT_SECRET_KEY in backend/.env for production")


# ── 密码 ──────────────────────────────────────────────

def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode(), hashed.encode())
    except Exception:
        return False


# ── JWT ──────────────────────────────────────────────

def create_access_token(user_id: str, username: str, role: str,
                        expires_delta: Optional[timedelta] = None) -> str:
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    payload = {
        "sub": user_id,
        "username": username,
        "role": role,
        "exp": expire,
        "iat": datetime.utcnow(),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> Optional[dict]:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError as e:
        logger.warning(f"Token 解析失败: {e}")
        return None


# ── FastAPI 依赖 ──────────────────────────────────────

_bearer = HTTPBearer(auto_error=False)


def _credentials_exception(detail: str = "认证失败，请重新登录"):
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_current_user(credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer)):
    """从 Bearer Token 解析当前用户，注入到路由函数"""
    if not credentials:
        raise _credentials_exception("未提供认证令牌")
    payload = decode_access_token(credentials.credentials)
    if not payload:
        raise _credentials_exception("令牌无效或已过期")
    from utils.auth_db import get_user_by_id
    user = get_user_by_id(payload["sub"])
    if not user or not user["is_active"]:
        raise _credentials_exception("账户不存在或已被禁用")
    return user


def require_admin(current_user: dict = Depends(get_current_user)):
    """仅管理员可访问"""
    if current_user["role"] != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="需要管理员权限")
    return current_user


def optional_current_user(credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer)):
    """可选认证：有 token 则解析，无 token 则返回 None（不报错）"""
    if not credentials:
        return None
    payload = decode_access_token(credentials.credentials)
    if not payload:
        return None
    from utils.auth_db import get_user_by_id
    user = get_user_by_id(payload.get("sub", ""))
    return user if user and user["is_active"] else None
