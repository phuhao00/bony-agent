"""Chat Platform Bridge — 轻量级会话状态存储。

当前为内存实现，后续可替换为 Redis / SQLite。
"""

from __future__ import annotations

import time
from typing import Any


class SessionStore:
    """保存平台会话到 Agent thread_id 的映射及简单限流信息。"""

    def __init__(self) -> None:
        self._sessions: dict[str, dict[str, Any]] = {}
        self._rate_buckets: dict[str, list[float]] = {}

    def get_or_create(
        self,
        session_id: str,
        *,
        platform: str = "",
        thread_id: str = "",
        sender_id: str = "",
    ) -> dict[str, Any]:
        now = time.time()
        if session_id not in self._sessions:
            self._sessions[session_id] = {
                "session_id": session_id,
                "platform": platform,
                "thread_id": thread_id,
                "sender_id": sender_id,
                "created_at": now,
                "last_active_at": now,
                "message_count": 0,
            }
        else:
            self._sessions[session_id]["last_active_at"] = now
        self._sessions[session_id]["message_count"] += 1
        return self._sessions[session_id]

    def check_rate_limit(
        self,
        key: str,
        *,
        max_calls: int = 10,
        window_sec: int = 60,
    ) -> bool:
        """返回 True 表示未超限。"""
        now = time.time()
        bucket = self._rate_buckets.get(key, [])
        cutoff = now - window_sec
        bucket = [t for t in bucket if t > cutoff]
        if len(bucket) >= max_calls:
            self._rate_buckets[key] = bucket
            return False
        bucket.append(now)
        self._rate_buckets[key] = bucket
        return True

    def get_rate_limit_status(self, key: str, window_sec: int = 60) -> dict[str, Any]:
        now = time.time()
        bucket = [t for t in self._rate_buckets.get(key, []) if t > now - window_sec]
        return {"remaining": max(0, 10 - len(bucket)), "window_sec": window_sec}


# 全局单例
session_store = SessionStore()
