"""Product Manager Agent recipe registry."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional


@dataclass(frozen=True)
class RecipeStep:
    id: str
    kind: str
    description: str


@dataclass(frozen=True)
class ProductManagerRecipe:
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


PRODUCT_MANAGER_RECIPES: Dict[str, ProductManagerRecipe] = {
    "market.research": ProductManagerRecipe(
        id="market.research",
        name="市场洞察报告",
        category="market",
        description="结合联网搜索与热点信号，输出市场规模、趋势、机会与风险洞察。",
        risk_level="low",
        requires_approval=False,
        capability_id="pm_market_research",
        params_schema={
            "topic": {"type": "string", "required": True, "label": "市场/赛道"},
            "audience": {"type": "string", "required": False, "label": "目标用户"},
            "region": {"type": "string", "required": False, "label": "区域（如 中国/全球）"},
        },
        steps=[
            RecipeStep("collect", "research", "Gather web and trend signals"),
            RecipeStep("analyze", "synthesize", "Synthesize market insight report"),
        ],
    ),
    "idea.generate": ProductManagerRecipe(
        id="idea.generate",
        name="产品创意 brainstorm",
        category="idea",
        description="基于市场空白与用户痛点，生成可落地的产品点子与 MVP 方向。",
        risk_level="low",
        requires_approval=False,
        capability_id="pm_idea_generation",
        params_schema={
            "market": {"type": "string", "required": True, "label": "目标市场/场景"},
            "constraints": {"type": "string", "required": False, "label": "约束（预算/技术/周期）"},
            "count": {"type": "integer", "required": False, "label": "创意数量", "default": 5},
        },
        steps=[
            RecipeStep("collect", "research", "Collect market signals"),
            RecipeStep("ideate", "generate", "Generate structured product ideas"),
        ],
    ),
    "product.analyze": ProductManagerRecipe(
        id="product.analyze",
        name="现有产品诊断",
        category="product",
        description="从定位、用户价值、增长、留存与商业化角度诊断现有产品。",
        risk_level="low",
        requires_approval=False,
        capability_id="pm_product_analysis",
        params_schema={
            "product_name": {"type": "string", "required": True, "label": "产品名称"},
            "description": {"type": "string", "required": False, "label": "产品描述"},
            "target_users": {"type": "string", "required": False, "label": "目标用户"},
        },
        steps=[
            RecipeStep("collect", "research", "Collect product and market context"),
            RecipeStep("diagnose", "analyze", "Produce product health diagnosis"),
        ],
    ),
    "product.optimize": ProductManagerRecipe(
        id="product.optimize",
        name="产品迭代优化",
        category="product",
        description="针对现有产品提出适应市场变化的迭代路线、功能优先级与运营策略。",
        risk_level="low",
        requires_approval=False,
        capability_id="pm_product_analysis",
        params_schema={
            "product_name": {"type": "string", "required": True, "label": "产品名称"},
            "description": {"type": "string", "required": False, "label": "当前产品形态"},
            "pain_points": {"type": "string", "required": False, "label": "已知痛点/反馈"},
            "goals": {"type": "string", "required": False, "label": "业务目标"},
        },
        steps=[
            RecipeStep("collect", "research", "Gather market and feedback signals"),
            RecipeStep("plan", "optimize", "Build iteration and ops roadmap"),
        ],
    ),
    "competitor.scan": ProductManagerRecipe(
        id="competitor.scan",
        name="竞品格局扫描",
        category="competitor",
        description="扫描竞品功能、定价、差异化与可进攻/防守位。",
        risk_level="low",
        requires_approval=False,
        capability_id="pm_market_research",
        params_schema={
            "category": {"type": "string", "required": True, "label": "品类/赛道"},
            "competitors": {"type": "string", "required": False, "label": "已知竞品（逗号分隔）"},
            "our_product": {"type": "string", "required": False, "label": "我方产品（可选）"},
        },
        steps=[
            RecipeStep("collect", "research", "Research competitor landscape"),
            RecipeStep("compare", "analyze", "Produce competitive matrix"),
        ],
    ),
    "pm.discovery": ProductManagerRecipe(
        id="pm.discovery",
        name="Discovery 全流程",
        category="discovery",
        description="从问题假设到验证方案的完整 Discovery 循环（Teresa Torres / Marty Cagan 方法论）。",
        risk_level="low",
        requires_approval=False,
        capability_id="pm_product_analysis",
        params_schema={
            "problem": {"type": "string", "required": True, "label": "待探索的问题/假设"},
            "context": {"type": "string", "required": False, "label": "背景与约束"},
        },
        steps=[
            RecipeStep("collect", "research", "Gather discovery context and signals"),
            RecipeStep("synthesize", "skill", "Run discovery-process skill workflow"),
        ],
    ),
    "pm.jtbd": ProductManagerRecipe(
        id="pm.jtbd",
        name="JTBD 分析",
        category="discovery",
        description="Jobs-to-be-Done 分析：识别用户要完成的「工作」与未满足需求。",
        risk_level="low",
        requires_approval=False,
        capability_id="pm_product_analysis",
        params_schema={
            "product": {"type": "string", "required": True, "label": "产品/场景"},
            "segment": {"type": "string", "required": False, "label": "目标用户细分"},
        },
        steps=[
            RecipeStep("collect", "research", "Collect user and market context"),
            RecipeStep("synthesize", "skill", "Run jobs-to-be-done skill workflow"),
        ],
    ),
    "pm.strategy": ProductManagerRecipe(
        id="pm.strategy",
        name="产品战略工作坊",
        category="strategy",
        description="结构化产品战略会话：愿景、差异化、战略选择与成功指标。",
        risk_level="low",
        requires_approval=False,
        capability_id="pm_idea_generation",
        params_schema={
            "vision": {"type": "string", "required": True, "label": "产品愿景/方向"},
            "market": {"type": "string", "required": False, "label": "目标市场/赛道"},
        },
        steps=[
            RecipeStep("collect", "research", "Gather market and strategy signals"),
            RecipeStep("synthesize", "skill", "Run product-strategy-session skill workflow"),
        ],
    ),
    "pm.roadmap": ProductManagerRecipe(
        id="pm.roadmap",
        name="战略路线图",
        category="delivery",
        description="Now/Next/Later 战略路线图：从目标到可执行发布计划。",
        risk_level="low",
        requires_approval=False,
        capability_id="pm_product_analysis",
        params_schema={
            "goals": {"type": "string", "required": True, "label": "业务目标/OKR"},
            "horizon": {"type": "string", "required": False, "label": "规划周期（如 Q1-Q2）"},
        },
        steps=[
            RecipeStep("collect", "research", "Gather roadmap inputs"),
            RecipeStep("synthesize", "skill", "Run roadmap-planning skill workflow"),
        ],
    ),
    "pm.user_story": ProductManagerRecipe(
        id="pm.user_story",
        name="用户故事撰写",
        category="delivery",
        description="Mike Cohn 格式 + Gherkin 验收标准，产出开发就绪的用户故事。",
        risk_level="low",
        requires_approval=False,
        capability_id="pm_product_analysis",
        params_schema={
            "feature": {"type": "string", "required": True, "label": "功能/需求描述"},
            "persona": {"type": "string", "required": False, "label": "用户角色"},
        },
        steps=[
            RecipeStep("collect", "research", "Clarify feature context"),
            RecipeStep("synthesize", "skill", "Run user-story skill workflow"),
        ],
    ),
    "pm.prioritize": ProductManagerRecipe(
        id="pm.prioritize",
        name="优先级建议",
        category="strategy",
        description="RICE/ICE 等框架下的 initiative 优先级排序与取舍建议。",
        risk_level="low",
        requires_approval=False,
        capability_id="pm_product_analysis",
        params_schema={
            "initiatives": {"type": "string", "required": True, "label": "待排序的 initiative 列表"},
            "constraints": {"type": "string", "required": False, "label": "资源/时间约束"},
        },
        steps=[
            RecipeStep("collect", "research", "Gather prioritization context"),
            RecipeStep("synthesize", "skill", "Run prioritization-advisor skill workflow"),
        ],
    ),
}


def get_recipe(recipe_id: str) -> Optional[ProductManagerRecipe]:
    return PRODUCT_MANAGER_RECIPES.get(recipe_id)


def list_recipes(category: Optional[str] = None) -> List[Dict[str, Any]]:
    recipes = list(PRODUCT_MANAGER_RECIPES.values())
    if category:
        recipes = [r for r in recipes if r.category == category]
    return [r.to_dict() for r in recipes]
