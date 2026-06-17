"""
游戏热点抓取服务

每小时从以下平台拉取游戏热点数据:
  - Steam: 热销榜、新品推荐、特惠信息（通过官方 API + 页面）
  - Epic: 免费游戏与本周特选
  - TapTap: 热门榜单 (Playwright)

结果持久化到 storage/trending/gaming_trends.json
提供 HTTP API 给前端展示 + 定时任务使用
"""

import os
import json
import time
import hashlib
import asyncio
import logging
from datetime import datetime
from typing import List, Dict, Any, Optional

import requests
from langchain.tools import tool

logger = logging.getLogger("gaming_trending")

# 数据存储路径
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TRENDING_DIR = os.path.join(PROJECT_ROOT, "storage", "trending")
TRENDING_FILE = os.path.join(TRENDING_DIR, "gaming_trends.json")
os.makedirs(TRENDING_DIR, exist_ok=True)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
}


# ------------------------------------------------------------------
# 数据源抓取
# ------------------------------------------------------------------

def _fetch_steam_top_sellers() -> List[Dict]:
    """Steam 热销榜 (官方 API, 无需 key)"""
    items = []
    try:
        url = "https://store.steampowered.com/api/featuredcategories/?cc=cn&l=schinese"
        resp = requests.get(url, headers=HEADERS, timeout=10)
        data = resp.json()

        # top sellers
        for item in data.get("top_sellers", {}).get("items", [])[:10]:
            items.append({
                "id": f"steam_{item.get('id')}",
                "source": "Steam",
                "source_icon": "🎮",
                "title": item.get("name", ""),
                "category": "热销",
                "url": f"https://store.steampowered.com/app/{item.get('id')}",
                "cover": item.get("large_capsule_image", ""),
                "price": item.get("final_price", 0) / 100 if item.get("final_price") else 0,
                "discount": item.get("discount_percent", 0),
                "rank": len(items) + 1,
            })
    except Exception as e:
        logger.warning(f"[Steam热销] 抓取失败: {e}")

    return items


def _fetch_steam_new_releases() -> List[Dict]:
    """Steam 新品上架"""
    items = []
    try:
        url = "https://store.steampowered.com/api/featuredcategories/?cc=cn&l=schinese"
        resp = requests.get(url, headers=HEADERS, timeout=10)
        data = resp.json()

        for item in data.get("new_releases", {}).get("items", [])[:8]:
            items.append({
                "id": f"steam_new_{item.get('id')}",
                "source": "Steam新品",
                "source_icon": "✨",
                "title": item.get("name", ""),
                "category": "新品",
                "url": f"https://store.steampowered.com/app/{item.get('id')}",
                "cover": item.get("large_capsule_image", ""),
                "price": item.get("final_price", 0) / 100 if item.get("final_price") else 0,
                "discount": item.get("discount_percent", 0),
                "rank": len(items) + 1,
            })
    except Exception as e:
        logger.warning(f"[Steam新品] 抓取失败: {e}")
    return items


def _fetch_steam_specials() -> List[Dict]:
    """Steam 特惠游戏"""
    items = []
    try:
        url = "https://store.steampowered.com/api/featuredcategories/?cc=cn&l=schinese"
        resp = requests.get(url, headers=HEADERS, timeout=10)
        data = resp.json()

        for item in data.get("specials", {}).get("items", [])[:8]:
            discount = item.get("discount_percent", 0)
            if discount > 0:
                items.append({
                    "id": f"steam_deal_{item.get('id')}",
                    "source": "Steam特惠",
                    "source_icon": "💰",
                    "title": item.get("name", ""),
                    "category": "特惠",
                    "url": f"https://store.steampowered.com/app/{item.get('id')}",
                    "cover": item.get("large_capsule_image", ""),
                    "price": item.get("final_price", 0) / 100 if item.get("final_price") else 0,
                    "discount": discount,
                    "rank": len(items) + 1,
                })
    except Exception as e:
        logger.warning(f"[Steam特惠] 抓取失败: {e}")
    return items


