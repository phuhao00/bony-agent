"""
Feishu / Lark connector.

Supports the first safe slice of platform actions: message send/read through
official OpenAPI credentials or incoming bot webhook.

Also: docx 纯文本读取（可选 include_blocks + blocks_page_token 续拉块摘要）、创建/追加段落、块批量更新（batch_update）、日历/多维表格读写的 OpenAPI（webhook-only 不可用）。
"""

import json
import re
from typing import Any, Dict, List, Optional, Tuple

import aiohttp

from .base import BaseConnector, ConnectorStatus, PublishResult

DOCX_BATCH_UPDATE_MAX = 200


def feishu_docx_segments_to_elements(
    segments: List[Any],
) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    """将简化的 segments 转为飞书 update_text_elements.elements。"""
    if not segments:
        return [], "segments 不能为空"
    elements: List[Dict[str, Any]] = []
    for seg in segments:
        if not isinstance(seg, dict):
            return [], "segments 每项须为对象"
        content = str(seg.get("content", ""))[:100_000]
        style: Dict[str, Any] = {}
        for key in ("bold", "italic", "underline", "strikethrough", "inline_code"):
            if seg.get(key):
                style[key] = True
        if seg.get("background_color") is not None:
            style["background_color"] = int(seg["background_color"])
        if seg.get("text_color") is not None:
            style["text_color"] = int(seg["text_color"])
        if style:
            elements.append({"text_run": {"content": content, "text_element_style": style}})
        else:
            elements.append({"text_run": {"content": content}})
    return elements, None


def _param_truthy(value: Any) -> bool:
    if value is True:
        return True
    s = str(value).strip().lower()
    return s in ("1", "true", "yes", "on")


def summarize_feishu_docx_block(block: Dict[str, Any]) -> Dict[str, Any]:
    """从飞书 docx block 对象提取审批/调试友好的短摘要。"""
    out: Dict[str, Any] = {
        "block_id": block.get("block_id"),
        "block_type": block.get("block_type"),
    }
    if block.get("parent_id"):
        out["parent_id"] = block.get("parent_id")
    te = block.get("text")
    elems = te.get("elements") if isinstance(te, dict) else None
    if isinstance(elems, list):
        parts: List[str] = []
        for el in elems[:24]:
            if not isinstance(el, dict):
                continue
            tr = el.get("text_run")
            if isinstance(tr, dict) and tr.get("content"):
                parts.append(str(tr["content"]))
        if parts:
            preview = "".join(parts)
            if len(preview) > 480:
                preview = preview[:480] + "…"
            out["text_preview"] = preview
    return out


def normalize_feishu_docx_batch_requests(
    items: List[Any],
) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    """
    将 write_docs 的 batch_updates 规范为飞书 batch_update 的 requests。

    每项支持：
    - 简化：{"block_id", "text"} 或 {"block_id", "segments": [{content, bold?, ...}]}
    - 原生：含 update_text_elements / merge_table_cells 等飞书请求体字段的对象（透传）
    """
    if not isinstance(items, list) or not items:
        return [], "batch_updates 必须为非空数组"
    if len(items) > DOCX_BATCH_UPDATE_MAX:
        return [], f"batch_updates 单次最多 {DOCX_BATCH_UPDATE_MAX} 条"
    out: List[Dict[str, Any]] = []
    seen: set[str] = set()
    for raw in items:
        if not isinstance(raw, dict):
            return [], "batch_updates 每项须为对象"
        block_id = str(raw.get("block_id") or "").strip()
        if not block_id:
            return [], "每项须含 block_id"
        has_text = "text" in raw
        segs = raw.get("segments")
        has_segments = isinstance(segs, list)
        other = [k for k in raw.keys() if k not in ("block_id", "text", "segments")]

        if has_text or has_segments:
            if has_text and has_segments:
                return [], "text 与 segments 不可同时出现"
            if has_text:
                txt = str(raw["text"])[:100_000]
                out.append(
                    {
                        "block_id": block_id,
                        "update_text_elements": {"elements": [{"text_run": {"content": txt}}]},
                    }
                )
            else:
                elems, serr = feishu_docx_segments_to_elements(segs)
                if serr:
                    return [], serr
                out.append({"block_id": block_id, "update_text_elements": {"elements": elems}})
        elif other:
            out.append(dict(raw))
        else:
            return [], "每项需提供 text、segments 或飞书原生更新字段（如 update_text_elements）"

        if block_id in seen:
            return [], "同一 batch 内 block_id 不可重复"
        seen.add(block_id)
    return out, None


