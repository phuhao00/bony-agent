import { requireTrimmed, rejectPlaceholders } from "@/app/components/assistantValidation";

export function buildRecipeParams(
  recipeId: string,
  ctx: { productInput: string; campaignInput: string },
): { params?: Record<string, unknown>; error?: string } {
  const { productInput, campaignInput } = ctx;
  if (recipeId === "strategy.plan") {
    const err = rejectPlaceholders(productInput, ["你的产品"], "请填写产品/品牌名称");
    if (err) return { error: err };
    return { params: { product: productInput.trim(), goal: "获客与转化" } };
  }
  if (recipeId === "creative.copy") {
    const err = rejectPlaceholders(productInput, ["你的产品"], "请填写产品/品牌名称");
    if (err) return { error: err };
    return { params: { product: productInput.trim(), count: 5 } };
  }
  if (recipeId === "audience.analyze") {
    const err = rejectPlaceholders(productInput, ["你的产品"], "请填写产品/品牌名称");
    if (err) return { error: err };
    return { params: { product: productInput.trim() } };
  }
  if (recipeId === "budget.allocate") {
    const err = requireTrimmed(productInput, "请填写总预算");
    if (err) return { error: err };
    return { params: { total_budget: productInput.trim(), goal: "获客" } };
  }
  if (recipeId === "report.review") {
    const err = rejectPlaceholders(campaignInput, ["你的活动"], "请填写活动名称");
    if (err) return { error: err };
    return { params: { campaign_name: campaignInput.trim() } };
  }
  return { params: {} };
}

export function inputLabel(category: string) {
  if (category === "report") return "活动名称";
  if (category === "budget") return "总预算";
  return "产品/品牌";
}

export function inputPlaceholder(category: string) {
  if (category === "report") return "例如：618 大促信息流";
  if (category === "budget") return "例如：月预算 10 万";
  return "例如：SaaS 协作工具、美妆礼盒";
}
