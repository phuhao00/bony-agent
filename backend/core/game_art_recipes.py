"""Game Art Agent recipe registry."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional


@dataclass(frozen=True)
class RecipeStep:
    id: str
    kind: str
    description: str


@dataclass(frozen=True)
class GameArtRecipe:
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


GAME_ART_RECIPES: Dict[str, GameArtRecipe] = {
    "style.guide": GameArtRecipe(
        id="style.guide",
        name="视觉风格指南",
        category="style",
        description="定义美术方向、色彩、光影、材质与参考 mood board 要点。",
        risk_level="low",
        requires_approval=False,
        capability_id="ga_visual_design",
        params_schema={
            "game_name": {"type": "string", "required": True, "label": "游戏/项目名"},
            "genre": {"type": "string", "required": False, "label": "类型（如 二次元 RPG）"},
            "mood": {"type": "string", "required": False, "label": "情绪基调"},
        },
        steps=[
            RecipeStep("collect", "research", "Gather visual and market references"),
            RecipeStep("synthesize", "guide", "Produce visual style guide"),
        ],
    ),
    "character.brief": GameArtRecipe(
        id="character.brief",
        name="角色设计 Brief",
        category="character",
        description="输出角色设定、形体语言、服装层级与三视图要点。",
        risk_level="low",
        requires_approval=False,
        capability_id="ga_character_scene",
        params_schema={
            "character_name": {"type": "string", "required": True, "label": "角色名/定位"},
            "role": {"type": "string", "required": False, "label": "职业/定位"},
            "world_setting": {"type": "string", "required": False, "label": "世界观简述"},
        },
        steps=[
            RecipeStep("collect", "research", "Collect character references"),
            RecipeStep("brief", "design", "Write character art brief"),
        ],
    ),
    "scene.concept": GameArtRecipe(
        id="scene.concept",
        name="场景概念设计",
        category="scene",
        description="场景氛围、构图、地标元素与关卡可读性建议。",
        risk_level="low",
        requires_approval=False,
        capability_id="ga_character_scene",
        params_schema={
            "scene_name": {"type": "string", "required": True, "label": "场景名称"},
            "purpose": {"type": "string", "required": False, "label": "玩法/叙事用途"},
            "style_ref": {"type": "string", "required": False, "label": "风格参考"},
        },
        steps=[
            RecipeStep("collect", "research", "Gather scene references"),
            RecipeStep("concept", "design", "Produce scene concept brief"),
        ],
    ),
    "ui.art.guide": GameArtRecipe(
        id="ui.art.guide",
        name="UI 美术规范",
        category="ui",
        description="界面层级、图标风格、字体与动效美术规范草案。",
        risk_level="low",
        requires_approval=False,
        capability_id="ga_visual_design",
        params_schema={
            "game_name": {"type": "string", "required": True, "label": "游戏名"},
            "platform": {"type": "string", "required": False, "label": "平台（手游/PC/主机）"},
            "ui_style": {"type": "string", "required": False, "label": "期望风格"},
        },
        steps=[
            RecipeStep("collect", "research", "Research UI patterns"),
            RecipeStep("guide", "design", "Draft UI art guidelines"),
        ],
    ),
    "visual.research": GameArtRecipe(
        id="visual.research",
        name="竞品视觉分析",
        category="research",
        description="扫描同类游戏视觉差异化、强项与可借鉴点。",
        risk_level="low",
        requires_approval=False,
        capability_id="ga_visual_design",
        params_schema={
            "genre": {"type": "string", "required": True, "label": "品类/赛道"},
            "reference_games": {"type": "string", "required": False, "label": "参考游戏（逗号分隔）"},
            "our_game": {"type": "string", "required": False, "label": "我方项目（可选）"},
        },
        steps=[
            RecipeStep("collect", "research", "Research competitor visuals"),
            RecipeStep("compare", "analyze", "Produce visual competitive report"),
        ],
    ),
}


def get_recipe(recipe_id: str) -> Optional[GameArtRecipe]:
    return GAME_ART_RECIPES.get(recipe_id)


def list_recipes(category: Optional[str] = None) -> List[Dict[str, Any]]:
    recipes = list(GAME_ART_RECIPES.values())
    if category:
        recipes = [r for r in recipes if r.category == category]
    return [r.to_dict() for r in recipes]
