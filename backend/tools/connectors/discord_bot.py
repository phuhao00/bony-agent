"""
Discord Bot connector（精简）：Bot Token + Gateway REST。
支持频道发消息、拉取频道列表、读取频道最近消息；频道管理类动作占位。
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

import aiohttp

from .base import BaseConnector, ConnectorStatus, PublishResult


class DiscordBotConnector(BaseConnector):
    API_BASE = "https://discord.com/api/v10"

    @property
    def platform_name(self) -> str:
        return "Discord"

    @property
    def required_credentials(self) -> List[str]:
        return ["bot_token"]

    def validate_credentials(self) -> bool:
        return bool(self._token())

    def _token(self) -> str:
        return str(self.credentials.get("bot_token") or self.credentials.get("token") or "").strip()

    def _headers(self) -> Dict[str, str]:
        return {
            "Authorization": f"Bot {self._token()}",
            "Content-Type": "application/json; charset=utf-8",
        }

    async def verify_connection(self) -> bool:
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    f"{self.API_BASE}/users/@me",
                    headers=self._headers(),
                    timeout=aiohttp.ClientTimeout(total=10),
                ) as response:
                    return response.status == 200
        except Exception:
            return False

    async def get_account_info(self) -> Dict[str, Any]:
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    f"{self.API_BASE}/users/@me",
                    headers=self._headers(),
                    timeout=aiohttp.ClientTimeout(total=10),
                ) as response:
                    data = await response.json(content_type=None)
                    if response.status == 200:
                        return {
                            "username": data.get("username"),
                            "id": data.get("id"),
                            "bot": data.get("bot"),
                        }
        except Exception:
            pass
        return {}

    async def publish_content(
        self,
        content_type: str,
        title: str,
        content: str,
        media_urls: Optional[List[str]] = None,
        options: Optional[Dict[str, Any]] = None,
    ) -> PublishResult:
        options = options or {}
        channel_id = options.get("channel_id")
        if not channel_id:
            return PublishResult(success=False, platform=self.platform_id, error="channel_id is required in options")
        text = f"{title}\n{content}".strip() if title else str(content)
        result = await self.send_channel_message(str(channel_id), text)
        return PublishResult(
            success=bool(result.get("success")),
            platform=self.platform_id,
            post_id=result.get("message_id"),
            error=result.get("error"),
            metadata=result,
        )

    async def send_channel_message(self, channel_id: str, content: str) -> Dict[str, Any]:
        if not channel_id.strip():
            return {"success": False, "status": "invalid_params", "error": "channel_id is required"}
        if not (content or "").strip():
            return {"success": False, "status": "invalid_params", "error": "text/content is required"}
        body = {"content": content[:2000]}
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self.API_BASE}/channels/{channel_id}/messages",
                    headers=self._headers(),
                    json=body,
                    timeout=aiohttp.ClientTimeout(total=15),
                ) as response:
                    data = await response.json(content_type=None)
                    if response.status in (200, 201):
                        return {
                            "success": True,
                            "status": "sent",
                            "platform": self.platform_id,
                            "message_id": str(data.get("id")),
                            "data": data,
                        }
                    return {
                        "success": False,
                        "status": "api_error",
                        "platform": self.platform_id,
                        "status_code": response.status,
                        "error": data.get("message") if isinstance(data, dict) else str(data),
                    }
        except Exception as exc:
            return {"success": False, "status": "request_failed", "error": str(exc)}

    async def list_guild_channels(self, guild_id: str) -> Dict[str, Any]:
        if not guild_id.strip():
            return {"success": False, "error": "guild_id is required"}
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    f"{self.API_BASE}/guilds/{guild_id}/channels",
                    headers=self._headers(),
                    timeout=aiohttp.ClientTimeout(total=15),
                ) as response:
                    data = await response.json(content_type=None)
                    if response.status == 200 and isinstance(data, list):
                        return {
                            "success": True,
                            "status": "completed",
                            "platform": self.platform_id,
                            "channels": data,
                        }
                    return {
                        "success": False,
                        "status": "api_error",
                        "platform": self.platform_id,
                        "status_code": response.status,
                        "error": data.get("message") if isinstance(data, dict) else str(data),
                    }
        except Exception as exc:
            return {"success": False, "status": "request_failed", "error": str(exc)}

    async def read_channel_messages(
        self, *, channel_id: str, limit: int = 50
    ) -> Dict[str, Any]:
        if not channel_id.strip():
            return {"success": False, "error": "channel_id is required"}
        lim = max(1, min(int(limit), 100))
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    f"{self.API_BASE}/channels/{channel_id}/messages",
                    headers=self._headers(),
                    params={"limit": lim},
                    timeout=aiohttp.ClientTimeout(total=15),
                ) as response:
                    data = await response.json(content_type=None)
                    if response.status == 200 and isinstance(data, list):
                        return {
                            "success": True,
                            "status": "completed",
                            "platform": self.platform_id,
                            "messages": data,
                        }
                    return {
                        "success": False,
                        "status": "api_error",
                        "platform": self.platform_id,
                        "status_code": response.status,
                        "error": data.get("message") if isinstance(data, dict) else str(data),
                    }
        except Exception as exc:
            return {"success": False, "status": "request_failed", "error": str(exc)}

    async def manage_channels_action(self, params: Dict[str, Any]) -> Dict[str, Any]:
        op = str(params.get("operation") or params.get("op") or "create").lower()
        try:
            async with aiohttp.ClientSession() as session:
                if op in ("create", "add"):
                    guild_id = str(params.get("guild_id") or "").strip()
                    name = str(params.get("name") or "").strip()
                    if not guild_id or not name:
                        return {
                            "success": False,
                            "status": "invalid_params",
                            "platform": self.platform_id,
                            "error": "create 需要 guild_id 与 name",
                        }
                    body: Dict[str, Any] = {
                        "name": name[:100],
                        "type": int(params.get("type") or 0),
                    }
                    if params.get("topic"):
                        body["topic"] = str(params["topic"])[:1024]
                    if params.get("parent_id"):
                        body["parent_id"] = str(params["parent_id"])
                    if params.get("nsfw") is not None:
                        body["nsfw"] = bool(params["nsfw"])
                    async with session.post(
                        f"{self.API_BASE}/guilds/{guild_id}/channels",
                        headers=self._headers(),
                        json=body,
                        timeout=aiohttp.ClientTimeout(total=15),
                    ) as response:
                        data = await response.json(content_type=None)
                        if response.status in (200, 201):
                            return {
                                "success": True,
                                "status": "created",
                                "platform": self.platform_id,
                                "channel": data,
                            }
                        return {
                            "success": False,
                            "status": "api_error",
                            "platform": self.platform_id,
                            "status_code": response.status,
                            "error": data.get("message") if isinstance(data, dict) else str(data),
                        }
                if op in ("update", "patch", "edit"):
                    channel_id = str(params.get("channel_id") or "").strip()
                    if not channel_id:
                        return {
                            "success": False,
                            "status": "invalid_params",
                            "platform": self.platform_id,
                            "error": "update 需要 channel_id",
                        }
                    patch: Dict[str, Any] = {}
                    if params.get("name"):
                        patch["name"] = str(params["name"]).strip()[:100]
                    if params.get("topic") is not None:
                        patch["topic"] = str(params.get("topic") or "")[:1024]
                    if params.get("nsfw") is not None:
                        patch["nsfw"] = bool(params["nsfw"])
                    if params.get("parent_id") is not None:
                        patch["parent_id"] = str(params["parent_id"] or "")
                    if params.get("bitrate") is not None:
                        patch["bitrate"] = int(params["bitrate"])
                    if not patch:
                        return {
                            "success": False,
                            "status": "invalid_params",
                            "platform": self.platform_id,
                            "error": "update 至少提供 name、topic、nsfw、parent_id 之一",
                        }
                    async with session.patch(
                        f"{self.API_BASE}/channels/{channel_id}",
                        headers=self._headers(),
                        json=patch,
                        timeout=aiohttp.ClientTimeout(total=15),
                    ) as response:
                        data = await response.json(content_type=None)
                        if response.status == 200:
                            return {
                                "success": True,
                                "status": "updated",
                                "platform": self.platform_id,
                                "channel": data,
                            }
                        return {
                            "success": False,
                            "status": "api_error",
                            "platform": self.platform_id,
                            "status_code": response.status,
                            "error": data.get("message") if isinstance(data, dict) else str(data),
                        }
                if op in ("delete", "remove"):
                    channel_id = str(params.get("channel_id") or "").strip()
                    if not channel_id:
                        return {
                            "success": False,
                            "status": "invalid_params",
                            "platform": self.platform_id,
                            "error": "delete 需要 channel_id",
                        }
                    async with session.delete(
                        f"{self.API_BASE}/channels/{channel_id}",
                        headers=self._headers(),
                        timeout=aiohttp.ClientTimeout(total=15),
                    ) as response:
                        if response.status in (200, 204):
                            return {
                                "success": True,
                                "status": "deleted",
                                "platform": self.platform_id,
                                "channel_id": channel_id,
                            }
                        data = await response.json(content_type=None)
                        return {
                            "success": False,
                            "status": "api_error",
                            "platform": self.platform_id,
                            "status_code": response.status,
                            "error": data.get("message") if isinstance(data, dict) else str(data),
                        }
                return {
                    "success": False,
                    "status": "invalid_params",
                    "platform": self.platform_id,
                    "error": f"未知 operation：{op}，支持 create / update / delete",
                }
        except Exception as exc:
            return {"success": False, "status": "request_failed", "error": str(exc)}

    async def execute_action(self, action_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
        if action_id == "send_message":
            return await self.send_channel_message(
                str(params.get("channel_id") or ""),
                str(params.get("text") or params.get("content") or ""),
            )
        if action_id == "read_channels":
            guild_id = str(params.get("guild_id") or "").strip()
            channel_id = str(params.get("channel_id") or "").strip()
            if guild_id:
                return await self.list_guild_channels(guild_id)
            if channel_id:
                return await self.read_channel_messages(
                    channel_id=channel_id,
                    limit=int(params.get("limit") or 50),
                )
            return {
                "success": False,
                "status": "invalid_params",
                "platform": self.platform_id,
                "error": "read_channels 需要 guild_id（列出频道）或 channel_id（拉取消息）",
            }
        if action_id == "manage_channels":
            return await self.manage_channels_action(params)
        return {
            "success": False,
            "status": "action_not_implemented",
            "platform": self.platform_id,
            "action_id": action_id,
            "error": f"Unknown Discord action: {action_id}",
        }
