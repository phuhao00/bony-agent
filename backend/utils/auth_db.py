"""
SQLite 账户数据库管理模块
存储路径: storage/auth.db
"""
import sqlite3
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional
from utils.logger import setup_logger

logger = setup_logger("auth_db")

PROJECT_ROOT = Path(__file__).parent.parent.parent
DB_PATH = PROJECT_ROOT / "storage" / "auth.db"


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    """初始化数据库表结构，首次运行自动创建管理员账户"""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = get_connection()
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id          TEXT PRIMARY KEY,
                username    TEXT UNIQUE NOT NULL,
                email       TEXT UNIQUE,
                password_hash TEXT NOT NULL,
                role        TEXT NOT NULL DEFAULT 'viewer',
                is_active   INTEGER NOT NULL DEFAULT 1,
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL,
                last_login  TEXT
            )
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS refresh_tokens (
                id          TEXT PRIMARY KEY,
                user_id     TEXT NOT NULL,
                token_hash  TEXT NOT NULL,
                expires_at  TEXT NOT NULL,
                created_at  TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        """)
        conn.commit()
        logger.info(f"数据库初始化完成: {DB_PATH}")
        _ensure_admin(conn)
    finally:
        conn.close()


def _ensure_admin(conn: sqlite3.Connection):
    """确保存在默认管理员账户"""
    from utils.auth import hash_password
    row = conn.execute("SELECT id FROM users WHERE role='admin' LIMIT 1").fetchone()
    if row:
        return
    now = datetime.utcnow().isoformat()
    conn.execute(
        """INSERT INTO users (id, username, email, password_hash, role, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (str(uuid.uuid4()), "admin", "admin@localhost",
         hash_password("admin123"), "admin", 1, now, now)
    )
    conn.commit()
    logger.info("默认管理员账户已创建: admin / admin123 （请登录后立即修改密码）")


# ── CRUD ──────────────────────────────────────────────

def get_user_by_id(user_id: str) -> Optional[dict]:
    conn = get_connection()
    try:
        row = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def get_user_by_username(username: str) -> Optional[dict]:
    conn = get_connection()
    try:
        row = conn.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def get_user_by_email(email: str) -> Optional[dict]:
    conn = get_connection()
    try:
        row = conn.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def list_users(skip: int = 0, limit: int = 50) -> list[dict]:
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT id, username, email, role, is_active, created_at, updated_at, last_login "
            "FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?",
            (limit, skip)
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def count_users() -> int:
    conn = get_connection()
    try:
        return conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    finally:
        conn.close()


def create_user(username: str, password_hash: str, role: str = "viewer",
                email: Optional[str] = None) -> dict:
    conn = get_connection()
    try:
        uid = str(uuid.uuid4())
        now = datetime.utcnow().isoformat()
        conn.execute(
            """INSERT INTO users (id, username, email, password_hash, role, is_active, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, 1, ?, ?)""",
            (uid, username, email, password_hash, role, now, now)
        )
        conn.commit()
        return get_user_by_id(uid)
    finally:
        conn.close()


def update_user(user_id: str, **fields) -> Optional[dict]:
    allowed = {"username", "email", "password_hash", "role", "is_active"}
    updates = {k: v for k, v in fields.items() if k in allowed}
    if not updates:
        return get_user_by_id(user_id)
    updates["updated_at"] = datetime.utcnow().isoformat()
    set_clause = ", ".join(f"{k}=?" for k in updates)
    values = list(updates.values()) + [user_id]
    conn = get_connection()
    try:
        conn.execute(f"UPDATE users SET {set_clause} WHERE id=?", values)
        conn.commit()
        return get_user_by_id(user_id)
    finally:
        conn.close()


def delete_user(user_id: str) -> bool:
    conn = get_connection()
    try:
        cur = conn.execute("DELETE FROM users WHERE id=?", (user_id,))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def update_last_login(user_id: str):
    conn = get_connection()
    try:
        now = datetime.utcnow().isoformat()
        conn.execute("UPDATE users SET last_login=? WHERE id=?", (now, user_id))
        conn.commit()
    finally:
        conn.close()
