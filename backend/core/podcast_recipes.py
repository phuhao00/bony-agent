"""AI Podcast Production recipe registry."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional


@dataclass(frozen=True)
class RecipeStep:
    id: str
    kind: str
    description: str


@dataclass(frozen=True)
class PodcastRecipe:
    id: str
    name: str
    category: str
    description: str
    risk_level: str
    requires_approval: bool
    capability_id: str
    steps: List[RecipeStep] = field(default_factory=list)
    params_schema: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        data = asdict(self)
        data["steps"] = [asdict(s) for s in self.steps]
        return data


PODCAST_RECIPES: Dict[str, PodcastRecipe] = {
    "podcast.plan": PodcastRecipe(
        id="podcast.plan",
        name="播客策划",
        category="plan",
        description="根据主题生成播客定位、目标听众、节目结构与时长大纲。",
        risk_level="low",
        requires_approval=False,
        capability_id="podcast_production",
        params_schema={
            "topic": {"type": "string", "required": True, "label": "播客主题"},
            "format": {"type": "string", "required": False, "label": "节目形式", "default": "双人对话"},
            "audience": {"type": "string", "required": False, "label": "目标听众", "default": "普通听众"},
            "tone": {"type": "string", "required": False, "label": "语气", "default": "轻松"},
            "duration": {"type": "integer", "required": False, "label": "时长（分钟）", "default": 15},
        },
        steps=[
            RecipeStep("research", "research", "检索主题与竞品播客信号"),
            RecipeStep("plan", "plan", "生成节目策划方案"),
        ],
    ),
    "podcast.script": PodcastRecipe(
        id="podcast.script",
        name="播客脚本",
        category="write",
        description="生成完整播客脚本，含主持人对话、过渡、笑点与金句。",
        risk_level="low",
        requires_approval=False,
        capability_id="podcast_production",
        params_schema={
            "topic": {"type": "string", "required": True, "label": "播客主题"},
            "format": {"type": "string", "required": False, "label": "节目形式", "default": "双人对话"},
            "hosts": {"type": "string", "required": False, "label": "主持人设定", "default": "A（理性）, B（活泼）"},
            "duration": {"type": "integer", "required": False, "label": "时长（分钟）", "default": 15},
            "tone": {"type": "string", "required": False, "label": "语气", "default": "轻松"},
        },
        steps=[
            RecipeStep("outline", "plan", "设计节目段落"),
            RecipeStep("script", "creative", "撰写完整脚本"),
        ],
    ),
    "podcast.cover": PodcastRecipe(
        id="podcast.cover",
        name="播客封面",
        category="design",
        description="为播客生成封面图创意与提示词，可直接用于 AI 生图。",
        risk_level="low",
        requires_approval=False,
        capability_id="podcast_production",
        params_schema={
            "title": {"type": "string", "required": True, "label": "播客标题"},
            "topic": {"type": "string", "required": False, "label": "主题", "default": ""},
            "style": {"type": "string", "required": False, "label": "视觉风格", "default": "现代简约"},
        },
        steps=[
            RecipeStep("concept", "analyze", "提炼封面视觉概念"),
            RecipeStep("prompt", "creative", "生成生图提示词"),
        ],
    ),
    "podcast.voiceover": PodcastRecipe(
        id="podcast.voiceover",
        name="播客配音",
        category="audio",
        description="将播客脚本转换为语音（TTS），支持多主播音色与 BGM 建议。",
        risk_level="low",
        requires_approval=False,
        capability_id="podcast_production",
        params_schema={
            "script": {"type": "string", "required": True, "label": "播客脚本"},
            "voice": {"type": "string", "required": False, "label": "音色", "default": "default"},
            "bgm_mood": {"type": "string", "required": False, "label": "BGM 情绪", "default": "轻松"},
        },
        steps=[
            RecipeStep("parse", "analyze", "解析脚本与角色"),
            RecipeStep("tts", "generate", "生成配音音频"),
        ],
    ),
    "podcast.publish": PodcastRecipe(
        id="podcast.publish",
        name="发布准备",
        category="publish",
        description="生成播客 shownotes、时间轴、话题标签与多平台发布文案。",
        risk_level="low",
        requires_approval=False,
        capability_id="podcast_production",
        params_schema={
            "title": {"type": "string", "required": True, "label": "播客标题"},
            "script": {"type": "string", "required": True, "label": "播客脚本"},
            "platform": {"type": "string", "required": False, "label": "平台", "default": "xiaoyuzhou"},
        },
        steps=[
            RecipeStep("summarize", "analyze", "提炼亮点与时间轴"),
            RecipeStep("format", "edit", "输出平台发布文案"),
        ],
    ),
}


def get_recipe(recipe_id: str) -> Optional[PodcastRecipe]:
    return PODCAST_RECIPES.get(recipe_id)


def list_recipes(category: Optional[str] = None) -> List[Dict[str, Any]]:
    recipes = list(PODCAST_RECIPES.values())
    if category:
        recipes = [r for r in recipes if r.category == category]
    return [r.to_dict() for r in recipes]
