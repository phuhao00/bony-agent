"""
金融资讯抓取工具

数据来源:
  - Bloomberg RSS   — 彭博社财经/市场/科技/经济
  - Yahoo Finance RSS — 全球财经资讯（路透社 RSS SSL 故障，以此替代）
  - CNBC RSS        — 美股及全球市场新闻
  - 东方财富 API    — Wind 类 A 股公告 + 实时指数行情

结果持久化到 storage/trending/financial_news.json
"""

import os
import json
import time
import hashlib
import logging
from datetime import datetime
from typing import List, Dict, Any, Optional

import requests
import xml.etree.ElementTree as ET

logger = logging.getLogger("financial_news")

_HTML_TAG_RE = __import__("re").compile(r"<[^>]*>")
_WHITESPACE_RE = __import__("re").compile(r"\s+")
_HTML_ENTITIES = {
    "&amp;": "&", "&lt;": "<", "&gt;": ">",
    "&quot;": '"', "&#39;": "'", "&nbsp;": " ",
    "&mdash;": "—", "&ndash;": "–", "&hellip;": "…",
}


def _strip_html(text: str) -> str:
    """Remove HTML tags and decode common entities."""
    if not text:
        return text
    for entity, char in _HTML_ENTITIES.items():
        text = text.replace(entity, char)
    text = _HTML_TAG_RE.sub(" ", text)
    return _WHITESPACE_RE.sub(" ", text).strip()

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TRENDING_DIR = os.path.join(PROJECT_ROOT, "storage", "trending")
FINANCIAL_FILE = os.path.join(TRENDING_DIR, "financial_news.json")
os.makedirs(TRENDING_DIR, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "application/rss+xml, application/xml, text/xml, */*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
}

TIMEOUT = 15

# ─── 全球指数配置（顺序对应 EastMoney secids 参数）─────────────────────────────

INDICES = [
    ("1.000001",   "上证指数",  "CNY"),
    ("0.399001",   "深证成指",  "CNY"),
    ("1.000300",   "沪深300",   "CNY"),
    ("100.HSI",    "恒生指数",  "HKD"),
    ("100.DJIA",   "道琼斯",    "USD"),
    ("100.NASDAQ", "纳斯达克",  "USD"),
    ("100.SP500",  "标普500",   "USD"),
    ("100.N225",   "日经225",   "JPY"),
]

# ─── RSS 解析助手 ────────────────────────────────────────────────────────────────

def _make_item(source: str, icon: str, category: str, title: str, desc: str, url: str, pub: str) -> Dict:
    uid = hashlib.md5((url or title + pub).encode()).hexdigest()[:16]
    return {
        "id": uid,
        "source": source,
        "source_icon": icon,
        "category": category,
        "title": _strip_html(title)[:200],
        "desc": _strip_html(desc)[:200],
        "url": url,
        "published_at": pub,
    }


def _parse_rss(url: str, source: str, source_icon: str, category: str, max_items: int = 15) -> List[Dict]:
    """通用 RSS / Atom feed 解析器"""
    items = []
    try:
        resp = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
        resp.raise_for_status()
        root = ET.fromstring(resp.content)

        # Try Atom
        ns = {"a": "http://www.w3.org/2005/Atom"}
        if root.tag.endswith("}feed") or root.tag == "feed":
            for entry in root.findall("a:entry", ns)[:max_items]:
                title = (entry.findtext("a:title", namespaces=ns) or "").strip()
                link_el = entry.find("a:link", ns)
                link = link_el.get("href", "") if link_el is not None else ""
                summary = (entry.findtext("a:summary", namespaces=ns) or "").strip()
                pub = (entry.findtext("a:published", namespaces=ns) or "").strip()
                items.append(_make_item(source, source_icon, category, title, summary, link, pub))
            return items

        # RSS 2.0
        channel = root.find("channel")
        if channel is None:
            return items
        for item in channel.findall("item")[:max_items]:
            title = (item.findtext("title") or "").strip()
            link = (item.findtext("link") or "").strip()
            desc = (item.findtext("description") or "").strip()
            pub = (item.findtext("pubDate") or "").strip()
            items.append(_make_item(source, source_icon, category, title, desc, link, pub))
    except Exception as e:
        logger.warning(f"RSS parse failed [{source}] {url}: {e}")
    return items


# ─── 彭博社 Bloomberg ───────────────────────────────────────────────────────────

