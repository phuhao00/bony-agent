"""Procurement Assistant recipe registry."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional


@dataclass(frozen=True)
class RecipeStep:
    id: str
    kind: str
    description: str


@dataclass(frozen=True)
class ProcurementRecipe:
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


PROCUREMENT_RECIPES: Dict[str, ProcurementRecipe] = {
    "vendor.evaluate": ProcurementRecipe(
        id="vendor.evaluate",
        name="供应商尽职评估",
        category="vendor",
        description="从资质、交付、质量、财务与合规维度评估潜在供应商。",
        risk_level="low",
        requires_approval=False,
        capability_id="procurement_vendor_eval",
        params_schema={
            "vendor_name": {"type": "string", "required": True, "label": "供应商名称"},
            "category": {"type": "string", "required": False, "label": "采购品类"},
            "requirements": {"type": "string", "required": False, "label": "关键要求"},
        },
        steps=[
            RecipeStep("collect", "research", "Gather vendor and market signals"),
            RecipeStep("evaluate", "analyze", "Produce vendor due diligence report"),
        ],
    ),
    "rfq.draft": ProcurementRecipe(
        id="rfq.draft",
        name="RFQ 询价单起草",
        category="rfq",
        description="生成结构化的询价/招标需求文档，含规格、交付与评分标准。",
        risk_level="low",
        requires_approval=False,
        capability_id="procurement_rfq",
        params_schema={
            "item": {"type": "string", "required": True, "label": "采购标的/品类"},
            "quantity": {"type": "string", "required": False, "label": "数量/规模"},
            "deadline": {"type": "string", "required": False, "label": "期望交付周期"},
            "budget": {"type": "string", "required": False, "label": "预算范围"},
        },
        steps=[
            RecipeStep("collect", "research", "Research market benchmarks"),
            RecipeStep("draft", "generate", "Draft RFQ document"),
        ],
    ),
    "quote.compare": ProcurementRecipe(
        id="quote.compare",
        name="报价对比分析",
        category="quote",
        description="对比多家供应商报价，识别差异项并给出采购建议。",
        risk_level="low",
        requires_approval=False,
        capability_id="procurement_quote_compare",
        params_schema={
            "item": {"type": "string", "required": True, "label": "采购标的"},
            "quotes": {"type": "string", "required": True, "label": "报价摘要（供应商:价格:条款）"},
            "criteria": {"type": "string", "required": False, "label": "评估权重/关注点"},
        },
        steps=[
            RecipeStep("parse", "analyze", "Parse quote inputs"),
            RecipeStep("compare", "synthesize", "Produce comparison matrix"),
        ],
    ),
    "contract.review": ProcurementRecipe(
        id="contract.review",
        name="采购合同条款审查",
        category="contract",
        description="识别采购合同中的付款、交付、质保、违约与合规风险（非正式法律意见）。",
        risk_level="low",
        requires_approval=False,
        capability_id="procurement_contract_review",
        params_schema={
            "contract_summary": {"type": "string", "required": True, "label": "合同摘要/关键条款"},
            "vendor_name": {"type": "string", "required": False, "label": "供应商名称"},
            "deal_value": {"type": "string", "required": False, "label": "合同金额"},
        },
        steps=[
            RecipeStep("collect", "research", "Gather procurement contract norms"),
            RecipeStep("review", "analyze", "Produce clause risk review"),
        ],
    ),
    "cost.optimize": ProcurementRecipe(
        id="cost.optimize",
        name="采购成本优化",
        category="cost",
        description="分析采购成本结构，提出降本、集采与替代方案建议。",
        risk_level="low",
        requires_approval=False,
        capability_id="procurement_cost_optimize",
        params_schema={
            "category": {"type": "string", "required": True, "label": "采购品类/Spend Category"},
            "current_spend": {"type": "string", "required": False, "label": "当前年度 spend"},
            "pain_points": {"type": "string", "required": False, "label": "已知问题"},
        },
        steps=[
            RecipeStep("collect", "research", "Research cost benchmarks"),
            RecipeStep("optimize", "analyze", "Build cost optimization plan"),
        ],
    ),
    "sourcing.strategy": ProcurementRecipe(
        id="sourcing.strategy",
        name="寻源策略规划",
        category="sourcing",
        description="制定品类寻源策略：供应商池、区域布局、风险分散与谈判要点。",
        risk_level="low",
        requires_approval=False,
        capability_id="procurement_sourcing",
        params_schema={
            "category": {"type": "string", "required": True, "label": "品类/物料"},
            "business_context": {"type": "string", "required": False, "label": "业务背景"},
            "constraints": {"type": "string", "required": False, "label": "约束（交期/合规/国产化等）"},
        },
        steps=[
            RecipeStep("collect", "research", "Gather sourcing landscape"),
            RecipeStep("plan", "synthesize", "Produce sourcing strategy"),
        ],
    ),
}


def get_recipe(recipe_id: str) -> Optional[ProcurementRecipe]:
    return PROCUREMENT_RECIPES.get(recipe_id)


def list_recipes(category: Optional[str] = None) -> List[Dict[str, Any]]:
    recipes = list(PROCUREMENT_RECIPES.values())
    if category:
        recipes = [r for r in recipes if r.category == category]
    return [r.to_dict() for r in recipes]
