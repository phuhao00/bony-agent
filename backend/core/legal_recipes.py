"""Legal Advisor Agent recipe registry."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional


@dataclass(frozen=True)
class RecipeStep:
    id: str
    kind: str
    description: str


@dataclass(frozen=True)
class LegalRecipe:
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


LEGAL_RECIPES: Dict[str, LegalRecipe] = {
    "case.research": LegalRecipe(
        id="case.research",
        name="案例检索与权威解读",
        category="case",
        description="检索司法案例、裁判规则与监管处罚，输出结构化法律解读与实务要点。",
        risk_level="low",
        requires_approval=False,
        capability_id="legal_case_research",
        params_schema={
            "topic": {"type": "string", "required": True, "label": "法律问题/争议焦点"},
            "context": {"type": "string", "required": False, "label": "业务背景（可选）"},
            "jurisdiction": {"type": "string", "required": False, "label": "适用法域（默认中国）"},
        },
        steps=[
            RecipeStep("collect", "research", "Gather cases, regulations and enforcement signals"),
            RecipeStep("analyze", "synthesize", "Produce authoritative case interpretation report"),
        ],
    ),
    "compliance.audit": LegalRecipe(
        id="compliance.audit",
        name="公司合规体检",
        category="compliance",
        description="从工商登记、公司治理、劳动用工、数据与广告合规等维度评估企业合规风险。",
        risk_level="low",
        requires_approval=False,
        capability_id="legal_compliance_audit",
        params_schema={
            "company_profile": {"type": "string", "required": True, "label": "公司概况（行业/规模/业务）"},
            "concerns": {"type": "string", "required": False, "label": "已知合规疑虑"},
            "stage": {"type": "string", "required": False, "label": "发展阶段（初创/成长期/上市准备）"},
        },
        steps=[
            RecipeStep("collect", "research", "Collect regulatory and enforcement context"),
            RecipeStep("audit", "analyze", "Produce compliance health check report"),
        ],
    ),
    "regulation.interpret": LegalRecipe(
        id="regulation.interpret",
        name="法规政策解读",
        category="regulation",
        description="解读法律法规、部门规章与最新政策对企业经营与个人经济行为的影响。",
        risk_level="low",
        requires_approval=False,
        capability_id="legal_regulation_interpret",
        params_schema={
            "regulation": {"type": "string", "required": True, "label": "法规/政策名称或关键词"},
            "business_scenario": {"type": "string", "required": False, "label": "适用业务场景"},
            "entity_type": {"type": "string", "required": False, "label": "主体类型（公司/个人/合伙企业）"},
        },
        steps=[
            RecipeStep("collect", "research", "Gather regulation text and official guidance"),
            RecipeStep("interpret", "analyze", "Produce practical interpretation memo"),
        ],
    ),
    "contract.risk": LegalRecipe(
        id="contract.risk",
        name="合同条款风险审查",
        category="contract",
        description="识别投融资、劳动、采购、合作等合同中的高风险条款与合规缺口。",
        risk_level="medium",
        requires_approval=False,
        capability_id="legal_contract_review",
        params_schema={
            "contract_type": {"type": "string", "required": True, "label": "合同类型"},
            "summary": {"type": "string", "required": False, "label": "合同要点/条款摘要"},
            "party_role": {"type": "string", "required": False, "label": "我方角色（甲方/乙方/投资方等）"},
        },
        steps=[
            RecipeStep("collect", "research", "Collect contract law and case references"),
            RecipeStep("review", "analyze", "Produce clause risk review memo"),
        ],
    ),
    "finance.legal": LegalRecipe(
        id="finance.legal",
        name="经济金融财务法律要点",
        category="finance",
        description="围绕税务、投融资、资金结算、财务内控与个人经济纠纷，梳理法律边界与合规建议。",
        risk_level="low",
        requires_approval=False,
        capability_id="legal_finance_advisory",
        params_schema={
            "topic": {"type": "string", "required": True, "label": "议题（如股权转让、关联交易、个税筹划）"},
            "entity": {"type": "string", "required": False, "label": "涉及主体（公司/个人）"},
            "details": {"type": "string", "required": False, "label": "具体情况描述"},
        },
        steps=[
            RecipeStep("collect", "research", "Gather finance-related legal signals"),
            RecipeStep("advise", "analyze", "Produce finance legal advisory memo"),
        ],
    ),
}


def get_recipe(recipe_id: str) -> Optional[LegalRecipe]:
    return LEGAL_RECIPES.get(recipe_id)


def list_recipes(category: Optional[str] = None) -> List[Dict[str, Any]]:
    recipes = list(LEGAL_RECIPES.values())
    if category:
        recipes = [r for r in recipes if r.category == category]
    return [r.to_dict() for r in recipes]
