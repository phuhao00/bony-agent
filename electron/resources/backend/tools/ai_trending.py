"""
AI 资讯热榜爬取服务

实时从以下平台拉取 AI 领域热点:
  - HuggingFace: 今日 Trending Models / Datasets / Spaces
  - GitHub: 今日 AI Trending Repos
  - X (Twitter): AI 相关热门话题（通过 DuckDuckGo 搜索聚合）

结果持久化到 storage/trending/ai_trends.json
提供 HTTP API 给前端展示与 Agent 调用
"""

import os
import json
import logging
import re
from datetime import datetime
from typing import List, Dict, Any, Optional

import requests
from langchain.tools import tool

logger = logging.getLogger("ai_trending")

# 数据存储路径
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TRENDING_DIR = os.path.join(PROJECT_ROOT, "storage", "trending")
AI_TRENDING_FILE = os.path.join(TRENDING_DIR, "ai_trends.json")
os.makedirs(TRENDING_DIR, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}


# ------------------------------------------------------------------
# HuggingFace Trending
# ------------------------------------------------------------------

def _fetch_huggingface_trending() -> Dict[str, List[Dict]]:
    """爬取 HuggingFace Trending (Models / Datasets / Spaces)"""
    results: Dict[str, List[Dict]] = {
        "models": [],
        "datasets": [],
        "spaces": [],
    }

    def _parse_hf_trending(category: str) -> List[Dict]:
        try:
            url = f"https://huggingface.co/{category}?sort=trending"
            resp = requests.get(url, headers=HEADERS, timeout=15)
            if resp.status_code != 200:
                logger.warning(f"HuggingFace {category} returned {resp.status_code}")
                return []

            from bs4 import BeautifulSoup
            soup = BeautifulSoup(resp.text, "html.parser")
            items = []

            # 解析卡片列表
            for card in soup.select("article.overview-card-wrapper, div[class*='CardCover'], article")[:15]:
                try:
                    # 标题/名称
                    title_el = (
                        card.select_one("h4")
                        or card.select_one("h3")
                        or card.select_one("[class*='title']")
                        or card.select_one("a")
                    )
                    if not title_el:
                        continue
                    title = title_el.get_text(strip=True)
                    if not title:
                        continue

                    # 链接
                    link_el = card.select_one("a[href]")
                    href = link_el["href"] if link_el else ""
                    if href and not href.startswith("http"):
                        href = f"https://huggingface.co{href}"

                    # 描述/likes
                    desc_el = card.select_one("p, [class*='desc']")
                    desc = desc_el.get_text(strip=True) if desc_el else ""

                    # 点赞数
                    likes_el = card.select_one("[class*='like'], [data-target*='like']")
                    likes = likes_el.get_text(strip=True) if likes_el else ""

                    items.append({
                        "id": f"hf_{category}_{len(items)}",
                        "source": "HuggingFace",
                        "source_icon": "🤗",
                        "category": category.rstrip("s").capitalize(),
                        "title": title,
                        "desc": desc[:120] if desc else "",
                        "url": href,
                        "likes": likes,
                    })
                except Exception:
                    continue

            return items
        except Exception as e:
            logger.error(f"HuggingFace {category} fetch error: {e}")
            return []

    results["models"] = _parse_hf_trending("models")
    results["datasets"] = _parse_hf_trending("datasets")
    results["spaces"] = _parse_hf_trending("spaces")
    return results


def _fetch_huggingface_api_trending() -> Dict[str, List[Dict]]:
    """使用 HuggingFace 非官方 API 获取 Trending (备用方案)"""
    results: Dict[str, List[Dict]] = {"models": [], "datasets": [], "spaces": []}
    endpoints = {
        "models": "https://huggingface.co/api/models?sort=trending&direction=-1&limit=20",
        "datasets": "https://huggingface.co/api/datasets?sort=trending&direction=-1&limit=20",
        "spaces": "https://huggingface.co/api/spaces?sort=trending&direction=-1&limit=20",
    }
    for cat, url in endpoints.items():
        try:
            resp = requests.get(url, headers=HEADERS, timeout=15)
            if resp.status_code != 200:
                continue
            data = resp.json()
            if not isinstance(data, list):
                continue
            for item in data[:20]:
                model_id = item.get("modelId") or item.get("id") or item.get("_id", "")
                title = model_id.split("/")[-1] if "/" in model_id else model_id
                author = model_id.split("/")[0] if "/" in model_id else ""
                likes = item.get("likes", 0)
                downloads = item.get("downloads", 0)
                tags = item.get("tags", [])[:5]

                results[cat].append({
                    "id": f"hf_{cat}_{model_id}",
                    "source": "HuggingFace",
                    "source_icon": "🤗",
                    "category": cat.rstrip("s").capitalize(),
                    "title": title,
                    "author": author,
                    "desc": " · ".join(str(t) for t in tags) if tags else "",
                    "url": f"https://huggingface.co/{model_id}",
                    "likes": str(likes),
                    "downloads": str(downloads),
                    "full_id": model_id,
                })
        except Exception as e:
            logger.error(f"HuggingFace API {cat} error: {e}")
    return results