def _fetch_epic_free_games() -> List[Dict]:
    """Epic Games 免费游戏/特惠"""
    items = []
    try:
        url = "https://store-site-backend-static-ipv4.ak.epicgames.com/freeGamesPromotions?locale=zh-CN&country=CN&allowCountries=CN"
        resp = requests.get(url, headers=HEADERS, timeout=10)
        data = resp.json()
        games = data.get("data", {}).get("Catalog", {}).get("searchStore", {}).get("elements", [])
        
        for item in games[:10]:
            title = item.get("title", "")
            if not title: continue
            
            # Find cover image
            cover = ""
            for img in item.get("keyImages", []):
                if img.get("type") in ["OfferImageWide", "Thumbnail"]:
                    cover = img.get("url")
                    break
            
            # Check price/discount info
            price_info = item.get("price", {}).get("totalPrice", {})
            original_price = price_info.get("originalPrice", 0) / 100
            discount = price_info.get("discount", 0) / 100
            
            # Epic URL usually: https://store.epicgames.com/zh-CN/p/{productSlug}
            slug = item.get("productSlug") or item.get("catalogNs", {}).get("mappings", [{}])[0].get("pageSlug") or "store"
            
            items.append({
                "id": f"epic_{item.get('id')}",
                "source": "Epic游戏",
                "source_icon": "🎁",
                "title": title,
                "category": "Epic精选",
                "url": f"https://store.epicgames.com/zh-CN/p/{slug}",
                "cover": cover,
                "price": original_price - discount,
                "discount": 100 if original_price > 0 and discount == original_price else 0, # Simplify 100% free check
                "rank": len(items) + 1,
            })
    except Exception as e:
        logger.warning(f"[Epic] 抓取失败: {e}")
    return items


def _fetch_taptap_hot() -> List[Dict]:
    """TapTap 热门游戏 (通过 Playwright + Googlebot UA 抓取网页避开 WAF)"""
    items = []
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page(user_agent="Googlebot/2.1 (+http://www.google.com/bot.html)")
            page.goto("https://www.taptap.cn/top/download", wait_until="networkidle", timeout=20000)
            
            # 由于 DOM 经常变化且被混淆，直接提取纯文本进行按行解析
            text = page.locator("body").inner_text()
            lines = text.split("\n")
            
            # 定位榜单起始位置
            start_idx = 0
            for i, line in enumerate(lines):
                if line.strip() == "按最近下载热度计算 · 每 20 分钟更新":
                    start_idx = i + 1
                    break
                    
            rank = 1
            for i, line in enumerate(lines[start_idx:]):
                if line.strip() == str(rank):
                    # 下一行通常是游戏名称
                    game_name = lines[start_idx + i + 1].strip()
                    if game_name:
                        # 查找当前游戏对应的封面/截图 (alt 包含 "game_name 截图" 或 "game_nameicon")
                        cover = ""
                        try:
                            img_elem = page.locator(f"img[alt^='{game_name}']").first
                            if img_elem.count() > 0:
                                cover = img_elem.get_attribute("src") or ""
                        except Exception:
                            pass
                            
                        items.append({
                            "id": f"taptap_{rank}",
                            "source": "TapTap",
                            "source_icon": "🕹️",
                            "title": game_name,
                            "category": "TapTap热门",
                            "url": "https://www.taptap.cn/top/download",
                            "cover": cover,
                            "rank": rank,
                        })
                        rank += 1
                        if rank > 10:
                            break
                            
            browser.close()
    except Exception as e:
        logger.warning(f"[TapTap] 抓取失败 (Playwright): {e}")
    return items


# ------------------------------------------------------------------
# 主聚合函数
# ------------------------------------------------------------------

