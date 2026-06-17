"""
社交媒体热点爬取工具 (Social Media Trend Scraper)

实时从以下平台拉取热点内容:
  - 抖音: 热搜榜 (Playwright)
  - B站: 热门视频排行 (官方 API, 无需 key)
  - 小红书: 探索页热门笔记 (Playwright)

结果持久化到 storage/trending/social_trends.json
提供 @tool 函数供 LangGraph Agent 调用
"""

import os
import json
import logging
import asyncio
from datetime import datetime
from typing import List, Dict, Optional

import requests
from langchain.tools import tool

logger = logging.getLogger("social_trending")

# 数据存储路径
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TRENDING_DIR = os.path.join(PROJECT_ROOT, "storage", "trending")
SOCIAL_TRENDING_FILE = os.path.join(TRENDING_DIR, "social_trends.json")
os.makedirs(TRENDING_DIR, exist_ok=True)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Referer": "https://www.bilibili.com/",
}


# ------------------------------------------------------------------
# B站热门视频 (官方 API, 无需鉴权)
# ------------------------------------------------------------------

def _fetch_bilibili_trending(limit: int = 10) -> List[Dict]:
    """B站热门视频排行（旧版公开 API，无需鉴权）"""
    items = []
    try:
        # v2 API 需要 cookie，使用将洒出错 code -352；改用旧版 v1 API
        url = "https://api.bilibili.com/x/web-interface/ranking?rid=0&day=3"
        resp = requests.get(url, headers=HEADERS, timeout=10)
        data = resp.json()
        videos = data.get("data", {}).get("list", [])

        for idx, v in enumerate(videos[:limit]):
            items.append({
                "id": f"bili_{v.get('bvid', idx)}",
                "source": "B站",
                "source_icon": "📺",
                "platform": "bilibili",
                "title": v.get("title", ""),
                "author": v.get("owner", {}).get("name", ""),
                "url": f"https://www.bilibili.com/video/{v.get('bvid', '')}",
                "cover": v.get("pic", ""),
                "view_count": v.get("play", 0),
                "like_count": v.get("pts", 0),
                "description": v.get("describe", ""),
                "rank": idx + 1,
                "fetched_at": datetime.now().isoformat(),
            })
    except Exception as e:
        logger.warning(f"[B站热门] 抓取失败: {e}")
    return items


# ------------------------------------------------------------------
# 抖音热搜 (Playwright)
# ------------------------------------------------------------------

def _fetch_douyin_hot(limit: int = 10) -> List[Dict]:
    """抖音热搜榜（Playwright 抓取）"""
    items = []
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(
                user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                locale="zh-CN",
            )
            page = context.new_page()
            page.goto("https://www.douyin.com/hot", timeout=30000, wait_until="domcontentloaded")
            page.wait_for_timeout(5000)

            # 尝试提取热搜列表
            # 抖音的热搜通常在 .hot-list 或 .board-container 类下
            hot_items = page.query_selector_all("[data-e2e='hot-list-item'], .c-span8, .board-item-title")

            if not hot_items:
                # 降级：通过文本内容解析
                text = page.locator("body").inner_text()
                lines = [l.strip() for l in text.split("\n") if l.strip() and len(l.strip()) > 2]
                # 粗略找到热搜入口
                for i, line in enumerate(lines):
                    if len(items) >= limit:
                        break
                    if 2 < len(line) < 40 and not any(c in line for c in ["登录", "注册", "抖音", "首页", "搜索"]):
                        items.append({
                            "id": f"douyin_{i}",
                            "source": "抖音热搜",
                            "source_icon": "🎵",
                            "platform": "douyin",
                            "title": line,
                            "url": f"https://www.douyin.com/search/{requests.utils.quote(line)}",
                            "cover": "",
                            "rank": len(items) + 1,
                            "fetched_at": datetime.now().isoformat(),
                        })
            else:
                for idx, el in enumerate(hot_items[:limit]):
                    title = el.inner_text().strip()
                    if title:
                        items.append({
                            "id": f"douyin_{idx}",
                            "source": "抖音热搜",
                            "source_icon": "🎵",
                            "platform": "douyin",
                            "title": title,
                            "url": f"https://www.douyin.com/search/{requests.utils.quote(title)}",
                            "cover": "",
                            "rank": idx + 1,
                            "fetched_at": datetime.now().isoformat(),
                        })
            browser.close()
    except Exception as e:
        logger.warning(f"[抖音热搜] 抓取失败: {e}")

    # 降级：使用公开 API 聚合
    if not items:
        items = _fetch_douyin_hot_api_fallback(limit)

    return items


