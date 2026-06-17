"""Business Partnership Assistant recipe registry."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional


@dataclass(frozen=True)
class RecipeStep:
    id: str
    kind: str
    description: str


@dataclass(frozen=True)
class BusinessPartnershipRecipe:
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


BUSINESS_PARTNERSHIP_RECIPES: Dict[str, BusinessPartnershipRecipe] = {
    "outreach.draft": BusinessPartnershipRecipe(
        id="outreach.draft",
        name="合作 Outreach 文案",
        category="outreach",
        description="撰写冷启动邮件、私信或 BD 话术，含跟进节奏建议。",
        risk_level="low",
        requires_approval=False,
        capability_id="bp_outreach_draft",
        params_schema={
            "our_company": {"type": "string", "required": True, "label": "我方公司/品牌"},
            "target_partner": {"type": "string", "required": True, "label": "目标合作方"},
            "cooperation_type": {"type": "string", "required": False, "label": "合作类型（渠道/联名/供应/战略）"},
            "value_prop": {"type": "string", "required": False, "label": "我方价值主张"},
        },
        steps=[
            RecipeStep("collect", "research", "Research partner context"),
            RecipeStep("draft", "compose", "Draft outreach messages"),
        ],
    ),
    "proposal.generate": BusinessPartnershipRecipe(
        id="proposal.generate",
        name="商务合作方案",
        category="proposal",
        description="输出结构化合作方案：背景、模式、权益、里程碑与 ROI 预期。",
        risk_level="low",
        requires_approval=False,
        capability_id="bp_proposal_generation",
        params_schema={
            "our_company": {"type": "string", "required": True, "label": "我方公司/品牌"},
            "partner_name": {"type": "string", "required": True, "label": "合作方名称"},
            "cooperation_goal": {"type": "string", "required": False, "label": "合作目标"},
            "scope": {"type": "string", "required": False, "label": "合作范围/资源投入"},
        },
        steps=[
            RecipeStep("collect", "research", "Gather industry and partner signals"),
            RecipeStep("generate", "proposal", "Generate partnership proposal"),
        ],
    ),
    "contract.review": BusinessPartnershipRecipe(
        id="contract.review",
        name="合作条款要点",
        category="contract",
        description="梳理合作条款关键风险点、谈判筹码与需法务复核事项（非正式法律意见）。",
        risk_level="medium",
        requires_approval=False,
        capability_id="bp_contract_review",
        params_schema={
            "contract_summary": {"type": "string", "required": True, "label": "合同/条款摘要或关键条款"},
            "cooperation_type": {"type": "string", "required": False, "label": "合作类型"},
            "our_role": {"type": "string", "required": False, "label": "我方角色（甲方/乙方/联合）"},
        },
        steps=[
            RecipeStep("parse", "context", "Parse contract context"),
            RecipeStep("review", "analyze", "Produce clause review memo"),
        ],
    ),
    "partner.evaluate": BusinessPartnershipRecipe(
        id="partner.evaluate",
        name="潜在伙伴评估",
        category="partner",
        description="从战略契合、资源互补、品牌风险与执行可行性评估候选伙伴。",
        risk_level="low",
        requires_approval=False,
        capability_id="bp_partner_evaluation",
        params_schema={
            "partner_name": {"type": "string", "required": True, "label": "候选伙伴名称"},
            "industry": {"type": "string", "required": False, "label": "行业/赛道"},
            "cooperation_intent": {"type": "string", "required": False, "label": "拟合作方向"},
            "our_company": {"type": "string", "required": False, "label": "我方公司（可选）"},
        },
        steps=[
            RecipeStep("collect", "research", "Research partner background"),
            RecipeStep("evaluate", "score", "Produce partner evaluation report"),
        ],
    ),
    "pipeline.plan": BusinessPartnershipRecipe(
        id="pipeline.plan",
        name="合作 Pipeline 规划",
        category="pipeline",
        description="规划 BD 漏斗、阶段目标、关键动作与优先级排序。",
        risk_level="low",
        requires_approval=False,
        capability_id="bp_pipeline_planning",
        params_schema={
            "business_goal": {"type": "string", "required": True, "label": "业务目标"},
            "target_segments": {"type": "string", "required": False, "label": "目标伙伴类型/行业"},
            "timeline": {"type": "string", "required": False, "label": "时间窗口（如 Q2）"},
            "resources": {"type": "string", "required": False, "label": "可用 BD 资源"},
        },
        steps=[
            RecipeStep("collect", "research", "Research market partnership patterns"),
            RecipeStep("plan", "pipeline", "Build partnership pipeline plan"),
        ],
    ),
}


def get_recipe(recipe_id: str) -> Optional[BusinessPartnershipRecipe]:
    return BUSINESS_PARTNERSHIP_RECIPES.get(recipe_id)


def list_recipes(category: Optional[str] = None) -> List[Dict[str, Any]]:
    recipes = list(BUSINESS_PARTNERSHIP_RECIPES.values())
    if category:
        recipes = [r for r in recipes if r.category == category]
    return [r.to_dict() for r in recipes]