def fetch_all_trending() -> Dict:
    """
    聚合所有来源的游戏热点，返回结构化数据并保存到文件。
    """
    logger.info("🎮 开始抓取游戏热点...")
    started_at = datetime.now().isoformat()

    steam_hot = _fetch_steam_top_sellers()
    steam_new = _fetch_steam_new_releases()
    steam_deals = _fetch_steam_specials()
    epic = _fetch_epic_free_games()
    taptap = _fetch_taptap_hot()

    result = {
        "fetched_at": started_at,
        "sources": {
            "steam_hot": steam_hot,
            "steam_new": steam_new,
            "steam_deals": steam_deals,
            "epic": epic,
            "taptap": taptap,
        },
        "summary": {
            "steam_hot_count": len(steam_hot),
            "steam_new_count": len(steam_new),
            "steam_deals_count": len(steam_deals),
            "epic_count": len(epic),
            "taptap_count": len(taptap),
            "total": len(steam_hot) + len(steam_new) + len(steam_deals) + len(epic) + len(taptap),
        }
    }

    # 保存到文件
    try:
        with open(TRENDING_FILE, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
        logger.info(f"🎮 游戏热点抓取完成，共 {result['summary']['total']} 条")
    except Exception as e:
        logger.error(f"保存热点数据失败: {e}")

    return result


def load_trending() -> Dict:
    """读取最近一次抓取结果"""
    if os.path.exists(TRENDING_FILE):
        try:
            with open(TRENDING_FILE, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {"fetched_at": None, "sources": {}, "summary": {"total": 0}}


@tool
def get_gaming_trends(force_refresh: bool = False) -> str:
    """
    获取最新游戏热点数据。

    Args:
        force_refresh: 是否立即重新抓取

    Returns:
        游戏热点 JSON 摘要
    """
    data = fetch_all_trending() if force_refresh else load_trending()
    if not data.get("summary", {}).get("total"):
        data = fetch_all_trending()
    return json.dumps(data, ensure_ascii=False, indent=2)


@tool
def analyze_gaming_trends(force_refresh: bool = False) -> str:
    """
    对游戏热点进行结构化分析。

    Args:
        force_refresh: 是否立即重新抓取后再分析

    Returns:
        热点分析文本
    """
    data = fetch_all_trending() if force_refresh else load_trending()
    if not data.get("summary", {}).get("total"):
        data = fetch_all_trending()

    sources = data.get("sources", {})
    steam_hot = sources.get("steam_hot", [])
    steam_deals = sources.get("steam_deals", [])
    epic = sources.get("epic", [])
    taptap = sources.get("taptap", [])

    highlights = []
    if steam_hot:
        highlights.append(f"Steam 热销榜首：{steam_hot[0].get('title', '未知')}，说明 PC 端关注点集中在热销品类。")
    if steam_deals:
        top_deal = max(steam_deals, key=lambda item: item.get("discount", 0))
        highlights.append(
            f"Steam 折扣信号最强：{top_deal.get('title', '未知')}，折扣 {top_deal.get('discount', 0)}%，适合做“史低/捡漏”内容。"
        )
    if epic:
        free_count = sum(1 for item in epic if item.get("discount") == 100)
        highlights.append(f"Epic 当前可重点关注 {free_count} 款高价值免费/近乎免费内容。")
    if taptap:
        highlights.append(f"TapTap 榜单前列：{', '.join(item.get('title', '未知') for item in taptap[:3])}。")

    summary = data.get("summary", {})
    lines = [
        f"抓取时间：{data.get('fetched_at') or '未知'}",
        f"总热点数：{summary.get('total', 0)}",
        f"Steam 热销：{summary.get('steam_hot_count', 0)} 条，Steam 特惠：{summary.get('steam_deals_count', 0)} 条，Epic：{summary.get('epic_count', 0)} 条，TapTap：{summary.get('taptap_count', 0)} 条。",
        "热点结论：",
    ]
    if highlights:
        lines.extend(f"- {item}" for item in highlights)
    else:
        lines.append("- 当前暂无足够数据，建议稍后重试。")
    return "\n".join(lines)


def get_top_topics(limit: int = 5) -> List[str]:
    """
    返回当前最热 N 条游戏话题标题（供定时任务自动生成内容用）
    """
    data = load_trending()
    topics = []

    # 优先使用 Steam 热销
    for item in data.get("sources", {}).get("steam_hot", [])[:3]:
        if item.get("title"):
            topics.append(f"Steam热门「{item['title']}」")
            
    # Epic 免费
    for item in data.get("sources", {}).get("epic", [])[:2]:
        if item.get("title"):
            topics.append(f"Epic精选「{item['title']}」")

    # TapTap 手游
    for item in data.get("sources", {}).get("taptap", [])[:2]:
        if item.get("title"):
            topics.append(item["title"])

    return topics[:limit]
