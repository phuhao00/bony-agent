import { requireTrimmed, rejectPlaceholders } from "@/app/components/assistantValidation";

export function buildRecipeParams(
  recipeId: string,
  ctx: { ourCompanyInput: string; partnerInput: string },
): { params?: Record<string, unknown>; error?: string } {
  const { ourCompanyInput, partnerInput } = ctx;
  if (recipeId === "outreach.draft") {
    const ourErr = rejectPlaceholders(ourCompanyInput, ["你的公司"], "请填写我方公司/品牌");
    if (ourErr) return { error: ourErr };
    const partnerErr = rejectPlaceholders(partnerInput, ["目标合作方"], "请填写目标合作方");
    if (partnerErr) return { error: partnerErr };
    return {
      params: { our_company: ourCompanyInput.trim(), target_partner: partnerInput.trim() },
    };
  }
  if (recipeId === "proposal.generate") {
    const ourErr = rejectPlaceholders(ourCompanyInput, ["你的公司"], "请填写我方公司/品牌");
    if (ourErr) return { error: ourErr };
    const partnerErr = rejectPlaceholders(partnerInput, ["目标合作方"], "请填写目标合作方");
    if (partnerErr) return { error: partnerErr };
    return {
      params: { our_company: ourCompanyInput.trim(), partner_name: partnerInput.trim() },
    };
  }
  if (recipeId === "partner.evaluate") {
    const err = rejectPlaceholders(partnerInput, ["目标合作方"], "请填写目标合作方名称");
    if (err) return { error: err };
    return { params: { partner_name: partnerInput.trim() } };
  }
  if (recipeId === "pipeline.plan") {
    const err = requireTrimmed(partnerInput, "请填写业务目标");
    if (err) return { error: err };
    return { params: { business_goal: partnerInput.trim() } };
  }
  if (recipeId === "contract.review") {
    const err = rejectPlaceholders(partnerInput, ["请在此粘贴合同关键条款"], "请粘贴合同关键条款");
    if (err) return { error: err };
    return { params: { contract_summary: partnerInput.trim() } };
  }
  return { params: {} };
}

export function showOurField(category: string) {
  return category !== "recommended" && category !== "contract" && category !== "pipeline";
}

export function showPartnerField(category: string) {
  return category !== "recommended" && category !== "pipeline";
}

export function showPipelineField(category: string) {
  return category === "pipeline";
}
