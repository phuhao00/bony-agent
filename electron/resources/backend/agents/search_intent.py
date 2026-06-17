"""
Detect user queries that require mandatory web lookup (weather, news, real-time facts).

Aligned with web/app/api/chat/route.ts textLooksLikeMandatoryWebLookup().
"""

from __future__ import annotations

import re

# Primary patterns from Direct chat + extended realtime cues from the plan
_MANDATORY_WEB_LOOKUP_RE = re.compile(
    r"天气|气温|降水|下雨|降雨|刮风|寒潮|热浪|forecast|temperature|precip|\bweather\b|\bAQI\b|空气质量"
    r"|最新|实时|查一下|搜索|\bnews\b|股价|exchange.?rate|汇率",
    re.IGNORECASE,
)


def looks_like_mandatory_web_lookup(text: str) -> bool:
    """Return True when the user message should trigger web search before answering."""
    t = (text or "").strip()
    if len(t) < 2:
        return False
    return bool(_MANDATORY_WEB_LOOKUP_RE.search(t))
