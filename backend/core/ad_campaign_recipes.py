"""Ad Campaign Assistant recipe registry."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional


@dataclass(frozen=True)
class RecipeStep:
    id: str
    kind: str
    description: str


@dataclass(frozen=True)
class AdCampaignRecipe:
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


AD_CAMPAIGN_RECIPES: Dict[str, AdCampaignRecipe] = {
    "strategy.plan": AdCampaignRecipe(
        id="strategy.plan",
        name="投放策略规划",
        category="strategy",
        description="结合平台特性与市场信号，输出渠道组合、投放节奏与 KPI 框架。",
        risk_level="low",
        requires_approval=False,
        capability_id="ad_strategy_planning",
        params_schema={
            "product": {"type": "string", "required": True, "label": "产品/品牌"},
            "goal": {"type": "string", "required": False, "label": "投放目标（获客/品牌/转化）"},
            "budget": {"type": "string", "required": False, "label": "预算范围"},
            "platforms": {"type": "string", "required": False, "label": "目标平台（逗号分隔）"},
        },
        steps=[
            RecipeStep("collect", "research", "Gather platform and market signals"),
            RecipeStep("plan", "synthesize", "Build ad strategy plan"),
        ],
    ),
    "creative.copy": AdCampaignRecipe(
        id="creative.copy",
        name="广告创意文案",
        category="creative",
        description="生成多版本标题、正文、CTA 与 A/B 测试方向。",
        risk_level="low",
        requires_approval=False,
        capability_id="ad_creative_generation",
        params_schema={
            "product": {"type": "string", "required": True, "label": "产品/服务"},
            "audience": {"type": "string", "required": False, "label": "目标受众"},
            "platform": {"type": "string", "required": False, "label": "投放平台"},
            "tone": {"type": "string", "required": False, "label": "语气风格"},
            "count": {"type": "integer", "required": False, "label": "创意组数", "default": 5},
        },
        steps=[
            RecipeStep("collect", "research", "Collect audience and competitor ad signals"),
            RecipeStep("generate", "creative", "Generate ad copy variants"),
        ],
    ),
    "audience.analyze": AdCampaignRecipe(
        id="audience.analyze",
        name="受众分析与定向",
        category="audience",
        description="拆解人群画像、兴趣标签、Lookalike 方向与排除策略。",
        risk_level="low",
        requires_approval=False,
        capability_id="ad_audience_analysis",
        params_schema={
            "product": {"type": "string", "required": True, "label": "产品/品类"},
            "core_users": {"type": "string", "required": False, "label": "已知核心用户描述"},
            "platform": {"type": "string", "required": False, "label": "主要平台"},
        },
        steps=[
            RecipeStep("collect", "research", "Research audience segments"),
            RecipeStep("analyze", "segment", "Produce targeting recommendations"),
        ],
    ),
    "budget.allocate": AdCampaignRecipe(
        id="budget.allocate",
        name="预算分配方案",
        category="budget",
        description="按渠道、阶段与 ROI 预期给出预算切分与放量节奏。",
        risk_level="low",
        requires_approval=False,
        capability_id="ad_budget_allocation",
        params_schema={
            "total_budget": {"type": "string", "required": True, "label": "总预算"},
            "goal": {"type": "string", "required": False, "label": "核心目标"},
            "platforms": {"type": "string", "required": False, "label": "计划投放平台"},
            "duration": {"type": "string", "required": False, "label": "投放周期"},
        },
        steps=[
            RecipeStep("collect", "research", "Benchmark channel costs and benchmarks"),
            RecipeStep("allocate", "plan", "Build budget allocation plan"),
        ],
    ),
    "report.review": AdCampaignRecipe(
        id="report.review",
        name="投放效果复盘",
        category="report",
        description="基于投放数据摘要，输出诊断、优化建议与下一轮实验清单。",
        risk_level="low",
        requires_approval=False,
        capability_id="ad_performance_review",
        params_schema={
            "campaign_name": {"type": "string", "required": True, "label": "活动名称"},
            "metrics": {"type": "string", "required": False, "label": "关键指标（CTR/CPC/CPA/ROAS 等）"},
            "issues": {"type": "string", "required": False, "label": "已知问题或异常"},
        },
        steps=[
            RecipeStep("collect", "context", "Parse campaign metrics context"),
            RecipeStep("review", "optimize", "Produce performance review report"),
        ],
    ),
}


def get_recipe(recipe_id: str) -> Optional[AdCampaignRecipe]:
    return AD_CAMPAIGN_RECIPES.get(recipe_id)


def list_recipes(category: Optional[str] = None) -> List[Dict[str, Any]]:
    recipes = list(AD_CAMPAIGN_RECIPES.values())
    if category:
        recipes = [r for r in recipes if r.category == category]
    return [r.to_dict() for r in recipes]
