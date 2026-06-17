"""Graph Router — select Orchestrator / Planning / Lobster / Chat graph."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from agents.chat_request import ChatRequest
from agents.publish_routing import is_video_generation_publish_request
from core.assistant_intent_resolver import resolve_assistant_intent

GraphId = Literal["orchestrator", "planning", "lobster", "chat", "claude_code"]

_CLAUDE_CODE_KEYWORDS = [
    "实现", "修改代码", "修 bug", "修复 bug", "写测试", "加测试", "重构",
    "implement", "fix bug", "write test", "refactor", "coding",
    "分析下代码", "分析代码", "帮我分析下代码", "帮我分析代码",
    "改代码", "写代码", "代码实现",
]

_PLANNING_KEYWORDS = [
    "分步", "规划", "完整流程", "多步", "plan and execute", "planning",
    "先规划", "步骤", "流水线创作",
]

# 强制 Agent 冲突覆盖：当用户当前在图片编辑 Agent，但输入明显是“生成新图”时，
# 忽略强制 Agent，交给 Orchestrator 重新路由到 media_agent。
_IMAGE_GENERATION_SIGNALS = [
    "生成", "画一张", "画个", "做一张图", "做张图", "生成图片", "生成一张图",
    "生成图", "文生图", "封面图", "头图", "banner", "海报", "宣传图",
    "配图", "插图", "主图",
]
_IMAGE_EDIT_SIGNALS = [
    "编辑", "修改", "修图", "改图", "去水印", "换背景", "换衣服",
    "局部重绘", "扩图", "超分", "高清修复", "参考图", "抠图", "移除",
    "去掉", "inpaint", "outpaint", "upscale", "watermark",
]


def _looks_like_image_generation(text: str) -> bool:
    """输入是否更像生成新图，而非编辑已有图片。"""
    text = text.lower()
    has_generation = any(kw.lower() in text for kw in _IMAGE_GENERATION_SIGNALS)
    has_edit = any(kw.lower() in text for kw in _IMAGE_EDIT_SIGNALS)
    return has_generation and not has_edit


_LOBSTER_KEYWORDS = [
    "龙虾", "lobster", "openclaw", "open claw", "爆款流水线", "趋势采集并发布",
]


@dataclass
class GraphRouteResult:
    graph_id: GraphId
    reason: str
    confidence: float = 0.9
    agent_id: str | None = None
    use_publish_pipeline: bool = False


def select_graph(req: ChatRequest) -> GraphRouteResult:
    user_text = req.resolved_input()
    hint = (req.graph_hint or "auto").strip().lower()

    if hint in {"orchestrator", "planning", "lobster", "chat", "claude_code"}:
        return GraphRouteResult(graph_id=hint, reason="graph_hint")

    if req.agent_id:
        # 图片编辑 Agent 被强制选中时，若用户输入明显是生成新图，
        # 交给 Orchestrator 重新选择 media_agent，避免“无源图无法生成”的回复。
        if req.agent_id == "image_edit_agent" and _looks_like_image_generation(user_text):
            return GraphRouteResult(
                graph_id="orchestrator",
                reason="generation_overrides_forced_image_edit",
                confidence=0.92,
            )
        return GraphRouteResult(
            graph_id="chat",
            reason="forced_agent_id",
            agent_id=req.agent_id,
        )

    if any(kw in user_text for kw in _LOBSTER_KEYWORDS):
        return GraphRouteResult(graph_id="lobster", reason="keyword_lobster", confidence=0.95)

    if any(kw in user_text for kw in _CLAUDE_CODE_KEYWORDS):
        try:
            from services.claude_code_service import get_health_status

            if get_health_status().get("ready"):
                return GraphRouteResult(
                    graph_id="claude_code",
                    reason="keyword_claude_code",
                    confidence=0.94,
                )
        except Exception:
            pass

    if any(kw in user_text for kw in _PLANNING_KEYWORDS):
        return GraphRouteResult(graph_id="planning", reason="keyword_planning", confidence=0.92)

    assistant_candidate = resolve_assistant_intent(user_text)
    if assistant_candidate:
        return GraphRouteResult(
            graph_id="chat",
            reason=assistant_candidate.reason,
            confidence=assistant_candidate.confidence,
            agent_id=assistant_candidate.agent_id,
        )

    use_pipeline = is_video_generation_publish_request(user_text)
    return GraphRouteResult(
        graph_id="orchestrator",
        reason="default_multi_agent" if not use_pipeline else "video_publish_orchestrator",
        use_publish_pipeline=use_pipeline,
    )
