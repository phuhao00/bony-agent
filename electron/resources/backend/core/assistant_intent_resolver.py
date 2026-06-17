"""Smarter assistant intent resolver for main-chat specialist routing."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable

from core.assistant_catalog import ASSISTANT_CATALOG


@dataclass(frozen=True)
class AssistantIntentCandidate:
    agent_id: str
    confidence: float
    score: float
    reason: str
    signals: tuple[str, ...] = field(default_factory=tuple)


INTERNAL_SPECIALIST_AGENT_IDS = ("code_analyst_agent",)


def _contains_any(text: str, terms: Iterable[str]) -> bool:
    return any(term.lower() in text for term in terms)


def _matching_terms(text: str, terms: Iterable[str]) -> list[str]:
    return [term for term in terms if term.lower() in text]


MARKET_TERMS = (
    "市场", "行业", "生态", "规模", "机会", "趋势", "竞品", "商业", "用户",
    "玩家", "需求", "增长", "赛道", "变现", "画像", "market", "industry",
)
ANALYSIS_TERMS = ("分析", "研究", "调研", "洞察", "评估", "梳理", "scan", "research", "analyze")
CODE_TERMS = (
    "代码", "源码", "函数", "类", "接口", "调用", "bug", "报错", "堆栈", "仓库",
    "实现", "重构", "测试", "lint", "typescript", "python", "api", "组件",
    "code", "repository", "stack trace", "module",
)
DEVOPS_TERMS = (
    "redis", "mysql", "mongodb", "etcd", "consul", "nsq", "ssh", "git ssh",
    "pytest", "devops", "中间件", "基础设施", "部署", "环境变量",
)
GAME_TERMS = ("游戏", "手游", "端游", "独立游戏", "steam", "mod", "玩家", "game")
VISUAL_TERMS = ("美术", "视觉", "角色", "场景", "原画", "概念图", "ui", "moodboard", "画风")
IMAGE_EDIT_TERMS = (
    "图片编辑", "编辑图片", "图片修改", "改图", "修图", "照片编辑", "照片修改",
    "去水印", "水印", "去掉", "移除", "换背景", "换衣服", "局部重绘", "涂抹",
    "扩图", "超分", "高清修复", "参考图", "inpaint", "outpaint", "upscale",
    "edit image", "image edit", "remove object", "watermark",
)

_IMAGE_GENERATION_SIGNALS = (
    "生成", "画一张", "画个", "做一张图", "做张图", "生成图片", "生成一张图",
    "生成图", "文生图", "封面图", "头图", "banner", "海报", "宣传图",
    "配图", "插图", "主图",
)
GAME_DESIGN_TERMS = ("玩法", "核心循环", "关卡", "数值", "系统设计", "世界观", "剧情", "game design")
LEGAL_TERMS = ("法律", "合同", "合规", "法规", "政策", "条款", "司法", "劳动", "税务")
AD_TERMS = ("广告", "投放", "受众", "预算", "roas", "cpc", "cpa", "campaign")
PARTNERSHIP_TERMS = ("商务", "合作", "bd", "outreach", "伙伴", "联名", "渠道")
PROCUREMENT_TERMS = ("采购", "供应商", "rfq", "询价", "招标", "报价", "寻源")
DESKTOP_TERMS = ("blender", "photoshop", "office", "打开应用", "操作软件", "桌面", "gui")
SYSTEM_TERMS = ("安装软件", "卸载", "修复网络", "dns", "整理文件", "brew install", "winget")
SHORT_DRAMA_TERMS = ("短剧", "微电影", "ai短剧", "短剧导演", "微短剧", "短剧剧本", "短剧分镜")
PODCAST_TERMS = ("播客", "podcast", "电台", "音频节目", "播客脚本", "播客策划", "shownotes")
MUSIC_TERMS = ("ai音乐", "生成音乐", "音乐制作", "背景音乐", "配乐", "歌词生成音乐", "文本生成音乐")


def _score_catalog_keywords(text: str, agent_id: str) -> tuple[float, list[str]]:
    score = 0.0
    signals: list[str] = []
    for entry in ASSISTANT_CATALOG:
        if entry.agent_id != agent_id:
            continue
        for keyword in _matching_terms(text, entry.intent_keywords):
            length_bonus = min(len(keyword) / 8, 1.5)
            score += 3.0 + length_bonus
            signals.append(f"keyword:{keyword}")
    return score, signals


def _rule_score(text: str, agent_id: str) -> tuple[float, list[str]]:
    signals: list[str] = []
    score = 0.0

    has_market = _contains_any(text, MARKET_TERMS)
    has_analysis = _contains_any(text, ANALYSIS_TERMS)
    has_code = _contains_any(text, CODE_TERMS)
    has_devops = _contains_any(text, DEVOPS_TERMS)
    has_game = _contains_any(text, GAME_TERMS)
    has_visual = _contains_any(text, VISUAL_TERMS)
    has_game_design = _contains_any(text, GAME_DESIGN_TERMS)

    if agent_id == "product_manager_agent":
        if has_market:
            score += 4.0
            signals.append("domain:market")
        if has_analysis:
            score += 2.0
            signals.append("action:analysis")
        if has_game and has_market:
            score += 3.5
            signals.append("domain:game_market")
        if "mod" in text and has_market:
            score += 3.0
            signals.append("object:mod_market")

    elif agent_id == "code_analyst_agent":
        if has_code and has_analysis:
            score += 6.0
            signals.append("domain:code_analysis")
        elif has_code:
            score += 3.0
            signals.append("domain:code")
        if has_market and not has_code:
            score -= 6.0
            signals.append("negative:market_not_code")
        if "mod" in text and has_market and not has_code:
            score -= 4.0
            signals.append("negative:mod_as_market")

    elif agent_id == "programmer_agent":
        if has_devops:
            score += 5.0
            signals.append("domain:devops")
        if has_code and _contains_any(text, ("实现", "修复", "跑测试", "部署", "配置")):
            score += 3.0
            signals.append("action:developer_task")
        if has_market and not has_devops:
            score -= 4.0
            signals.append("negative:market_not_devops")

    elif agent_id == "game_art_agent":
        if has_game and has_visual:
            score += 6.0
            signals.append("domain:game_visual")
        elif has_visual:
            score += 3.0
            signals.append("domain:visual")

    elif agent_id == "image_edit_agent":
        if _contains_any(text, IMAGE_EDIT_TERMS):
            score += 7.0
            signals.append("domain:image_edit")
        if _contains_any(text, ("这张图", "这张图片", "这张照片", "原图", "参考图")) and _contains_any(
            text,
            ("改", "修", "换", "去掉", "删除", "移除", "加", "变成", "扩"),
        ):
            score += 4.0
            signals.append("object:source_image")
        # 纯生成请求（无编辑信号）不应命中图片编辑 Agent
        if _contains_any(text, _IMAGE_GENERATION_SIGNALS) and not _contains_any(text, IMAGE_EDIT_TERMS):
            score -= 6.0
            signals.append("negative:generation_without_edit")

    elif agent_id == "game_design_agent":
        if has_game_design:
            score += 5.5
            signals.append("domain:game_design")
        if has_game and _contains_any(text, ("玩法", "系统", "关卡", "数值")):
            score += 3.0
            signals.append("domain:gameplay")

    elif agent_id == "legal_agent" and _contains_any(text, LEGAL_TERMS):
        score += 6.0
        signals.append("domain:legal")

    elif agent_id == "ad_campaign_agent" and _contains_any(text, AD_TERMS):
        score += 6.0
        signals.append("domain:ad_campaign")

    elif agent_id == "business_partnership_agent" and _contains_any(text, PARTNERSHIP_TERMS):
        score += 6.0
        signals.append("domain:partnership")

    elif agent_id == "procurement_agent" and _contains_any(text, PROCUREMENT_TERMS):
        score += 6.0
        signals.append("domain:procurement")

    elif agent_id == "desktop_operator_agent" and _contains_any(text, DESKTOP_TERMS):
        score += 6.0
        signals.append("domain:desktop")

    elif agent_id == "system_assistant" and _contains_any(text, SYSTEM_TERMS):
        score += 6.0
        signals.append("domain:system")

    elif agent_id == "short_drama_agent" and _contains_any(text, SHORT_DRAMA_TERMS):
        score += 6.0
        signals.append("domain:short_drama")

    elif agent_id == "podcast_agent" and _contains_any(text, PODCAST_TERMS):
        score += 6.0
        signals.append("domain:podcast")

    elif agent_id == "music_agent" and _contains_any(text, MUSIC_TERMS):
        score += 6.0
        signals.append("domain:music")

    return score, signals


def resolve_assistant_intent(
    user_input: str,
    *,
    available_agent_ids: set[str] | None = None,
    min_confidence: float = 0.68,
) -> AssistantIntentCandidate | None:
    """Rank specialist assistants by structured intent signals.

    This resolver is intentionally deterministic and cheap. It does not replace
    LLM fallback; it prevents ambiguous words from being routed by first-match
    keyword scans before the request reaches a more suitable specialist.
    """

    text = (user_input or "").strip().lower()
    if not text:
        return None

    candidates: list[AssistantIntentCandidate] = []
    agent_ids = [entry.agent_id for entry in ASSISTANT_CATALOG] + list(INTERNAL_SPECIALIST_AGENT_IDS)
    for agent_id in agent_ids:
        if available_agent_ids is not None and agent_id not in available_agent_ids:
            continue
        keyword_score, keyword_signals = _score_catalog_keywords(text, agent_id)
        rule_score, rule_signals = _rule_score(text, agent_id)
        score = keyword_score + rule_score
        if score <= 0:
            continue
        confidence = min(0.97, 0.50 + score / 18.0)
        candidates.append(
            AssistantIntentCandidate(
                agent_id=agent_id,
                confidence=confidence,
                score=score,
                reason="assistant_intent_resolver:" + ",".join((keyword_signals + rule_signals)[:4]),
                signals=tuple(keyword_signals + rule_signals),
            )
        )

    if not candidates:
        return None

    candidates.sort(key=lambda item: item.score, reverse=True)
    best = candidates[0]
    runner_up = candidates[1] if len(candidates) > 1 else None
    margin = best.score - (runner_up.score if runner_up else 0)
    if best.confidence < min_confidence:
        return None
    if runner_up and margin < 1.5 and best.confidence < 0.82:
        return None
    return best