def _fetch_douyin_hot_api_fallback(limit: int = 10) -> List[Dict]:
    """抖音热搜降级方案：通过第三方热榜聚合 API"""
    items = []
    try:
        # 微博/抖音热搜聚合源（不需要登录）
        url = "https://tenapi.cn/v2/douyinhot"
        resp = requests.get(url, headers=HEADERS, timeout=8)
        data = resp.json()
        hot_list = data.get("data", [])
        for idx, item in enumerate(hot_list[:limit]):
            items.append({
                "id": f"douyin_api_{idx}",
                "source": "抖音热搜",
                "source_icon": "🎵",
                "platform": "douyin",
                "title": item.get("name", ""),
                "url": item.get("url", ""),
                "hot_value": item.get("hot", ""),
                "cover": "",
                "rank": idx + 1,
                "fetched_at": datetime.now().isoformat(),
            })
    except Exception as e:
        logger.warning(f"[抖音热搜-降级] 抓取失败: {e}")
    return items


# ------------------------------------------------------------------
# 小红书探索页热门 (Playwright)
# ------------------------------------------------------------------

def _fetch_xiaohongshu_hot(limit: int = 10) -> List[Dict]:
    """小红书探索页热门笔记（Playwright 抓取）"""
    items = []
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(
                user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                locale="zh-CN",
            )
            page = context.new_page()
            page.goto("https://www.xiaohongshu.com/explore", timeout=30000, wait_until="domcontentloaded")
            page.wait_for_timeout(5000)

            # 提取笔记卡片标题
            note_titles = page.query_selector_all(".note-slider-item .title, .cover-title, [class*='title']")

            for idx, el in enumerate(note_titles[:limit]):
                title = el.inner_text().strip()
                if title and len(title) > 1:
                    # 尝试获取封面图
                    cover = ""
                    try:
                        img = el.query_selector("img") or el.evaluate_handle("el => el.closest('.note-item')?.querySelector('img')")
                        if img:
                            cover = img.get_attribute("src") or ""
                    except Exception:
                        pass

                    items.append({
                        "id": f"xhs_{idx}",
                        "source": "小红书",
                        "source_icon": "📕",
                        "platform": "xiaohongshu",
                        "title": title,
                        "url": "https://www.xiaohongshu.com/explore",
                        "cover": cover,
                        "rank": len(items) + 1,
                        "fetched_at": datetime.now().isoformat(),
                    })
                    if len(items) >= limit:
                        break

            browser.close()
    except Exception as e:
        logger.warning(f"[小红书] 抓取失败: {e}")

    # 降级方案
    if not items:
        items = _fetch_xiaohongshu_hot_fallback(limit)

    return items


def _fetch_xiaohongshu_hot_fallback(limit: int = 10) -> List[Dict]:
    """小红书热门降级：通过第三方热榜 API"""
    items = []
    try:
        url = "https://tenapi.cn/v2/xhshot"
        resp = requests.get(url, headers=HEADERS, timeout=8)
        data = resp.json()
        hot_list = data.get("data", [])
        for idx, item in enumerate(hot_list[:limit]):
            items.append({
                "id": f"xhs_api_{idx}",
                "source": "小红书热搜",
                "source_icon": "📕",
                "platform": "xiaohongshu",
                "title": item.get("name", ""),
                "url": item.get("url", ""),
                "cover": "",
                "rank": idx + 1,
                "fetched_at": datetime.now().isoformat(),
            })
    except Exception as e:
        logger.warning(f"[小红书-降级] 抓取失败: {e}")
    return items


# ------------------------------------------------------------------
# 主聚合函数
# ------------------------------------------------------------------

