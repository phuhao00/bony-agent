"""Social publishing and trend tool facade."""

from ..gaming_trending import analyze_gaming_trends, fetch_all_trending, get_gaming_trends
from ..publisher_tools import get_publish_accounts_tool, publish_content_tool
from ..social_trending import fetch_social_trending, get_hot_topics, get_top_social_topics
from ..trend_tools import analyze_trends, generate_hashtags

__all__ = [
    "analyze_gaming_trends",
    "analyze_trends",
    "fetch_all_trending",
    "fetch_social_trending",
    "generate_hashtags",
    "get_gaming_trends",
    "get_hot_topics",
    "get_publish_accounts_tool",
    "get_top_social_topics",
    "publish_content_tool",
]
