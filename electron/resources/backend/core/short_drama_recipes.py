"""AI Short Drama recipe registry."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional


@dataclass(frozen=True)
class RecipeStep:
    id: str
    kind: str
    description: str


@dataclass(frozen=True)
class ShortDramaRecipe:
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


SHORT_DRAMA_RECIPES: Dict[str, ShortDramaRecipe] = {
    "short_drama.script": ShortDramaRecipe(
        id="short_drama.script",
        name="短剧剧本",
        category="pre",
        description="根据一句话创意生成短剧剧本、标题与角色卡。",
        risk_level="low",
        requires_approval=False,
        capability_id="short_drama_production",
        params_schema={
            "brief": {"type": "string", "required": True, "label": "剧情创意"},
            "platform": {"type": "string", "required": False, "label": "目标平台", "default": "douyin"},
            "duration": {"type": "integer", "required": False, "label": "时长（秒）", "default": 60},
            "style": {"type": "string", "required": False, "label": "风格", "default": "甜宠"},
            "episodes": {"type": "integer", "required": False, "label": "集数", "default": 1},
        },
        steps=[
            RecipeStep("analyze", "analyze", "分析创意与平台特性"),
            RecipeStep("write", "creative", "撰写剧本与角色卡"),
        ],
    ),
    "short_drama.storyboard": ShortDramaRecipe(
        id="short_drama.storyboard",
        name="短剧分镜",
        category="pre",
        description="为短剧生成可视化分镜，包含每个场景的镜头、台词与情绪。",
        risk_level="low",
        requires_approval=False,
        capability_id="short_drama_production",
        params_schema={
            "brief": {"type": "string", "required": True, "label": "剧情创意"},
            "platform": {"type": "string", "required": False, "label": "目标平台", "default": "douyin"},
            "duration": {"type": "integer", "required": False, "label": "时长（秒）", "default": 60},
            "style": {"type": "string", "required": False, "label": "风格", "default": "甜宠"},
            "scenes": {"type": "integer", "required": False, "label": "场景数", "default": 6},
        },
        steps=[
            RecipeStep("analyze", "analyze", "解析创意与角色"),
            RecipeStep("storyboard", "creative", "设计分镜与场景描述"),
        ],
    ),
    "short_drama.produce": ShortDramaRecipe(
        id="short_drama.produce",
        name="生成短剧成片",
        category="produce",
        description="端到端生成：剧本 → 分镜 → 场景图 → 配音/字幕建议 → 最终成片。",
        risk_level="medium",
        requires_approval=False,
        capability_id="short_drama_production",
        params_schema={
            "brief": {"type": "string", "required": True, "label": "剧情创意"},
            "platform": {"type": "string", "required": False, "label": "目标平台", "default": "douyin"},
            "duration": {"type": "integer", "required": False, "label": "时长（秒）", "default": 60},
            "style": {"type": "string", "required": False, "label": "风格", "default": "甜宠"},
            "generate_images": {"type": "boolean", "required": False, "label": "生成场景图", "default": True},
            "voiceover": {"type": "boolean", "required": False, "label": "生成配音", "default": False},
        },
        steps=[
            RecipeStep("script", "creative", "生成剧本与角色卡"),
            RecipeStep("storyboard", "creative", "设计分镜"),
            RecipeStep("assets", "generate", "生成场景画面与配音素材"),
            RecipeStep("assembly", "edit", "素材组装与成片输出"),
        ],
    ),
    "short_drama.scene_regen": ShortDramaRecipe(
        id="short_drama.scene_regen",
        name="单场景重生成",
        category="produce",
        description="针对分镜中的单个场景重新生成画面或视频。",
        risk_level="low",
        requires_approval=False,
        capability_id="short_drama_production",
        params_schema={
            "scene_description": {"type": "string", "required": True, "label": "场景描述"},
            "style": {"type": "string", "required": False, "label": "风格", "default": ""},
            "shot_type": {"type": "string", "required": False, "label": "景别", "default": "中景"},
        },
        steps=[
            RecipeStep("optimize", "analyze", "优化场景提示词"),
            RecipeStep("generate", "generate", "生成新场景画面"),
        ],
    ),
}


def get_recipe(recipe_id: str) -> Optional[ShortDramaRecipe]:
    return SHORT_DRAMA_RECIPES.get(recipe_id)


def list_recipes(category: Optional[str] = None) -> List[Dict[str, Any]]:
    recipes = list(SHORT_DRAMA_RECIPES.values())
    if category:
        recipes = [r for r in recipes if r.category == category]
    return [r.to_dict() for r in recipes]