# ------------------------------------------------------------------
# GitHub Trending (AI)
# ------------------------------------------------------------------

def _fetch_github_trending() -> List[Dict]:
    """爬取 GitHub 今日 AI Trending Repos"""
    items = []
    try:
        # 按语言 + 话题分别抓取
        urls = [
            ("https://github.com/trending?since=daily&spoken_language_code=", "综合"),
            ("https://github.com/trending/python?since=daily", "Python"),
        ]
        seen_ids: set = set()

        from bs4 import BeautifulSoup

        for url, lang_label in urls:
            try:
                resp = requests.get(url, headers=HEADERS, timeout=15)
                if resp.status_code != 200:
                    continue
                soup = BeautifulSoup(resp.text, "html.parser")

                for repo_el in soup.select("article.Box-row")[:15]:
                    try:
                        # 仓库名
                        h2 = repo_el.select_one("h2 a")
                        if not h2:
                            continue
                        full_name = h2.get_text(strip=True).replace("\n", "").replace(" ", "")
                        # 过滤非 AI 相关（宽松过滤）
                        repo_lower = full_name.lower()
                        desc_el = repo_el.select_one("p")
                        desc = desc_el.get_text(strip=True) if desc_el else ""
                        combined = (repo_lower + " " + desc.lower())

                        # 关键词过滤（保留 AI/ML/LLM 相关）
                        ai_keywords = [
                            "ai", "ml", "llm", "gpt", "model", "deep", "neural",
                            "learn", "train", "inference", "diffusion", "transformer",
                            "agent", "nlp", "computer-vision", "cv", "rl", "llama",
                            "stable", "generate", "vector", "embed", "rag", "chat",
                            "openai", "gemini", "claude", "mistral", "hugging",
                        ]
                        if not any(kw in combined for kw in ai_keywords):
                            continue

                        if full_name in seen_ids:
                            continue
                        seen_ids.add(full_name)

                        href = h2.get("href", "")
                        if href and not href.startswith("http"):
                            href = f"https://github.com{href}"

                        # Stars today
                        stars_today_el = repo_el.select_one("span.d-inline-block.float-sm-right")
                        stars_today = stars_today_el.get_text(strip=True) if stars_today_el else ""

                        # Total stars
                        stars_el = repo_el.select_one("a[href$='/stargazers']")
                        stars = stars_el.get_text(strip=True) if stars_el else ""

                        # Language
                        lang_el = repo_el.select_one("span[itemprop='programmingLanguage']")
                        lang = lang_el.get_text(strip=True) if lang_el else ""

                        items.append({
                            "id": f"gh_{full_name.replace('/', '_')}",
                            "source": "GitHub",
                            "source_icon": "⭐",
                            "category": "Trending",
                            "title": full_name,
                            "desc": desc[:150] if desc else "",
                            "url": href,
                            "stars": stars,
                            "stars_today": stars_today,
                            "language": lang,
                        })
                    except Exception:
                        continue
            except Exception as e:
                logger.error(f"GitHub trending {url} error: {e}")

        return items[:20]
    except Exception as e:
        logger.error(f"GitHub trending error: {e}")
        return []


# ------------------------------------------------------------------
# X (Twitter) AI 热点 (通过 DuckDuckGo 聚合)
# ------------------------------------------------------------------

