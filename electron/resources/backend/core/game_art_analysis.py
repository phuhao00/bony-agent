"""Visual and game art analysis helpers for Game Art Agent."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from langchain_core.messages import HumanMessage, SystemMessage

from core.llm_provider import get_chat_llm
from tools.web_search_tools import execute_web_search_sync
from utils.logger import setup_logger

logger = setup_logger("game_art_analysis")

_GA_SYSTEM = """你是资深游戏美术总监与视觉设计顾问，擅长：
- 视觉风格定义：色彩、光影、材质、构图与 mood board 方向
- 角色/场景/UI 美术 Brief：可交付给原画与 3D 的明确描述
- 竞品视觉分析：同类游戏的画面差异化与工业化规格
- 管线意识：分辨率、LOD、风格统一性与产能评估

输出要求：
1. 使用清晰 Markdown（## 章节、列表、表格）
2. 描述要「可画」：形体、比例、材质、光照、镜头语言
3. 给出参考方向（游戏/影视/艺术家风格）而非空泛形容词
4. 区分「定稿方向」与「待探索方向」
5. 回答使用中文"""


def _safe_gaming_trends() -> str:
    try:
        from tools.gaming_trending import get_gaming_trends

        return str(get_gaming_trends.invoke({"force_refresh": False}) or "")[:4000]
    except Exception as exc:
        logger.warning("[game_art_analysis] gaming trends unavailable: %s", exc)
        return ""


def gather_game_art_signals(
    topic: str,
    *,
    extra_queries: Optional[List[str]] = None,
    max_results: int = 8,
) -> Dict[str, Any]:
    topic = (topic or "").strip()
    if not topic:
        return {"topic": "", "searches": [], "gaming_trends": ""}

    queries = [
        f"{topic} 游戏 美术 风格 参考",
        f"{topic} game art style visual design",
        f"{topic} 角色 场景 概念图",
    ]
    if extra_queries:
        queries.extend(q.strip() for q in extra_queries if q and q.strip())

    seen: set[str] = set()
    searches: List[Dict[str, str]] = []
    for q in queries:
        if q in seen:
            continue
        seen.add(q)
        try:
            text = execute_web_search_sync(q, max_results=max_results)
        except Exception as exc:
            logger.warning("[game_art_analysis] search failed for %s: %s", q, exc)
            text = f"搜索失败: {exc}"
        searches.append({"query": q, "result": (text or "")[:6000]})

    return {
        "topic": topic,
        "searches": searches,
        "gaming_trends": _safe_gaming_trends(),
    }


def _format_signals(signals: Dict[str, Any]) -> str:
    parts = [f"主题：{signals.get('topic', '')}"]
    for row in signals.get("searches") or []:
        parts.append(f"\n### 搜索：{row.get('query', '')}\n{row.get('result', '')}")
    trends = (signals.get("gaming_trends") or "").strip()
    if trends:
        parts.append(f"\n### 游戏热点快照\n{trends}")
    return "\n".join(parts)


def _run_llm(human: str, *, temperature: float = 0.4) -> str:
    llm = get_chat_llm(temperature=temperature)
    result = llm.invoke([SystemMessage(content=_GA_SYSTEM), HumanMessage(content=human)])
    return str(result.content or "").strip()


def run_style_guide(params: Dict[str, Any]) -> Dict[str, Any]:
    name = str(params.get("game_name") or "").strip()
    if not name:
        raise ValueError("game_name is required")
    genre = str(params.get("genre") or "").strip()
    mood = str(params.get("mood") or "").strip()

    signals = gather_game_art_signals(
        name,
        extra_queries=[f"{name} {genre} 美术风格", f"{genre} 游戏 视觉 标杆"],
    )
    prompt = (
        f"请为项目「{name}」撰写视觉风格指南。\n"
        f"类型：{genre or '待定义'}\n"
        f"情绪基调：{mood or '待定义'}\n\n"
        "报告结构：\n"
        "## 视觉一句话定位\n"
        "## 色彩与光影原则\n"
        "## 材质与细节层级\n"
        "## 构图与镜头语言\n"
        "## Mood Board 参考清单（游戏/影视/艺术）\n"
        "## 角色/场景/UI 统一性规则\n"
        "## 产能与规格建议（分辨率/风格复杂度）\n"
        "## 首版美术验证清单\n\n"
        f"参考信号：\n{_format_signals(signals)}"
    )
    report = _run_llm(prompt)
    return {"recipe": "style.guide", "game_name": name, "signals": signals, "report": report}


def run_character_brief(params: Dict[str, Any]) -> Dict[str, Any]:
    name = str(params.get("character_name") or "").strip()
    if not name:
        raise ValueError("character_name is required")
    role = str(params.get("role") or "").strip()
    world = str(params.get("world_setting") or "").strip()

    signals = gather_game_art_signals(
        name,
        extra_queries=[f"{name} 角色设计 游戏", f"{role} 角色 原画 参考"],
    )
    prompt = (
        f"请撰写角色「{name}」的美术设计 Brief。\n"
        f"定位：{role or '待定义'}\n"
        f"世界观：{world or '（待补充）'}\n\n"
        "包含：\n"
        "## 角色叙事与性格外化\n"
        "## 形体与比例要点\n"
        "## 服装与配件层级（可拆分资产）\n"
        "## 色彩与材质\n"
        "## POSE/表情参考方向\n"
        "## 三视图与交付清单\n"
        "## 与玩法/UI 的衔接注意点\n\n"
        f"参考信号：\n{_format_signals(signals)}"
    )
    report = _run_llm(prompt, temperature=0.45)
    return {"recipe": "character.brief", "character_name": name, "signals": signals, "report": report}


def run_scene_concept(params: Dict[str, Any]) -> Dict[str, Any]:
    scene = str(params.get("scene_name") or "").strip()
    if not scene:
        raise ValueError("scene_name is required")
    purpose = str(params.get("purpose") or "").strip()
    style_ref = str(params.get("style_ref") or "").strip()

    signals = gather_game_art_signals(
        scene,
        extra_queries=[f"{scene} 场景 概念设计 游戏", f"{scene} environment art"],
    )
    prompt = (
        f"请为场景「{scene}」撰写概念设计 Brief。\n"
        f"用途：{purpose or '（玩法/叙事待补充）'}\n"
        f"风格参考：{style_ref or '（待补充）'}\n\n"
        "包含：\n"
        "## 氛围与叙事功能\n"
        "## 地标与可读性要素\n"
        "## 光照与色彩方案\n"
        "## 构图与引导线（玩家动线）\n"
        "## 模块化/重复利用建议\n"
        "## 概念图交付要点（镜头、比例人、氛围）\n\n"
        f"参考信号：\n{_format_signals(signals)}"
    )
    report = _run_llm(prompt)
    return {"recipe": "scene.concept", "scene_name": scene, "signals": signals, "report": report}


def run_ui_art_guide(params: Dict[str, Any]) -> Dict[str, Any]:
    name = str(params.get("game_name") or "").strip()
    if not name:
        raise ValueError("game_name is required")
    platform = str(params.get("platform") or "手游").strip()
    ui_style = str(params.get("ui_style") or "").strip()

    signals = gather_game_art_signals(
        name,
        extra_queries=[f"{platform} 游戏 UI 设计 规范", f"{name} UI UX 界面"],
    )
    prompt = (
        f"请为「{name}」起草 UI 美术规范草案。\n"
        f"平台：{platform}\n"
        f"期望风格：{ui_style or '（待定义）'}\n\n"
        "包含：\n"
        "## 视觉层级与信息密度\n"
        "## 色彩与状态色（正常/警告/禁用）\n"
        "## 字体与图标风格\n"
        "## 组件皮肤规范（按钮/弹窗/列表）\n"
        "## 动效与反馈美术原则\n"
        "## 多分辨率与安全区\n"
        "## 与场景美术的统一性\n\n"
        f"参考信号：\n{_format_signals(signals)}"
    )
    report = _run_llm(prompt)
    return {"recipe": "ui.art.guide", "game_name": name, "signals": signals, "report": report}


def run_visual_research(params: Dict[str, Any]) -> Dict[str, Any]:
    genre = str(params.get("genre") or "").strip()
    if not genre:
        raise ValueError("genre is required")
    refs = str(params.get("reference_games") or "").strip()
    our_game = str(params.get("our_game") or "").strip()

    extra = [f"{genre} 游戏 画面 对比", f"{genre} 美术 标杆"]
    if refs:
        for g in refs.split(","):
            g = g.strip()
            if g:
                extra.append(f"{g} 美术 风格 分析")

    signals = gather_game_art_signals(genre, extra_queries=extra)
    prompt = (
        f"请对「{genre}」赛道做竞品视觉分析。\n"
        f"参考游戏：{refs or '（请结合搜索自行识别）'}\n"
        f"我方项目：{our_game or '（未指定）'}\n\n"
        "报告结构：\n"
        "## 赛道视觉共性\n"
        "## 竞品矩阵（表格：游戏/风格/强项/短板）\n"
        "## 差异化视觉机会\n"
        "## 可借鉴但需规避的点\n"
        "## 对我方项目的视觉策略建议\n"
        "## 参考图检索关键词清单\n\n"
        f"参考信号：\n{_format_signals(signals)}"
    )
    report = _run_llm(prompt)
    return {"recipe": "visual.research", "genre": genre, "signals": signals, "report": report}


def run_analysis(recipe_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
    handlers = {
        "style.guide": run_style_guide,
        "character.brief": run_character_brief,
        "scene.concept": run_scene_concept,
        "ui.art.guide": run_ui_art_guide,
        "visual.research": run_visual_research,
    }
    handler = handlers.get(recipe_id)
    if not handler:
        raise ValueError(f"Unknown analysis recipe: {recipe_id}")
    return handler(params)
