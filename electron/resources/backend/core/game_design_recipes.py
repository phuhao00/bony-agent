"""Game Design (策划) Agent recipe registry."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional


@dataclass(frozen=True)
class RecipeStep:
    id: str
    kind: str
    description: str


@dataclass(frozen=True)
class GameDesignRecipe:
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


GAME_DESIGN_RECIPES: Dict[str, GameDesignRecipe] = {
    "concept.pitch": GameDesignRecipe(
        id="concept.pitch",
        name="游戏概念案",
        category="concept",
        description="一句话卖点、目标用户、核心体验与差异化 pitch。",
        risk_level="low",
        requires_approval=False,
        capability_id="gd_concept_system",
        params_schema={
            "idea": {"type": "string", "required": True, "label": "游戏创意/方向"},
            "audience": {"type": "string", "required": False, "label": "目标用户"},
            "platform": {"type": "string", "required": False, "label": "平台"},
        },
        steps=[
            RecipeStep("collect", "research", "Gather market and trend signals"),
            RecipeStep("pitch", "design", "Write concept pitch"),
        ],
    ),
    "core.loop": GameDesignRecipe(
        id="core.loop",
        name="核心玩法循环",
        category="system",
        description="拆解核心循环、动机、反馈与留存钩子。",
        risk_level="low",
        requires_approval=False,
        capability_id="gd_concept_system",
        params_schema={
            "game_name": {"type": "string", "required": True, "label": "游戏名/方向"},
            "genre": {"type": "string", "required": False, "label": "类型"},
            "session_length": {"type": "string", "required": False, "label": "单局时长目标"},
        },
        steps=[
            RecipeStep("collect", "research", "Research genre loops"),
            RecipeStep("loop", "design", "Design core gameplay loop"),
        ],
    ),
    "system.design": GameDesignRecipe(
        id="system.design",
        name="系统设计文档",
        category="system",
        description="成长、战斗、社交或经济等子系统的机制与边界。",
        risk_level="low",
        requires_approval=False,
        capability_id="gd_concept_system",
        params_schema={
            "system_name": {"type": "string", "required": True, "label": "系统名称"},
            "game_context": {"type": "string", "required": False, "label": "游戏背景"},
            "goals": {"type": "string", "required": False, "label": "设计目标"},
        },
        steps=[
            RecipeStep("collect", "research", "Research system patterns"),
            RecipeStep("spec", "design", "Write system design spec"),
        ],
    ),
    "level.plan": GameDesignRecipe(
        id="level.plan",
        name="关卡/内容规划",
        category="level",
        description="章节结构、难度曲线与内容投放节奏。",
        risk_level="low",
        requires_approval=False,
        capability_id="gd_level_content",
        params_schema={
            "content_scope": {"type": "string", "required": True, "label": "内容范围（如 第一章）"},
            "game_type": {"type": "string", "required": False, "label": "玩法类型"},
            "target_hours": {"type": "string", "required": False, "label": "目标游玩时长"},
        },
        steps=[
            RecipeStep("collect", "research", "Research level design patterns"),
            RecipeStep("plan", "design", "Produce level content plan"),
        ],
    ),
    "narrative.outline": GameDesignRecipe(
        id="narrative.outline",
        name="剧情与世界观大纲",
        category="narrative",
        description="世界观支柱、主线脉络与关键角色关系。",
        risk_level="low",
        requires_approval=False,
        capability_id="gd_narrative_balance",
        params_schema={
            "theme": {"type": "string", "required": True, "label": "主题/题材"},
            "tone": {"type": "string", "required": False, "label": "叙事基调"},
            "length": {"type": "string", "required": False, "label": "体量（短篇/长线）"},
        },
        steps=[
            RecipeStep("collect", "research", "Gather narrative references"),
            RecipeStep("outline", "design", "Write narrative outline"),
        ],
    ),
    "balance.framework": GameDesignRecipe(
        id="balance.framework",
        name="数值平衡框架",
        category="balance",
        description="属性维度、成长曲线与平衡验证思路（表格框架）。",
        risk_level="low",
        requires_approval=False,
        capability_id="gd_narrative_balance",
        params_schema={
            "system_focus": {"type": "string", "required": True, "label": "数值重点（战斗/经济/养成）"},
            "game_name": {"type": "string", "required": False, "label": "游戏名"},
            "constraints": {"type": "string", "required": False, "label": "约束（PVP/PVE/付费）"},
        },
        steps=[
            RecipeStep("collect", "research", "Research balance benchmarks"),
            RecipeStep("framework", "design", "Draft balance framework"),
        ],
    ),
}


def get_recipe(recipe_id: str) -> Optional[GameDesignRecipe]:
    return GAME_DESIGN_RECIPES.get(recipe_id)


def list_recipes(category: Optional[str] = None) -> List[Dict[str, Any]]:
    recipes = list(GAME_DESIGN_RECIPES.values())
    if category:
        recipes = [r for r in recipes if r.category == category]
    return [r.to_dict() for r in recipes]