def _fetch_x_ai_trending() -> List[Dict]:
    """
    通过 DuckDuckGo 搜索聚合 X/Twitter AI 相关热门内容。
    由于 X 需要登录，使用 DDG site:twitter.com/x.com 搜索代替。
    """
    items = []
    try:
        from utils.simple_ddg_search import ddg_html_search_structured

        queries = [
            "site:x.com OR site:twitter.com AI LLM trending today",
            "AI artificial intelligence trending news today 2025",
        ]

        seen_urls: set = set()
        for query in queries:
            try:
                result = ddg_html_search_structured(query, max_results=10)
                if not result.get("ok"):
                    continue
                for item in result.get("items", []):
                    url = item.get("url", "")
                    title = item.get("title", "")
                    snippet = item.get("snippet", "")
                    if not title or url in seen_urls:
                        continue
                    seen_urls.add(url)

                    # 判断来源
                    if "twitter.com" in url or "x.com" in url:
                        source = "X (Twitter)"
                        source_icon = "𝕏"
                    else:
                        source = "AI News"
                        source_icon = "📰"

                    items.append({
                        "id": f"x_{len(items)}",
                        "source": source,
                        "source_icon": source_icon,
                        "category": "AI 热点",
                        "title": title[:100],
                        "desc": snippet[:200] if snippet else "",
                        "url": url,
                    })
                    if len(items) >= 15:
                        break
            except Exception as e:
                logger.warning(f"DDG query error: {e}")

        return items
    except Exception as e:
        logger.error(f"X AI trending error: {e}")
        return []


# ------------------------------------------------------------------
# 持久化
# ------------------------------------------------------------------

def load_ai_trending() -> Dict[str, Any]:
    """从缓存文件加载 AI 热榜数据"""
    if os.path.exists(AI_TRENDING_FILE):
        try:
            with open(AI_TRENDING_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.warning(f"Failed to load ai trends cache: {e}")
    return {}


def save_ai_trending(data: Dict[str, Any]) -> None:
    """保存 AI 热榜数据到缓存文件"""
    try:
        with open(AI_TRENDING_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        logger.error(f"Failed to save ai trends: {e}")


def fetch_all_ai_trending() -> Dict[str, Any]:
    """抓取所有 AI 热榜数据并返回聚合结果"""
    logger.info("Fetching AI trending data...")

    # 优先使用 API (更稳定)
    hf_data = _fetch_huggingface_api_trending()
    # 如果 API 返回为空，降级到 HTML 爬取
    if not any(hf_data.values()):
        logger.info("HuggingFace API empty, falling back to HTML scraping")
        hf_data = _fetch_huggingface_trending()

    github_items = _fetch_github_trending()
    x_items = _fetch_x_ai_trending()

    result = {
        "fetched_at": datetime.now().isoformat(),
        "huggingface": hf_data,
        "github": github_items,
        "x_ai": x_items,
    }

    save_ai_trending(result)
    logger.info(
        f"AI trending fetched: HF models={len(hf_data.get('models', []))}, "
        f"HF datasets={len(hf_data.get('datasets', []))}, "
        f"HF spaces={len(hf_data.get('spaces', []))}, "
        f"GitHub={len(github_items)}, X={len(x_items)}"
    )
    return result


# ------------------------------------------------------------------
# LangChain Tool
# ------------------------------------------------------------------

@tool
def get_ai_trending(category: str = "all") -> str:
    """
    获取 AI 领域今日热榜。

    Args:
        category: 类别，可选 'huggingface' / 'github' / 'x' / 'all'（默认 all）

    Returns:
        结构化 AI 热榜文本摘要
    """
    data = load_ai_trending()
    if not data.get("fetched_at"):
        data = fetch_all_ai_trending()

    lines = [f"📡 AI 热榜 (更新于 {data.get('fetched_at', '未知')[:16]})\n"]

    cat = category.lower()

    if cat in ("huggingface", "all"):
        hf = data.get("huggingface", {})
        lines.append("🤗 HuggingFace Trending")
        for sub in ("models", "datasets", "spaces"):
            sub_items = hf.get(sub, [])[:5]
            if sub_items:
                lines.append(f"  [{sub.upper()}]")
                for it in sub_items:
                    lines.append(f"  • {it.get('title', '')} — {it.get('desc', '')}")

    if cat in ("github", "all"):
        gh_items = data.get("github", [])[:10]
        if gh_items:
            lines.append("\n⭐ GitHub AI Trending Today")
            for it in gh_items:
                lines.append(f"  • {it['title']} — {it.get('desc', '')} ({it.get('stars_today', '')} stars today)")

    if cat in ("x", "all"):
        x_items = data.get("x_ai", [])[:10]
        if x_items:
            lines.append("\n𝕏 X / AI News")
            for it in x_items:
                lines.append(f"  • {it['title']}")

    return "\n".join(lines)
