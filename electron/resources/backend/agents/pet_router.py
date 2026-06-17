"""Route desktop pet chat to local Ollama, cloud LLM, tool-augmented agent, or full agent graph."""

from __future__ import annotations

import re
from typing import Literal

from agents.search_intent import looks_like_mandatory_web_lookup
from core.llm_provider import is_ollama_available

PetRoute = Literal["local", "cloud", "tools", "agent"]

# Full agent: multi-step media / publish / planning / heavy codegen
_AGENT_KEYWORDS = (
    "搜索并",
    "帮我写",
    "帮我做",
    "帮我生成",
    "帮我发布",
    "发布到",
    "一键发布",
    "执行",
    "运行脚本",
    "写代码",
    "写脚本",
    "定时发布",
    "混剪",
    "生成图片",
    "生成视频",
    "文生图",
    "图生视频",
    "upload",
    "publish",
    "generate image",
    "generate video",
    "run tool",
    "use mcp",
    "openclaw",
    "龙虾",
    "lobster",
    "流水线",
    "分步",
    "规划",
    "完整流程",
)

# Tool-augmented: realtime facts, knowledge lookup, light actions
_TOOLS_KEYWORDS = (
    "查一下",
    "查查",
    "查询",
    "搜索",
    "搜一下",
    "帮我查",
    "看看",
    "多少钱",
    "股价",
    "汇率",
    "新闻",
    "热点",
    "知识库",
    "文档里",
    "我的资料",
    "remember",
    "recall",
    "mcp",
    "调用",
    "工具",
)

_CODE_LIKE = re.compile(
    r"(def\s+\w+|class\s+\w+|function\s+\w+|import\s+\w+|const\s+\w+\s*=|#include\s*<)",
    re.I,
)

# Media generation intent — verb + media noun may be separated by other words,
# e.g. "生成一段猫咪说话的视频", "帮我画一张星空图", "做个产品宣传短片".
_MEDIA_VERB = r"(生成|制作|做|画|绘制|创作|来一[张段个]|搞一?[张段个]|给我整|帮我(?:做|画|生成|搞|整))"
_IMAGE_NOUN = r"(图片|图像|照片|海报|插画|logo|图标|封面|壁纸|头像|配图|一张图|图)"
_VIDEO_NOUN = r"(视频|短片|动画|片子|影片|短视频|宣传片|vlog|gif)"
_RE_MEDIA_IMAGE = re.compile(_MEDIA_VERB + r"[^。！？\n]{0,12}?" + _IMAGE_NOUN, re.I)
_RE_MEDIA_VIDEO = re.compile(_MEDIA_VERB + r"[^。！？\n]{0,12}?" + _VIDEO_NOUN, re.I)


def looks_like_media_generation(text: str) -> bool:
    """Detect image / video generation intent even with words between verb and noun."""
    t = (text or "").strip()
    if not t:
        return False
    return bool(_RE_MEDIA_IMAGE.search(t) or _RE_MEDIA_VIDEO.search(t))


def looks_like_pet_tools(text: str) -> bool:
    """Queries that need tools (web / RAG / memory / MCP) but not full multi-agent."""
    t = (text or "").strip()
    if not t:
        return False
    if looks_like_mandatory_web_lookup(t):
        return True
    lower = t.lower()
    return any(kw in lower or kw in t for kw in _TOOLS_KEYWORDS)


def looks_like_pet_agent(text: str) -> bool:
    """Complex tasks that should use the full creative / orchestrator agent stack."""
    t = (text or "").strip()
    if not t:
        return False
    if len(t) > 280:
        return True
    if looks_like_media_generation(t):
        return True
    lower = t.lower()
    if any(kw in lower or kw in t for kw in _AGENT_KEYWORDS):
        return True
    if _CODE_LIKE.search(t) and len(t) > 100:
        return True
    return False


def classify_pet_route(text: str, *, force_agent: bool = False) -> PetRoute:
    """Decide pet chat backend: Ollama, cloud LLM, tool ReAct, or full agent stream."""
    if force_agent:
        return "agent"

    t = (text or "").strip()
    if not t:
        return "local" if is_ollama_available() else "cloud"

    if looks_like_pet_agent(t):
        return "agent"

    if looks_like_pet_tools(t):
        return "tools"

    if is_ollama_available():
        return "local"
    return "cloud"


def pet_stage_from_care(care_score: int) -> str:
    score = max(0, int(care_score))
    if score >= 200:
        return "evolved"
    if score >= 50:
        return "teen"
    return "young"