def fetch_social_trending(platforms: List[str] = None, limit: int = 10) -> Dict:
    """
    聚合多个社交平台的热点内容。

    Args:
        platforms: 平台列表 ["bilibili", "douyin", "xiaohongshu"]，默认全部
        limit: 每个平台获取热点数量
    """
    if platforms is None:
        platforms = ["bilibili", "douyin", "xiaohongshu"]

    logger.info(f"🦞 开始抓取社交热点 platforms={platforms}, limit={limit}")
    result = {
        "fetched_at": datetime.now().isoformat(),
        "sources": {},
        "summary": {},
    }

    if "bilibili" in platforms:
        items = _fetch_bilibili_trending(limit)
        result["sources"]["bilibili"] = items
        result["summary"]["bilibili_count"] = len(items)

    if "douyin" in platforms:
        items = _fetch_douyin_hot(limit)
        result["sources"]["douyin"] = items
        result["summary"]["douyin_count"] = len(items)

    if "xiaohongshu" in platforms:
        items = _fetch_xiaohongshu_hot(limit)
        result["sources"]["xiaohongshu"] = items
        result["summary"]["xiaohongshu_count"] = len(items)

    result["summary"]["total"] = sum(result["summary"].values())

    # 持久化
    try:
        with open(SOCIAL_TRENDING_FILE, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
        logger.info(f"🦞 社交热点抓取完成，共 {result['summary']['total']} 条")
    except Exception as e:
        logger.error(f"保存热点数据失败: {e}")

    return result


def load_social_trending() -> Dict:
    """读取最近一次抓取结果"""
    if os.path.exists(SOCIAL_TRENDING_FILE):
        try:
            with open(SOCIAL_TRENDING_FILE, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {"fetched_at": None, "sources": {}, "summary": {"total": 0}}


def get_top_social_topics(limit: int = 5) -> List[str]:
    """返回当前最热的社交话题标题列表（供 Agent 使用）"""
    data = load_social_trending()
    topics = []

    # B站优先（通常有描述性标题）
    for item in data.get("sources", {}).get("bilibili", [])[:3]:
        if item.get("title"):
            topics.append(f"B站热门「{item['title']}」")

    # 抖音热搜
    for item in data.get("sources", {}).get("douyin", [])[:2]:
        if item.get("title"):
            topics.append(f"抖音热搜「{item['title']}」")

    # 小红书
    for item in data.get("sources", {}).get("xiaohongshu", [])[:2]:
        if item.get("title"):
            topics.append(item["title"])

    return topics[:limit]


# ------------------------------------------------------------------
# LangChain Tool 接口
# ------------------------------------------------------------------

@tool
def collect_social_trends(platforms: str = "bilibili,douyin,xiaohongshu", limit: int = 8) -> str:
    """
    🦞 实时抓取多平台社交媒体热点内容（抖音热搜、B站热门、小红书探索）。

    Args:
        platforms: 逗号分隔的平台列表，可选: bilibili, douyin, xiaohongshu
        limit: 每个平台抓取的热点数量，默认 8

    Returns:
        JSON 格式的热点数据，包含标题、链接、作者、播放量等信息
    """
    try:
        platform_list = [p.strip() for p in platforms.split(",") if p.strip()]
        data = fetch_social_trending(platform_list, limit)

        # 格式化摘要输出
        summary_lines = [f"✅ 热点收集完成！共 {data['summary'].get('total', 0)} 条\n"]

        for platform in platform_list:
            items = data["sources"].get(platform, [])
            if items:
                platform_names = {"bilibili": "B站", "douyin": "抖音", "xiaohongshu": "小红书"}
                display = platform_names.get(platform, platform)
                summary_lines.append(f"\n**{display} Top {len(items)}:**")
                for item in items[:5]:
                    summary_lines.append(f"  {item['rank']}. {item['title']}")

        return "\n".join(summary_lines) + f"\n\n完整数据已保存到 storage/trending/social_trends.json"

    except Exception as e:
        logger.error(f"collect_social_trends failed: {e}")
        return f"❌ 热点收集失败: {str(e)}"


@tool
def get_hot_topics(limit: int = 5, force_refresh: bool = False) -> str:
    """
    获取当前社交媒体热点话题。

    Args:
        limit: 返回话题数量
        force_refresh: 是否立即重新抓取

    Returns:
        热点话题列表
    """
    if force_refresh:
        fetch_social_trending(["bilibili", "douyin", "xiaohongshu"], max(limit, 5))

    topics = get_top_social_topics(limit)
    if not topics:
        fetch_social_trending(["bilibili", "douyin", "xiaohongshu"], max(limit, 5))
        topics = get_top_social_topics(limit)

    if not topics:
        return "❌ 暂无可用的社交热点数据"

    return "\n".join(f"{index + 1}. {topic}" for index, topic in enumerate(topics))
