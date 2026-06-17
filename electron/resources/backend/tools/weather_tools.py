"""Lightweight weather lookup for desktop pet (Open-Meteo + wttr.in fallback)."""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from urllib.parse import quote

from utils.logger import setup_logger

logger = setup_logger("weather_tools")

_TIME_WORDS = frozenset({"今天", "明天", "后天", "现在", "近日", "天气", "气温", "怎么样", "如何"})

# Words to strip so the city name can be isolated (time / filler / politeness).
_FILLER_RE = re.compile(
    r"(今天|明天|后天|大后天|现在|目前|今晚|早上|晚上|请问|帮我|麻烦|想问|"
    r"我想知道|想知道|查一下|查查|查询|看一下|看看|未来几天|未来|这周|这几天|"
    r"近期|怎么样|怎样|如何|冷不冷|热不热|的|啊|呀|呢|吗|是|一下)"
)
_WEATHER_KW_RE = re.compile(
    r"(天气预报|天气|气温|气候|温度|下雨|降雨|降水|刮风|穿衣|空气质量|aqi|weather|forecast)",
    re.IGNORECASE,
)
# Detect whether a query is asking about weather at all.
_WEATHER_INTENT_RE = re.compile(
    r"天气|气温|气候|下雨|降雨|降水|穿衣|冷不冷|热不热|温度|forecast|weather",
    re.IGNORECASE,
)


def looks_like_weather_query(text: str) -> bool:
    """True when the query is about weather (used to take the fast weather-API path)."""
    return bool(_WEATHER_INTENT_RE.search(text or ""))

_WMO_ZH = {
    0: "晴",
    1: "大部晴朗",
    2: "局部多云",
    3: "多云",
    45: "雾",
    48: "雾凇",
    51: "小毛毛雨",
    53: "毛毛雨",
    55: "大毛毛雨",
    61: "小雨",
    63: "中雨",
    65: "大雨",
    71: "小雪",
    73: "中雪",
    75: "大雪",
    80: "阵雨",
    81: "中阵雨",
    82: "强阵雨",
    95: "雷暴",
    96: "雷暴伴小冰雹",
    99: "雷暴伴大冰雹",
}


def extract_city_from_query(query: str) -> str:
    """Isolate the city name by stripping weather keywords and time/filler words.

    Handles patterns like "深圳今天天气", "查一下广州天气", "北京明天天气怎么样".
    """
    t = (query or "").strip()
    if not t:
        return ""

    # Strip weather keywords and filler/time words; what remains should be the city.
    stripped = _WEATHER_KW_RE.sub("", t)
    stripped = _FILLER_RE.sub("", stripped)
    city = re.sub(r"[^\u4e00-\u9fffA-Za-z]", "", stripped)
    city = re.sub(r"(市|县|区|省)$", "", city)
    if city and city not in _TIME_WORDS and 2 <= len(city) <= 12:
        return city

    # Fallback: explicit "城市…天气" pattern with a non-greedy capture.
    m = re.search(
        r"([\u4e00-\u9fff]{2,6}?)(?:市|县|区|省)?"
        r"(?:今天|明天|后天|现在|这周|未来几天|未来)?(?:的)?(?:天气|气温|温度|下雨)",
        t,
    )
    if m:
        city = re.sub(r"(今天|明天|后天|现在|的)$", "", (m.group(1) or "").strip())
        if city and city not in _TIME_WORDS and len(city) >= 2:
            return city
    return ""


def _fetch_json(url: str, timeout: float = 6.0) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "AI-Media-Agent-Pet/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _fetch_weather_open_meteo(city: str) -> str:
    geo_url = (
        "https://geocoding-api.open-meteo.com/v1/search?"
        f"name={quote(city)}&count=1&language=zh&format=json"
    )
    geo = _fetch_json(geo_url)
    results = geo.get("results") or []
    if not results:
        return ""

    hit = results[0]
    lat = hit.get("latitude")
    lon = hit.get("longitude")
    name = str(hit.get("name") or city)
    admin = str(hit.get("admin1") or "")
    if lat is None or lon is None:
        return ""

    forecast_url = (
        "https://api.open-meteo.com/v1/forecast?"
        f"latitude={lat}&longitude={lon}"
        "&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m"
        "&timezone=auto"
    )
    forecast = _fetch_json(forecast_url)
    current = forecast.get("current") or {}
    temp = current.get("temperature_2m")
    humidity = current.get("relative_humidity_2m")
    wind = current.get("wind_speed_10m")
    code = int(current.get("weather_code") or 0)
    desc = _WMO_ZH.get(code, "多变")

    if temp is None:
        return ""

    place = f"{name}{admin}" if admin and admin not in name else name
    parts = [f"{place}现在{desc}，气温 {temp}°C"]
    if humidity is not None:
        parts.append(f"湿度 {humidity}%")
    if wind is not None:
        parts.append(f"风速 {wind} km/h")
    return "，".join(parts)


def _fetch_weather_wttr(city: str) -> str:
    url = f"https://wttr.in/{quote(city)}?lang=zh&format=j1"
    req = urllib.request.Request(url, headers={"User-Agent": "curl/8.4.0"})
    with urllib.request.urlopen(req, timeout=6) as resp:
        data = json.loads(resp.read().decode("utf-8", errors="replace"))
    cur = (data.get("current_condition") or [{}])[0]
    temp = cur.get("temp_C")
    desc = ((cur.get("lang_zh") or cur.get("weatherDesc") or [{}])[0]).get("value") or "未知"
    humidity = cur.get("humidity")
    if temp is None:
        return ""
    line = f"{city}现在{desc}，气温 {temp}°C"
    if humidity:
        line += f"，湿度 {humidity}%"
    return line


def fetch_weather_short_sync(query: str) -> str:
    """Fetch short weather text for a natural-language query."""
    city = extract_city_from_query(query)
    if not city:
        return ""

    for fetcher, label in ((_fetch_weather_open_meteo, "open-meteo"), (_fetch_weather_wttr, "wttr")):
        try:
            text = fetcher(city)
            if text:
                logger.info("[weather] %s ok city=%s", label, city)
                return text
        except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError, KeyError, TypeError) as exc:
            logger.warning("[weather] %s failed city=%s err=%s", label, city, exc)
    return ""