def _fetch_bloomberg() -> List[Dict]:
    feeds = [
        ("https://feeds.bloomberg.com/markets/news.rss",    "Markets 市场"),
        ("https://feeds.bloomberg.com/technology/news.rss", "Technology 科技"),
        ("https://feeds.bloomberg.com/economics/news.rss",  "Economics 经济"),
    ]
    items = []
    for url, cat in feeds:
        items.extend(_parse_rss(url, "Bloomberg", "📊", cat, max_items=8))
        time.sleep(0.2)
    return items


# ─── 路透社 Reuters ──────────────────────────────────────────────────────────────

def _fetch_reuters_news() -> List[Dict]:
    """路透社资讯 — 通过 Google News RSS 搜索抓取（直连 feeds.reuters.com 因 SSL EOF 故障不可用）"""
    items: List[Dict] = []

    # Google News RSS 搜索路透社内容（三个主题，各取 10 条）
    gnews_feeds = [
        (
            "https://news.google.com/rss/search?q=site:reuters.com+finance+markets"
            "&hl=en-US&gl=US&ceid=US:en",
            "Finance 财经",
        ),
        (
            "https://news.google.com/rss/search?q=site:reuters.com+economy+business"
            "&hl=en-US&gl=US&ceid=US:en",
            "Economy 经济",
        ),
        (
            "https://news.google.com/rss/search?q=site:reuters.com+stock+market"
            "&hl=en-US&gl=US&ceid=US:en",
            "Markets 市场",
        ),
    ]

    seen: set = set()
    for url, cat in gnews_feeds:
        try:
            resp = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
            resp.raise_for_status()
            root = ET.fromstring(resp.content)
            channel = root.find("channel")
            if channel is None:
                continue
            count = 0
            for entry in channel.findall("item"):
                if count >= 10:
                    break
                raw_title = (entry.findtext("title") or "").strip()
                # Google News 标题格式：「文章标题 - 来源」，去掉尾部来源名
                title = raw_title
                for suffix in (" - Reuters", " - REUTERS"):
                    if title.endswith(suffix):
                        title = title[: -len(suffix)].strip()
                        break

                link = (entry.findtext("link") or "").strip()
                desc = (entry.findtext("description") or "").strip()
                pub = (entry.findtext("pubDate") or "").strip()

                uid = hashlib.md5((link or raw_title).encode()).hexdigest()[:16]
                if uid in seen:
                    continue
                seen.add(uid)

                items.append(
                    _make_item("Reuters", "📰", cat, title, desc, link, pub)
                )
                count += 1
        except Exception as e:
            logger.warning(f"Reuters (Google News) failed [{cat}]: {e}")
        time.sleep(0.3)

    return items


# ─── 国际财经（Yahoo Finance + CNBC）──────────────────────────────────────────

def _fetch_international() -> List[Dict]:
    """Yahoo Finance + CNBC RSS，在前端以「路透社」Tab 展示"""
    feeds = [
        ("https://finance.yahoo.com/rss/topstories",                    "Yahoo Finance", "🟣", "Finance 财经"),
        ("https://www.cnbc.com/id/100003114/device/rss/rss.html",       "CNBC",          "🔵", "Business 商业"),
        ("https://www.cnbc.com/id/10000664/device/rss/rss.html",        "CNBC",          "🔵", "Markets 市场"),
        ("https://feeds.marketwatch.com/marketwatch/topstories/",       "MarketWatch",   "🟠", "Markets 市场"),
    ]
    items = []
    for url, src, icon, cat in feeds:
        items.extend(_parse_rss(url, src, icon, cat, max_items=8))
        time.sleep(0.2)
    return items


# ─── Wind / 东方财富 ─────────────────────────────────────────────────────────────

def _fetch_eastmoney_ann() -> List[Dict]:
    """东方财富 A股公告（Wind 类数据源）"""
    items = []
    try:
        url = "https://np-anotice-stock.eastmoney.com/api/security/ann"
        params = {
            "sr": -1,
            "page_size": 20,
            "page_index": 1,
            "ann_type": "SHA,SZA",
            "client_source": "web",
        }
        hdrs = {**HEADERS, "Referer": "https://www.eastmoney.com/"}
        resp = requests.get(url, params=params, headers=hdrs, timeout=TIMEOUT)
        data = resp.json()
        for ann in data.get("data", {}).get("list", [])[:20]:
            title = (ann.get("title") or ann.get("title_ch") or "").strip()
            codes_list = ann.get("codes") or []
            first_code = codes_list[0] if codes_list else {}
            stock_code = first_code.get("stock_code", "")
            stock_name = first_code.get("short_name", "")
            ann_time = ann.get("display_time") or ann.get("notice_date") or ""
            art_code = ann.get("art_code", "")
            link = (
                f"https://data.eastmoney.com/notices/detail/{stock_code}/{art_code},1.html"
                if art_code and stock_code else ""
            )
            items.append({
                "id": hashlib.md5((art_code + title).encode()).hexdigest()[:16],
                "source": "Wind/东财",
                "source_icon": "🌬️",
                "category": "公告 Announcement",
                "title": title,
                "desc": f"[{stock_code}] {stock_name}" if stock_code else "",
                "url": link,
                "published_at": ann_time,
                "stock_code": stock_code,
                "stock_name": stock_name,
            })
    except Exception as e:
        logger.warning(f"EastMoney announcements failed: {e}")
    return items


