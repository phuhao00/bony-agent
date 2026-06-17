"""Game design and planning analysis helpers for Game Design Agent."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from langchain_core.messages import HumanMessage, SystemMessage

from core.llm_provider import get_chat_llm
from tools.web_search_tools import execute_web_search_sync
from utils.logger import setup_logger

logger = setup_logger("game_design_analysis")

_GD_SYSTEM = """你是资深游戏策划（系统/关卡/叙事/数值），擅长：
- 概念案与 pitch：卖点、用户、差异化与 MVP 范围
- 核心玩法循环：动机、反馈、留存与付费钩子
- 系统设计：机制、边界、异常与与其他系统的耦合
- 关卡与内容规划：难度曲线、节奏与投放
- 叙事与世界观：主题、冲突、角色弧光
- 数值框架：成长曲线、平衡思路与验证方法

输出要求：
1. 使用清晰 Markdown（## 章节、列表、表格）
2. 机制描述要可落地：输入、规则、输出、边界案例
3. 标注 P0/P1/P2 优先级与验证指标
4. 不编造具体销量、DAU；不确定标注「待验证」
5. 回答使用中文"""


def _safe_gaming_trends() -> str:
    try:
        from tools.gaming_trending import get_gaming_trends

        return str(get_gaming_trends.invoke({"force_refresh": False}) or "")[:4000]
    except Exception as exc:
        logger.warning("[game_design_analysis] gaming trends unavailable: %s", exc)
        return ""


def gather_game_design_signals(
    topic: str,
    *,
    extra_queries: Optional[List[str]] = None,
    max_results: int = 8,
) -> Dict[str, Any]:
    topic = (topic or "").strip()
    if not topic:
        return {"topic": "", "searches": [], "gaming_trends": ""}

    queries = [
        f"{topic} 游戏 设计 玩法",
        f"{topic} game design mechanics",
        f"{topic} 手游 趋势 2025 2026",
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
            logger.warning("[game_design_analysis] search failed for %s: %s", q, exc)
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


def _run_llm(human: str, *, temperature: float = 0.35) -> str:
    llm = get_chat_llm(temperature=temperature)
    result = llm.invoke([SystemMessage(content=_GD_SYSTEM), HumanMessage(content=human)])
    return str(result.content or "").strip()


def run_concept_pitch(params: Dict[str, Any]) -> Dict[str, Any]:
    idea = str(params.get("idea") or "").strip()
    if not idea:
        raise ValueError("idea is required")
    audience = str(params.get("audience") or "").strip()
    platform = str(params.get("platform") or "").strip()

    signals = gather_game_design_signals(
        idea,
        extra_queries=[f"{idea} 游戏 市场 机会", f"{idea} 竞品 分析"],
    )
    prompt = (
        f"请基于创意「{idea}」撰写游戏概念案（Pitch）。\n"
        f"目标用户：{audience or '待定义'}\n"
        f"平台：{platform or '待定义'}\n\n"
        "结构：\n"
        "## 一句话卖点\n"
        "## 目标用户与场景\n"
        "## 核心体验（30 秒懂）\n"
        "## 差异化与对标\n"
        "## MVP 范围（首版必做/不做）\n"
        "## 风险与验证计划\n"
        "## 团队与周期粗估\n\n"
        f"参考信号：\n{_format_signals(signals)}"
    )
    report = _run_llm(prompt, temperature=0.45)
    return {"recipe": "concept.pitch", "idea": idea, "signals": signals, "report": report}


def run_core_loop(params: Dict[str, Any]) -> Dict[str, Any]:
    name = str(params.get("game_name") or "").strip()
    if not name:
        raise ValueError("game_name is required")
    genre = str(params.get("genre") or "").strip()
    session = str(params.get("session_length") or "").strip()

    signals = gather_game_design_signals(
        name,
        extra_queries=[f"{genre} 核心循环 设计", f"{name} gameplay loop"],
    )
    prompt = (
        f"请设计「{name}」的核心玩法循环。\n"
        f"类型：{genre or '待定义'}\n"
        f"单局时长目标：{session or '待定义'}\n\n"
        "包含：\n"
        "## 核心循环图（文字描述各阶段）\n"
        "## 玩家动机与目标层级\n"
        "## 反馈与奖励节奏\n"
        "## 失败与恢复机制\n"
        "## 留存钩子（日/周）\n"
        "## 与 monetization 的衔接（如有）\n"
        "## 首周体验里程碑\n\n"
        f"参考信号：\n{_format_signals(signals)}"
    )
    report = _run_llm(prompt)
    return {"recipe": "core.loop", "game_name": name, "signals": signals, "report": report}


def run_system_design(params: Dict[str, Any]) -> Dict[str, Any]:
    system = str(params.get("system_name") or "").strip()
    if not system:
        raise ValueError("system_name is required")
    context = str(params.get("game_context") or "").strip()
    goals = str(params.get("goals") or "").strip()

    signals = gather_game_design_signals(
        system,
        extra_queries=[f"{system} 游戏系统设计", f"game {system} system design"],
    )
    prompt = (
        f"请撰写「{system}」系统设计文档。\n"
        f"游戏背景：{context or '（待补充）'}\n"
        f"设计目标：{goals or '（待补充）'}\n\n"
        "结构：\n"
        "## 系统目标与边界\n"
        "## 核心规则与状态机\n"
        "## 输入/输出与数据结构要点\n"
        "## 与其他系统的耦合\n"
        "## 异常与反作弊/滥用边界\n"
        "## UI/引导需求\n"
        "## 验收标准与测试用例思路\n"
        "## 迭代优先级 P0/P1/P2\n\n"
        f"参考信号：\n{_format_signals(signals)}"
    )
    report = _run_llm(prompt)
    return {"recipe": "system.design", "system_name": system, "signals": signals, "report": report}


def run_level_plan(params: Dict[str, Any]) -> Dict[str, Any]:
    scope = str(params.get("content_scope") or "").strip()
    if not scope:
        raise ValueError("content_scope is required")
    game_type = str(params.get("game_type") or "").strip()
    hours = str(params.get("target_hours") or "").strip()

    signals = gather_game_design_signals(
        scope,
        extra_queries=[f"{game_type} 关卡设计 难度曲线", f"{scope} level design"],
    )
    prompt = (
        f"请规划内容范围「{scope}」的关卡/内容结构。\n"
        f"玩法类型：{game_type or '待定义'}\n"
        f"目标游玩时长：{hours or '待定义'}\n\n"
        "包含：\n"
        "## 章节/区域结构\n"
        "## 难度与能力成长曲线\n"
        "## 内容投放节奏（新机制/新敌人/新资源）\n"
        "## 关键节点与 Boss/高潮设计\n"
        "## 重玩与收集要素\n"
        "## 产能与拆分建议（关卡数/模板）\n\n"
        f"参考信号：\n{_format_signals(signals)}"
    )
    report = _run_llm(prompt)
    return {"recipe": "level.plan", "content_scope": scope, "signals": signals, "report": report}


def run_narrative_outline(params: Dict[str, Any]) -> Dict[str, Any]:
    theme = str(params.get("theme") or "").strip()
    if not theme:
        raise ValueError("theme is required")
    tone = str(params.get("tone") or "").strip()
    length = str(params.get("length") or "").strip()

    signals = gather_game_design_signals(
        theme,
        extra_queries=[f"{theme} 游戏 剧情 世界观", f"{theme} narrative game"],
    )
    prompt = (
        f"请撰写题材「{theme}」的剧情与世界观大纲。\n"
        f"叙事基调：{tone or '待定义'}\n"
        f"体量：{length or '待定义'}\n\n"
        "结构：\n"
        "## 世界观支柱（规则/历史/势力）\n"
        "## 核心冲突与主题\n"
        "## 主线脉络（幕/章）\n"
        "## 关键角色与关系\n"
        "## 叙事与玩法的结合点\n"
        "## 可扩展 DLC/赛季方向\n\n"
        f"参考信号：\n{_format_signals(signals)}"
    )
    report = _run_llm(prompt, temperature=0.45)
    return {"recipe": "narrative.outline", "theme": theme, "signals": signals, "report": report}


def run_balance_framework(params: Dict[str, Any]) -> Dict[str, Any]:
    focus = str(params.get("system_focus") or "").strip()
    if not focus:
        raise ValueError("system_focus is required")
    name = str(params.get("game_name") or "").strip()
    constraints = str(params.get("constraints") or "").strip()

    signals = gather_game_design_signals(
        focus,
        extra_queries=[f"{focus} 游戏 数值 平衡", f"game balance {focus}"],
    )
    prompt = (
        f"请为「{focus}」起草数值平衡框架。\n"
        f"游戏：{name or '（待补充）'}\n"
        f"约束：{constraints or '（待补充）'}\n\n"
        "包含：\n"
        "## 数值目标与体验指标\n"
        "## 属性维度与公式思路\n"
        "## 成长曲线（等级/阶段）\n"
        "## 表格框架（示例列与行）\n"
        "## PVP/PVE 或付费影响边界\n"
        "## 验证方法（仿真/AB/玩家分层）\n"
        "## 首版数值里程碑\n\n"
        f"参考信号：\n{_format_signals(signals)}"
    )
    report = _run_llm(prompt)
    return {"recipe": "balance.framework", "system_focus": focus, "signals": signals, "report": report}


def run_analysis(recipe_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
    handlers = {
        "concept.pitch": run_concept_pitch,
        "core.loop": run_core_loop,
        "system.design": run_system_design,
        "level.plan": run_level_plan,
        "narrative.outline": run_narrative_outline,
        "balance.framework": run_balance_framework,
    }
    handler = handlers.get(recipe_id)
    if not handler:
        raise ValueError(f"Unknown analysis recipe: {recipe_id}")
    return handler(params)
