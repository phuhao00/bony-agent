"""Extract and verify search result pages."""

from __future__ import annotations

import re
from typing import Any, Dict, List

from utils.logger import setup_logger

logger = setup_logger("agent_s.results")

_RESULT_SELECTORS_JS = """() => {
  const out = [];
  const seen = new Set();
  const pick = (root) => {
    const titleEl = root.querySelector('a.result__a, h2 a, .result__title a, a.result-link, a[data-testid="result-title"]');
    const title = (titleEl?.innerText || root.querySelector('h2, .result__title')?.innerText || '').trim();
    const href = titleEl?.href || root.querySelector('a[href]')?.href || '';
    const snippet = (root.querySelector('.result__snippet, .result-snippet, .snippet')?.innerText || '').trim();
    const body = (root.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 420);
    if (!title || title.length < 2) return;
    const key = title + '|' + href;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ title, href, snippet: snippet || body.slice(title.length, title.length + 280) });
  };
  const roots = document.querySelectorAll(
    '.result, .results_links_deep, .result--web, .serp-item, article[data-testid="result"], li[data-layout="organic"]'
  );
  roots.forEach((el) => pick(el));
  if (out.length === 0) {
    document.querySelectorAll('a[href^="http"]').forEach((a) => {
      const title = (a.innerText || '').trim();
      const href = a.href || '';
      if (!title || title.length < 4 || href.includes('duckduckgo.com')) return;
      const key = title + '|' + href;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ title, href, snippet: '' });
    });
  }
  return out.slice(0, 12);
}"""


def digest_indicates_search_results(digest: Dict[str, Any], query: str) -> bool:
    """Heuristic: page has substantive result content, not just empty search chrome."""
    text = (digest.get("text_excerpt") or "").strip()
    if len(text) < 200:
        return False

    q = (query or "").strip().lower()
    text_l = text.lower()

    # 仍像空白搜索首页：极短且只有 DuckDuckGo 壳
    if len(text) < 350 and "duckduckgo" in text_l and q and q not in text_l:
        return False

    result_signals = (
        "result",
        "results",
        "weather",
        "天气",
        "forecast",
        "wiki",
        "wikipedia",
        "news",
        "http",
        "www.",
    )
    if any(sig in text_l for sig in result_signals):
        return True

    if q and q in text_l and len(text) > 500:
        return True

    # 多段正文通常意味着结果列表
    if text.count("\n") >= 6 and len(text) > 700:
        return True

    url = (digest.get("url") or "").lower()
    if "q=" in url or "/search" in url:
        return True

    return False


async def extract_search_results_from_page(page) -> List[Dict[str, str]]:
    try:
        raw = await page.evaluate(_RESULT_SELECTORS_JS)
        if not isinstance(raw, list):
            return []
        cleaned: List[Dict[str, str]] = []
        for item in raw:
            if not isinstance(item, dict):
                continue
            title = str(item.get("title") or "").strip()
            href = str(item.get("href") or "").strip()
            snippet = re.sub(r"\s+", " ", str(item.get("snippet") or "")).strip()
            if not title:
                continue
            cleaned.append({"title": title[:200], "url": href[:500], "snippet": snippet[:400]})
        logger.info("Extracted %d search results from %s", len(cleaned), page.url)
        return cleaned
    except Exception as exc:
        logger.warning("extract_search_results failed: %s", exc)
        return []
