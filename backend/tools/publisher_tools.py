import json
import os
import time
import asyncio
from typing import Dict, List, Optional, Any
from langchain.tools import tool
from tools.connectors.manager import get_connector_manager
from utils.media_resolver import normalize_publish_media
from utils.logger import setup_logger

logger = setup_logger("publisher_tools")

# Mock database for published content (keeping for history tracking)
PUBLISHED_CONTENT_DB = "published_content.json"

def load_published_content():
    if os.path.exists(PUBLISHED_CONTENT_DB):
        try:
            with open(PUBLISHED_CONTENT_DB, "r", encoding="utf-8") as f:
                return json.load(f)
        except:
            return []
    return []

def save_published_content(content):
    with open(PUBLISHED_CONTENT_DB, "w", encoding="utf-8") as f:
        json.dump(content, f, ensure_ascii=False, indent=2)

@tool("publish_content")
async def publish_content_tool(platform: str, content: str, title: str = "", media_urls: List[str] = None) -> str:
    """
    通过真实平台连接器发布内容。
    会自动识别内容的类型（图文/视频/混合）。
    
    Args:
        platform: 目标平台 (xiaohongshu, bilibili, douyin, twitter, youtube, kuaishou, weibo)
        content: 正文内容或描述
        title: 标题（如果有）
        media_urls: 媒体文件路径列表 (如视频或图片)
        
    Returns:
        JSON 格式的发布结果
    """
    try:
        manager = get_connector_manager()
        root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
        outputs_dir = os.path.join(root_dir, "storage", "outputs")
        media_urls = normalize_publish_media(
            media_urls=media_urls,
            content=content,
            content_type="mixed",
            outputs_dir=outputs_dir,
            logger=logger,
        )

        # 记录开始
        logger.info("[publisher] publish_content platform=%s title=%r media_count=%d",
                    platform, title or "(none)", len(media_urls) if media_urls else 0)
        
        # 执行真实发布 (使用 "mixed" 让 Connector 自动识别)
        result = await manager.publish_to_platform(
            platform_id=platform,
            content_type="mixed",
            title=title,
            content=content,
            media_urls=media_urls or []
        )
        
        result_dict = result.to_dict()
        logger.info("[publisher] publish done platform=%s success=%s post_id=%s",
                    platform, result.success, result.post_id)
        
        # 保存到历史记录以供追踪
        history = load_published_content()
        history.append({
            "task_id": result.post_id or f"pub_{int(time.time())}",
            "platform": platform,
            "content": content,
            "title": title,
            "media": media_urls,
            "result": result_dict,
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S")
        })
        save_published_content(history)
        
        return json.dumps({"success": result.success, "data": result_dict}, ensure_ascii=False)
        
    except Exception as e:
        logger.error("[publisher] publish_content error platform=%s: %s", platform, e, exc_info=True)
        return json.dumps({"success": False, "error": str(e)}, ensure_ascii=False)


# workflow_engine._try_import("tools.publisher_tools", "publish_content") 使用模块属性名，非 @tool 注册名
publish_content = publish_content_tool

@tool("get_publish_accounts")
def get_publish_accounts_tool() -> str:
    """
    获取当前已连接并可用的社交媒体账号列表。
    """
    try:
        logger.info("[publisher] get_publish_accounts_tool called")
        manager = get_connector_manager()
        platforms = manager.get_all_platforms()
        connected = [p for p in platforms if p['connected']]
        logger.info("[publisher] %d/%d platform(s) connected", len(connected), len(platforms))
        return json.dumps(connected, ensure_ascii=False)
    except Exception as e:
        logger.error("[publisher] get_publish_accounts_tool error: %s", e, exc_info=True)
        return json.dumps([], ensure_ascii=False)