# ─── 全球指数行情 ─────────────────────────────────────────────────────────────────

def _fetch_market_quotes() -> List[Dict]:
    """全球主要股指行情（东方财富实时 API）"""
    secids = ",".join(idx[0] for idx in INDICES)
    url = "https://push2.eastmoney.com/api/qt/ulist.np/get"
    params = {
        "fltt": 2,
        "invt": 2,
        "secids": secids,
        "fields": "f1,f2,f3,f4,f12,f13,f14",
    }
    hdrs = {**HEADERS, "Referer": "https://finance.eastmoney.com/"}

    try:
        resp = requests.get(url, params=params, headers=hdrs, timeout=TIMEOUT)
        data = resp.json()
        # diff is a list, ordered by the secids parameter
        diff: list = data.get("data", {}).get("diff") or []
        items = []
        for i, d in enumerate(diff):
            if i >= len(INDICES):
                break
            idx_id, idx_label, currency = INDICES[i]
            api_name = d.get("f14") or idx_label
            price = d.get("f2", "-")
            change_pct = d.get("f3", 0)
            change_val = d.get("f4", 0)
            try:
                pct_f = float(change_pct)
                arrow = "↑" if pct_f >= 0 else "↓"
                color = "green" if pct_f >= 0 else "red"
            except (TypeError, ValueError):
                arrow = ""
                color = "gray"
            items.append({
                "id": idx_id,
                "name": api_name,
                "label": idx_label,
                "price": price,
                "change_pct": change_pct,
                "change_val": change_val,
                "currency": currency,
                "arrow": arrow,
                "color": color,
            })
        return items
    except Exception as e:
        logger.warning(f"Market quotes failed: {e}")
        return [
            {
                "id": idx[0], "name": idx[1], "label": idx[1], "price": "-",
                "change_pct": 0, "change_val": 0, "currency": idx[2], "arrow": "", "color": "gray",
            }
            for idx in INDICES
        ]


# ─── 主聚合 ─────────────────────────────────────────────────────────────────────

def fetch_all_financial_news() -> Dict[str, Any]:
    """抓取所有金融资讯数据并返回聚合结果"""
    logger.info("Fetching financial news data...")

    bloomberg = _fetch_bloomberg()
    reuters_news = _fetch_reuters_news()
    intl = _fetch_international()   # Yahoo Finance + CNBC
    wind = _fetch_eastmoney_ann()
    quotes = _fetch_market_quotes()

    result = {
        "fetched_at": datetime.now().isoformat(),
        "bloomberg": bloomberg,
        "reuters_news": reuters_news,  # 路透社专区
        "reuters": intl,   # 国际财经（Yahoo Finance + CNBC）
        "wind": wind,
        "market_quotes": quotes,
        "meta": {
            "bloomberg_count": len(bloomberg),
            "reuters_news_count": len(reuters_news),
            "reuters_count": len(intl),
            "wind_count": len(wind),
        },
    }

    _save_financial_news(result)
    logger.info(
        f"Financial news fetched: Bloomberg={len(bloomberg)}, "
        f"Reuters={len(reuters_news)}, Intl={len(intl)}, Wind={len(wind)}, Quotes={len(quotes)}"
    )
    return result


def _save_financial_news(data: Dict[str, Any]) -> None:
    try:
        with open(FINANCIAL_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        logger.error(f"Failed to save financial news: {e}")


def load_financial_news() -> Optional[Dict[str, Any]]:
    """读取本地缓存，若缓存超过 30 分钟则返回 None"""
    try:
        if not os.path.exists(FINANCIAL_FILE):
            return None
        if time.time() - os.path.getmtime(FINANCIAL_FILE) > 1800:
            return None
        with open(FINANCIAL_FILE, encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"Failed to load financial news cache: {e}")
        return None


def get_financial_news(force_refresh: bool = False) -> Dict[str, Any]:
    """获取金融资讯，优先使用缓存"""
    if not force_refresh:
        cached = load_financial_news()
        if cached:
            return cached
    return fetch_all_financial_news()