def parse_feishu_document_id(value: str) -> str:
    """从 document_id、doc_token 或飞书 docx/wiki URL 中解析文档 token。"""
    v = (value or "").strip()
    if not v:
        return ""
    if "/" not in v and re.fullmatch(r"[a-zA-Z0-9]{15,64}", v):
        return v
    for pattern in (
        r"/docx/([a-zA-Z0-9]+)",
        r"/wiki/([a-zA-Z0-9]+)",
        r"/docs/([a-zA-Z0-9]+)",
    ):
        m = re.search(pattern, v)
        if m:
            return m.group(1)
    return v


class FeishuConnector(BaseConnector):
    API_BASE = "https://open.feishu.cn/open-apis"

    @property
    def platform_name(self) -> str:
        return "飞书 / Lark"

    @property
    def required_credentials(self) -> List[str]:
        return ["tenant_access_token"]

    def validate_credentials(self) -> bool:
        return bool(
            self.credentials.get("webhook_url")
            or self.credentials.get("tenant_access_token")
            or (self.credentials.get("app_id") and self.credentials.get("app_secret"))
        )

    async def verify_connection(self) -> bool:
        if self.credentials.get("webhook_url"):
            self.status = ConnectorStatus.CONNECTED
            return str(self.credentials.get("webhook_url", "")).startswith("https://open.feishu.cn/")

        token = await self._get_tenant_access_token()
        if not token:
            return False

        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    f"{self.API_BASE}/bot/v3/info",
                    headers=self._auth_headers(token),
                    timeout=aiohttp.ClientTimeout(total=10),
                ) as response:
                    data = await response.json(content_type=None)
                    return response.status < 400 and data.get("code") == 0
        except Exception:
            return False

    async def get_account_info(self) -> Dict[str, Any]:
        if self.credentials.get("webhook_url"):
            return {"username": "Feishu Bot Webhook", "mode": "webhook"}

        token = await self._get_tenant_access_token()
        if not token:
            return {}
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    f"{self.API_BASE}/bot/v3/info",
                    headers=self._auth_headers(token),
                    timeout=aiohttp.ClientTimeout(total=10),
                ) as response:
                    data = await response.json(content_type=None)
                    bot = data.get("bot", {}) if data.get("code") == 0 else {}
                    return {
                        "username": bot.get("app_name") or "Feishu Bot",
                        "app_name": bot.get("app_name"),
                        "avatar_url": bot.get("avatar_url"),
                        "mode": "official_api",
                    }
        except Exception:
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
        chat_id = options.get("chat_id") or options.get("receive_id")
        if not chat_id and not self.credentials.get("webhook_url"):
            return PublishResult(success=False, platform=self.platform_id, error="chat_id is required")
        text = f"{title}\n{content}".strip() if title else str(content)
        result = await self.send_message(chat_id=chat_id, text=text, receive_id_type=options.get("receive_id_type", "chat_id"))
        return PublishResult(
            success=bool(result.get("success")),
            platform=self.platform_id,
            post_id=result.get("message_id"),
            error=result.get("error"),
            metadata=result,
        )

    async def execute_action(self, action_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
        if action_id == "send_message":
            return await self.send_message(
                chat_id=str(params.get("chat_id") or params.get("receive_id") or ""),
                text=str(params.get("text") or params.get("content") or ""),
                receive_id_type=str(params.get("receive_id_type") or "chat_id"),
            )
        if action_id == "read_messages":
            return await self.read_messages(
                chat_id=str(params.get("chat_id") or params.get("container_id") or ""),
                page_size=int(params.get("page_size") or 20),
                page_token=params.get("page_token"),
            )
        if action_id == "read_docs":
            return await self.read_docs_action(params)
        if action_id == "write_docs":
            return await self.write_docs_action(params)
        if action_id == "calendar_read":
            return await self.calendar_read_action(params)
        if action_id == "base_read":
            return await self.base_read_action(params)
        if action_id == "calendar_write":
            return await self.calendar_write_action(params)
        if action_id == "base_write":
            return await self.base_write_action(params)
        return {
            "success": False,
            "status": "action_not_implemented",
            "platform": self.platform_id,
            "action_id": action_id,
            "error": f"Feishu action is not implemented yet: {action_id}",
        }

    def _need_official_api_for_doc_calendar_base(self) -> Optional[Dict[str, Any]]:
        if self.credentials.get("webhook_url"):
            return {
                "success": False,
                "status": "webhook_mode",
                "platform": self.platform_id,
                "error": "文档/日历/多维表格接口需要 tenant_access_token 或 app_id+app_secret，webhook-only 不可用",
            }
        return None

    async def read_docs_action(self, params: Dict[str, Any]) -> Dict[str, Any]:
        err = self._need_official_api_for_doc_calendar_base()
        if err:
            return err
        raw = (
            str(params.get("document_id") or params.get("doc_token") or "").strip()
            or str(params.get("doc_url") or params.get("url") or "").strip()
        )
        document_id = parse_feishu_document_id(raw)
        if not document_id:
            return {
                "success": False,
                "status": "invalid_params",
                "platform": self.platform_id,
                "error": "请提供 document_id、doc_token 或飞书 docx/wiki 文档链接",
            }
        lang = int(params.get("lang") or 0)
        content = await self._docx_raw_content(document_id, lang=lang)
        if not content.get("success"):
            return content
        if _param_truthy(params.get("include_blocks")):
            ps = int(params.get("blocks_page_size") or 50)
            ps = max(1, min(ps, 100))
            max_pages = int(params.get("blocks_max_pages") or 5)
            max_pages = max(1, min(max_pages, 20))
            summarize = not _param_truthy(params.get("blocks_full"))
            btok_raw = params.get("blocks_page_token")
            start_tok = str(btok_raw).strip() if btok_raw is not None and str(btok_raw).strip() else None
            blocks = await self._docx_list_blocks_for_read(
                document_id,
                page_size=ps,
                max_pages=max_pages,
                summarize=summarize,
                start_page_token=start_tok,
            )
            if blocks.get("success"):
                content["blocks"] = blocks["items"]
                content["blocks_pagination"] = {
                    "has_more": blocks["has_more"],
                    "next_page_token": blocks.get("page_token"),
                    "pages_fetched": blocks["pages_fetched"],
                    "summarized": summarize,
                }
                if start_tok:
                    content["blocks_pagination"]["blocks_page_token_used"] = start_tok
            else:
                content["blocks_error"] = {
                    "status": blocks.get("status"),
                    "error": blocks.get("error"),
                    "code": blocks.get("code"),
                }
        return content

    async def write_docs_action(self, params: Dict[str, Any]) -> Dict[str, Any]:
        err = self._need_official_api_for_doc_calendar_base()
        if err:
            return err
        raw_doc = (
            str(params.get("document_id") or params.get("doc_token") or "").strip()
            or str(params.get("doc_url") or params.get("url") or "").strip()
        )
        document_id = parse_feishu_document_id(raw_doc)
        batch_updates = params.get("batch_updates")
        raw_requests = params.get("requests")
        if (isinstance(raw_requests, list) and len(raw_requests) > 0) or batch_updates is not None:
            if not document_id:
                return {
                    "success": False,
                    "status": "invalid_params",
                    "platform": self.platform_id,
                    "error": "批量更新请提供 document_id、doc_token 或飞书文档链接",
                }
            if isinstance(raw_requests, list) and len(raw_requests) > 0:
                if len(raw_requests) > DOCX_BATCH_UPDATE_MAX:
                    return {
                        "success": False,
                        "status": "invalid_params",
                        "platform": self.platform_id,
                        "error": f"requests 单次最多 {DOCX_BATCH_UPDATE_MAX} 条",
                    }
                ids: List[str] = []
                for req in raw_requests:
                    if not isinstance(req, dict) or not str(req.get("block_id") or "").strip():
                        return {
                            "success": False,
                            "status": "invalid_params",
                            "platform": self.platform_id,
                            "error": "requests 每项须为含 block_id 的对象",
                        }
                    ids.append(str(req["block_id"]).strip())
                if len(ids) != len(set(ids)):
                    return {
                        "success": False,
                        "status": "invalid_params",
                        "platform": self.platform_id,
                        "error": "requests 中 block_id 不可重复",
                    }
                requests_body = raw_requests
            else:
                if not isinstance(batch_updates, list):
                    return {
                        "success": False,
                        "status": "invalid_params",
                        "platform": self.platform_id,
                        "error": "batch_updates 须为非空数组",
                    }
                requests_body, nerr = normalize_feishu_docx_batch_requests(batch_updates)
                if nerr:
                    return {
                        "success": False,
                        "status": "invalid_params",
                        "platform": self.platform_id,
                        "error": nerr,
                    }
            rev_raw = params.get("document_revision_id")
            rev: Optional[int] = None
            if rev_raw is not None and str(rev_raw).strip() != "":
                try:
                    rev = int(rev_raw)
                except (TypeError, ValueError):
                    return {
                        "success": False,
                        "status": "invalid_params",
                        "platform": self.platform_id,
                        "error": "document_revision_id 须为整数",
                    }
            client_tok = params.get("client_token")
            ct = str(client_tok).strip() if client_tok is not None and str(client_tok).strip() else None
            return await self._docx_blocks_batch_update(
                document_id,
                requests_body,
                document_revision_id=rev,
                client_token=ct,
            )

        title = str(params.get("title") or "").strip()
        text = str(params.get("text") or params.get("content") or "").strip()
        document_id = parse_feishu_document_id(str(params.get("document_id") or ""))
        folder_token = params.get("folder_token")
        if document_id and text:
            return await self._docx_append_paragraph(document_id, text)
        if title:
            created = await self._docx_create_document(title=title, folder_token=folder_token)
            if not created.get("success"):
                return created
            new_id = created.get("document_id")
            if text and new_id:
                append = await self._docx_append_paragraph(str(new_id), text)
                created["append_paragraph"] = append
            return created
        return {
            "success": False,
            "status": "invalid_params",
            "platform": self.platform_id,
            "error": "新建文档请提供 title；向已有文档追加段落请提供 document_id 与 text/content",
        }

    async def calendar_read_action(self, params: Dict[str, Any]) -> Dict[str, Any]:
        err = self._need_official_api_for_doc_calendar_base()
        if err:
            return err
        calendar_id = str(params.get("calendar_id") or "").strip()
        if not calendar_id:
            return {
                "success": False,
                "status": "invalid_params",
                "platform": self.platform_id,
                "error": "calendar_id 必填（飞书日历 ID）",
            }
        page_size = max(1, min(int(params.get("page_size") or 50), 500))
        query: Dict[str, Any] = {"page_size": page_size}
        if params.get("page_token"):
            query["page_token"] = str(params["page_token"])
        for key in ("start_time", "end_time", "sync_token"):
            if params.get(key):
                query[key] = str(params[key])
        token = await self._get_tenant_access_token()
        if not token:
            return {"success": False, "status": "missing_credentials", "error": "tenant_access_token or app credentials are required"}
        url = f"{self.API_BASE}/calendar/v4/calendars/{calendar_id}/events"
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    url,
                    headers=self._auth_headers(token),
                    params=query,
                    timeout=aiohttp.ClientTimeout(total=20),
                ) as response:
                    data = await response.json(content_type=None)
                    if response.status < 400 and data.get("code") == 0:
                        body = data.get("data", {})
                        return {
                            "success": True,
                            "status": "completed",
                            "platform": self.platform_id,
                            "events": body.get("items", []),
                            "has_more": body.get("has_more", False),
                            "page_token": body.get("page_token"),
                        }
                    return self._api_error(data, response.status)
        except Exception as exc:
            return {"success": False, "status": "request_failed", "error": str(exc)}

    async def base_read_action(self, params: Dict[str, Any]) -> Dict[str, Any]:
        err = self._need_official_api_for_doc_calendar_base()
        if err:
            return err
        app_token = str(params.get("app_token") or "").strip()
        table_id = str(params.get("table_id") or "").strip()
        if not app_token or not table_id:
            return {
                "success": False,
                "status": "invalid_params",
                "platform": self.platform_id,
                "error": "app_token（多维表格 app_id）与 table_id 必填",
            }
        page_size = max(1, min(int(params.get("page_size") or 100), 500))
        query: Dict[str, Any] = {"page_size": page_size}
        if params.get("page_token"):
            query["page_token"] = str(params["page_token"])
        if params.get("view_id"):
            query["view_id"] = str(params["view_id"])
        token = await self._get_tenant_access_token()
        if not token:
            return {"success": False, "status": "missing_credentials", "error": "tenant_access_token or app credentials are required"}
        url = f"{self.API_BASE}/bitable/v1/apps/{app_token}/tables/{table_id}/records"
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    url,
                    headers=self._auth_headers(token),
                    params=query,
                    timeout=aiohttp.ClientTimeout(total=30),
                ) as response:
                    data = await response.json(content_type=None)
                    if response.status < 400 and data.get("code") == 0:
                        body = data.get("data", {})
                        return {
                            "success": True,
                            "status": "completed",
                            "platform": self.platform_id,
                            "records": body.get("items", []),
                            "has_more": bool(body.get("has_more", False)),
                            "page_token": body.get("page_token"),
                            "total": body.get("total"),
                        }
                    return self._api_error(data, response.status)
        except Exception as exc:
            return {"success": False, "status": "request_failed", "error": str(exc)}

    @staticmethod
    def _calendar_time_info(value: Any, timezone: str) -> Dict[str, Any]:
        if isinstance(value, dict):
            return value
        ts = str(int(value))
        return {"timestamp": ts, "timezone": timezone}

    async def calendar_write_action(self, params: Dict[str, Any]) -> Dict[str, Any]:
        err = self._need_official_api_for_doc_calendar_base()
        if err:
            return err
        calendar_id = str(params.get("calendar_id") or "").strip()
        if not calendar_id:
            return {
                "success": False,
                "status": "invalid_params",
                "platform": self.platform_id,
                "error": "calendar_id 必填",
            }
        event_id = str(params.get("event_id") or "").strip()
        token = await self._get_tenant_access_token()
        if not token:
            return {"success": False, "status": "missing_credentials", "error": "tenant_access_token or app credentials are required"}

        if isinstance(params.get("event"), dict):
            body = dict(params["event"])
        else:
            summary = str(params.get("summary") or params.get("title") or "").strip()
            tz = str(params.get("timezone") or "Asia/Shanghai")
            st = params.get("start_time")
            et = params.get("end_time")
            if not event_id and (st is None or et is None):
                return {
                    "success": False,
                    "status": "invalid_params",
                    "platform": self.platform_id,
                    "error": "创建日程需提供 start_time 与 end_time（Unix 秒或 time_info 对象）；更新可只传 event_id 与要改的字段",
                }
            body: Dict[str, Any] = {}
            if summary:
                body["summary"] = summary[:1000]
            if params.get("description") is not None:
                body["description"] = str(params.get("description") or "")
            if st is not None:
                body["start_time"] = self._calendar_time_info(st, tz)
            if et is not None:
                body["end_time"] = self._calendar_time_info(et, tz)
            if not event_id and not body.get("summary"):
                body["summary"] = "新建日程"
            if params.get("need_notification") is not None:
                body["need_notification"] = bool(params["need_notification"])
            for opt in ("attendee_ability", "color", "visibility", "free_busy_status"):
                if params.get(opt) is not None:
                    body[opt] = params[opt]

        if event_id and not body:
            return {
                "success": False,
                "status": "invalid_params",
                "platform": self.platform_id,
                "error": "更新日程请在 event 中传完整载荷，或提供 summary/description/start_time/end_time 等至少一项",
            }

        try:
            async with aiohttp.ClientSession() as session:
                if event_id:
                    url = f"{self.API_BASE}/calendar/v4/calendars/{calendar_id}/events/{event_id}"
                    async with session.patch(
                        url,
                        headers=self._auth_headers(token),
                        json=body,
                        timeout=aiohttp.ClientTimeout(total=20),
                    ) as response:
                        data = await response.json(content_type=None)
                        if response.status < 400 and data.get("code") == 0:
                            ev = data.get("data") or {}
                            return {
                                "success": True,
                                "status": "updated",
                                "platform": self.platform_id,
                                "event": ev.get("event", ev),
                            }
                        return self._api_error(data, response.status)
                url = f"{self.API_BASE}/calendar/v4/calendars/{calendar_id}/events"
                async with session.post(
                    url,
                    headers=self._auth_headers(token),
                    json=body,
                    timeout=aiohttp.ClientTimeout(total=20),
                ) as response:
                    data = await response.json(content_type=None)
                    if response.status < 400 and data.get("code") == 0:
                        ev = data.get("data") or {}
                        return {
                            "success": True,
                            "status": "created",
                            "platform": self.platform_id,
                            "event": ev.get("event", ev),
                        }
                    return self._api_error(data, response.status)
        except Exception as exc:
            return {"success": False, "status": "request_failed", "error": str(exc)}

    async def base_write_action(self, params: Dict[str, Any]) -> Dict[str, Any]:
        err = self._need_official_api_for_doc_calendar_base()
        if err:
            return err
        app_token = str(params.get("app_token") or "").strip()
        table_id = str(params.get("table_id") or "").strip()
        if not app_token or not table_id:
            return {
                "success": False,
                "status": "invalid_params",
                "platform": self.platform_id,
                "error": "app_token 与 table_id 必填",
            }
        token = await self._get_tenant_access_token()
        if not token:
            return {"success": False, "status": "missing_credentials", "error": "tenant_access_token or app credentials are required"}

        updates = params.get("updates")
        if isinstance(updates, list) and updates:
            clean_u: List[Dict[str, Any]] = []
            for u in updates:
                if (
                    isinstance(u, dict)
                    and u.get("record_id") is not None
                    and isinstance(u.get("fields"), dict)
                ):
                    clean_u.append(
                        {"record_id": str(u["record_id"]).strip(), "fields": u["fields"]}
                    )
            if not clean_u:
                return {
                    "success": False,
                    "status": "invalid_params",
                    "platform": self.platform_id,
                    "error": "updates 每项需包含 record_id 与 fields",
                }
            body = {"records": clean_u}
            path = f"/bitable/v1/apps/{app_token}/tables/{table_id}/records/batch_update"
        elif str(params.get("record_id") or "").strip() and isinstance(params.get("fields"), dict):
            body = {
                "records": [
                    {"record_id": str(params["record_id"]).strip(), "fields": params["fields"]}
                ]
            }
            path = f"/bitable/v1/apps/{app_token}/tables/{table_id}/records/batch_update"
        else:
            rows_in = params.get("records")
            if rows_in is None and isinstance(params.get("fields"), dict):
                rows_in = [params["fields"]]
            if not isinstance(rows_in, list) or not rows_in:
                return {
                    "success": False,
                    "status": "invalid_params",
                    "platform": self.platform_id,
                    "error": "新建请传 records（字段对象列表）或单个 fields；更新请传 record_id+fields 或 updates",
                }
            norm: List[Dict[str, Any]] = []
            for row in rows_in:
                if not isinstance(row, dict):
                    continue
                if "fields" in row:
                    norm.append({"fields": row["fields"]})
                else:
                    norm.append({"fields": row})
            if not norm:
                return {
                    "success": False,
                    "status": "invalid_params",
                    "platform": self.platform_id,
                    "error": "records 解析后为空",
                }
            body = {"records": norm}
            path = f"/bitable/v1/apps/{app_token}/tables/{table_id}/records/batch_create"

        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self.API_BASE}{path}",
                    headers=self._auth_headers(token),
                    json=body,
                    timeout=aiohttp.ClientTimeout(total=30),
                ) as response:
                    data = await response.json(content_type=None)
                    if response.status < 400 and data.get("code") == 0:
                        return {
                            "success": True,
                            "status": "completed",
                            "platform": self.platform_id,
                            "data": data.get("data"),
                        }
                    return self._api_error(data, response.status)
        except Exception as exc:
            return {"success": False, "status": "request_failed", "error": str(exc)}

    async def _docx_raw_content(self, document_id: str, *, lang: int = 0) -> Dict[str, Any]:
        token = await self._get_tenant_access_token()
        if not token:
            return {"success": False, "status": "missing_credentials", "error": "tenant_access_token or app credentials are required"}
        url = f"{self.API_BASE}/docx/v1/documents/{document_id}/raw_content"
        query = {"lang": lang} if lang else None
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    url,
                    headers=self._auth_headers(token),
                    params=query or {},
                    timeout=aiohttp.ClientTimeout(total=30),
                ) as response:
                    data = await response.json(content_type=None)
                    if response.status < 400 and data.get("code") == 0:
                        payload = data.get("data") or {}
                        return {
                            "success": True,
                            "status": "completed",
                            "platform": self.platform_id,
                            "document_id": document_id,
                            "content": payload.get("content", ""),
                        }
                    return self._api_error(data, response.status)
        except Exception as exc:
            return {"success": False, "status": "request_failed", "error": str(exc)}

    async def _docx_get_blocks(
        self,
        document_id: str,
        *,
        page_size: int = 50,
        page_token: Optional[str] = None,
    ) -> Tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
        """Returns (data, error). data 为 OpenAPI data 对象（含 items / page_token / has_more）；error 为失败时的结果字典。"""
        token = await self._get_tenant_access_token()
        if not token:
            return None, {"success": False, "status": "missing_credentials", "error": "missing token"}
        qs: Dict[str, Any] = {"page_size": max(1, min(int(page_size), 100))}
        if page_token:
            qs["page_token"] = str(page_token)
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    f"{self.API_BASE}/docx/v1/documents/{document_id}/blocks",
                    headers=self._auth_headers(token),
                    params=qs,
                    timeout=aiohttp.ClientTimeout(total=25),
                ) as response:
                    data = await response.json(content_type=None)
                    if response.status >= 400 or data.get("code") != 0:
                        return None, self._api_error(data, response.status)
                    return (data.get("data") or {}), None
        except Exception as exc:
            return None, {"success": False, "status": "request_failed", "error": str(exc)}

    async def _docx_list_blocks_for_read(
        self,
        document_id: str,
        *,
        page_size: int = 50,
        max_pages: int = 5,
        summarize: bool = True,
        start_page_token: Optional[str] = None,
    ) -> Dict[str, Any]:
        all_items: List[Dict[str, Any]] = []
        page_token: Optional[str] = None
        if start_page_token is not None:
            s = str(start_page_token).strip()
            page_token = s or None
        pages = 0
        last_has_more = False
        last_token: Optional[str] = None
        while pages < max_pages:
            body, err = await self._docx_get_blocks(
                document_id, page_size=page_size, page_token=page_token
            )
            if err is not None:
                return err
            items = (body or {}).get("items") or []
            for it in items:
                if isinstance(it, dict):
                    all_items.append(summarize_feishu_docx_block(it) if summarize else dict(it))
            last_has_more = bool((body or {}).get("has_more"))
            last_token = (body or {}).get("page_token")
            nxt = str(last_token).strip() if last_token else ""
            page_token = nxt or None
            pages += 1
            if not last_has_more or not page_token:
                break
        return {
            "success": True,
            "items": all_items,
            "has_more": last_has_more and page_token is not None,
            "page_token": last_token,
            "pages_fetched": pages,
        }

    async def _docx_blocks_batch_update(
        self,
        document_id: str,
        requests: List[Dict[str, Any]],
        *,
        document_revision_id: Optional[int] = None,
        client_token: Optional[str] = None,
    ) -> Dict[str, Any]:
        if not requests:
            return {
                "success": False,
                "status": "invalid_params",
                "platform": self.platform_id,
                "error": "batch_update 的 requests 不能为空",
            }
        token = await self._get_tenant_access_token()
        if not token:
            return {"success": False, "status": "missing_credentials", "error": "tenant_access_token or app credentials are required"}
        query: Dict[str, str] = {}
        if document_revision_id is not None:
            query["document_revision_id"] = str(document_revision_id)
        if client_token:
            query["client_token"] = client_token
        url = f"{self.API_BASE}/docx/v1/documents/{document_id}/blocks/batch_update"
        body: Dict[str, Any] = {"requests": requests}
        try:
            async with aiohttp.ClientSession() as session:
                async with session.patch(
                    url,
                    headers=self._auth_headers(token),
                    params=query,
                    json=body,
                    timeout=aiohttp.ClientTimeout(total=45),
                ) as response:
                    data = await response.json(content_type=None)
                    if response.status < 400 and data.get("code") == 0:
                        return {
                            "success": True,
                            "status": "batch_updated",
                            "platform": self.platform_id,
                            "document_id": document_id,
                            "data": data.get("data"),
                        }
                    return self._api_error(data, response.status)
        except Exception as exc:
            return {"success": False, "status": "request_failed", "error": str(exc)}

    async def _docx_create_document(
        self, *, title: str, folder_token: Any = None
    ) -> Dict[str, Any]:
        token = await self._get_tenant_access_token()
        if not token:
            return {"success": False, "status": "missing_credentials", "error": "tenant_access_token or app credentials are required"}
        body: Dict[str, Any] = {"title": title[:800]}
        if folder_token:
            body["folder_token"] = str(folder_token)
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self.API_BASE}/docx/v1/documents",
                    headers=self._auth_headers(token),
                    json=body,
                    timeout=aiohttp.ClientTimeout(total=20),
                ) as response:
                    data = await response.json(content_type=None)
                    if response.status < 400 and data.get("code") == 0:
                        doc = (data.get("data") or {}).get("document") or {}
                        did = doc.get("document_id")
                        return {
                            "success": True,
                            "status": "created",
                            "platform": self.platform_id,
                            "document_id": did,
                            "revision_id": doc.get("revision_id"),
                            "title": doc.get("title") or title,
                        }
                    return self._api_error(data, response.status)
        except Exception as exc:
            return {"success": False, "status": "request_failed", "error": str(exc)}

    async def _docx_list_block_parents(self, document_id: str) -> Tuple[Optional[str], Dict[str, Any]]:
        body, err = await self._docx_get_blocks(document_id, page_size=50)
        if err is not None:
            return None, err
        items = (body or {}).get("items", [])
        if not items:
            return None, {"success": False, "error": "文档无可用块，无法追加内容"}
        parent_id = None
        for it in items:
            if it.get("block_type") == 1:
                parent_id = it.get("block_id")
                break
        if not parent_id:
            parent_id = items[0].get("block_id")
        if not parent_id:
            return None, {"success": False, "error": "无法解析父块 block_id"}
        return parent_id, {"success": True}

    async def _docx_append_paragraph(self, document_id: str, text: str) -> Dict[str, Any]:
        token = await self._get_tenant_access_token()
        if not token:
            return {"success": False, "status": "missing_credentials", "error": "tenant_access_token or app credentials are required"}
        parent_id, meta = await self._docx_list_block_parents(document_id)
        if not parent_id:
            return meta
        chunk = text[:50_000]
        child = {
            "block_type": 2,
            "text": {
                "elements": [{"text_run": {"content": chunk}}],
                "style": {},
            },
        }
        body = {"children": [child], "index": -1}
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self.API_BASE}/docx/v1/documents/{document_id}/blocks/{parent_id}/children",
                    headers=self._auth_headers(token),
                    json=body,
                    timeout=aiohttp.ClientTimeout(total=25),
                ) as response:
                    data = await response.json(content_type=None)
                    if response.status < 400 and data.get("code") == 0:
                        return {
                            "success": True,
                            "status": "appended",
                            "platform": self.platform_id,
                            "document_id": document_id,
                            "parent_block_id": parent_id,
                            "data": data.get("data"),
                        }
                    return self._api_error(data, response.status)
        except Exception as exc:
            return {"success": False, "status": "request_failed", "error": str(exc)}

    async def send_message(self, *, chat_id: str, text: str, receive_id_type: str = "chat_id") -> Dict[str, Any]:
        if not text.strip():
            return {"success": False, "status": "invalid_params", "error": "text is required"}
        if self.credentials.get("webhook_url"):
            return await self._send_webhook_message(text)
        if not chat_id.strip():
            return {"success": False, "status": "invalid_params", "error": "chat_id is required"}

        token = await self._get_tenant_access_token()
        if not token:
            return {"success": False, "status": "missing_credentials", "error": "tenant_access_token or app credentials are required"}

        payload = {
            "receive_id": chat_id,
            "msg_type": "text",
            "content": json.dumps({"text": text}, ensure_ascii=False),
        }
        url = f"{self.API_BASE}/im/v1/messages?receive_id_type={receive_id_type}"
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    url,
                    headers=self._auth_headers(token),
                    json=payload,
                    timeout=aiohttp.ClientTimeout(total=15),
                ) as response:
                    data = await response.json(content_type=None)
                    if response.status < 400 and data.get("code") == 0:
                        message = data.get("data", {})
                        return {
                            "success": True,
                            "status": "sent",
                            "platform": self.platform_id,
                            "message_id": message.get("message_id"),
                            "data": message,
                        }
                    return self._api_error(data, response.status)
        except Exception as exc:
            return {"success": False, "status": "request_failed", "error": str(exc)}

    async def read_messages(self, *, chat_id: str, page_size: int = 20, page_token: Optional[str] = None) -> Dict[str, Any]:
        if not chat_id.strip():
            return {"success": False, "status": "invalid_params", "error": "chat_id is required"}
        token = await self._get_tenant_access_token()
        if not token:
            return {"success": False, "status": "missing_credentials", "error": "tenant_access_token or app credentials are required"}

        query = {
            "container_id_type": "chat",
            "container_id": chat_id,
            "page_size": max(1, min(page_size, 50)),
        }
        if page_token:
            query["page_token"] = page_token
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    f"{self.API_BASE}/im/v1/messages",
                    headers=self._auth_headers(token),
                    params=query,
                    timeout=aiohttp.ClientTimeout(total=15),
                ) as response:
                    data = await response.json(content_type=None)
                    if response.status < 400 and data.get("code") == 0:
                        body = data.get("data", {})
                        return {
                            "success": True,
                            "status": "completed",
                            "platform": self.platform_id,
                            "messages": body.get("items", []),
                            "has_more": body.get("has_more", False),
                            "page_token": body.get("page_token"),
                        }
                    return self._api_error(data, response.status)
        except Exception as exc:
            return {"success": False, "status": "request_failed", "error": str(exc)}

    async def _send_webhook_message(self, text: str) -> Dict[str, Any]:
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    self.credentials["webhook_url"],
                    json={"msg_type": "text", "content": {"text": text}},
                    timeout=aiohttp.ClientTimeout(total=15),
                ) as response:
                    data = await response.json(content_type=None)
                    if response.status < 400 and data.get("code", 0) == 0:
                        return {"success": True, "status": "sent", "platform": self.platform_id, "data": data}
                    return self._api_error(data, response.status)
        except Exception as exc:
            return {"success": False, "status": "request_failed", "error": str(exc)}

    async def _get_tenant_access_token(self) -> Optional[str]:
        token = self.credentials.get("tenant_access_token") or self.credentials.get("access_token")
        if token:
            return str(token)
        app_id = self.credentials.get("app_id")
        app_secret = self.credentials.get("app_secret")
        if not app_id or not app_secret:
            return None

        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self.API_BASE}/auth/v3/tenant_access_token/internal",
                    json={"app_id": app_id, "app_secret": app_secret},
                    timeout=aiohttp.ClientTimeout(total=10),
                ) as response:
                    data = await response.json(content_type=None)
                    if response.status < 400 and data.get("code") == 0:
                        return data.get("tenant_access_token")
        except Exception:
            return None
        return None

    @staticmethod
    def _auth_headers(token: str) -> Dict[str, str]:
        return {"Authorization": f"Bearer {token}", "Content-Type": "application/json; charset=utf-8"}

    def _api_error(self, data: Dict[str, Any], status_code: int) -> Dict[str, Any]:
        return {
            "success": False,
            "status": "api_error",
            "platform": self.platform_id,
            "status_code": status_code,
            "code": data.get("code"),
            "error": data.get("msg") or data.get("message") or "Feishu API request failed",
            "data": data,
        }