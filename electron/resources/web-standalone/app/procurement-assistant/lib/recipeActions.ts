export function buildRecipeParams(
  recipeId: string,
  ctx: { topicInput: string; vendorInput: string; quotesInput: string },
): { params?: Record<string, unknown>; error?: string } {
  const { topicInput, vendorInput, quotesInput } = ctx;
  if (recipeId === "vendor.evaluate") {
    if (!vendorInput.trim()) return { error: "请填写供应商名称" };
    return {
      params: { vendor_name: vendorInput.trim(), category: topicInput.trim() || "通用品类" },
    };
  }
  if (recipeId === "rfq.draft") {
    if (!topicInput.trim()) return { error: "请填写采购标的/品类" };
    return { params: { item: topicInput.trim() } };
  }
  if (recipeId === "quote.compare") {
    if (!topicInput.trim()) return { error: "请填写采购标的" };
    if (!quotesInput.trim()) return { error: "请填写至少一家供应商的报价摘要" };
    return { params: { item: topicInput.trim(), quotes: quotesInput.trim() } };
  }
  if (recipeId === "contract.review") {
    if (!quotesInput.trim()) return { error: "请粘贴合同关键条款" };
    return {
      params: { contract_summary: quotesInput.trim(), vendor_name: vendorInput.trim() },
    };
  }
  if (recipeId === "cost.optimize" || recipeId === "sourcing.strategy") {
    if (!topicInput.trim()) return { error: "请填写采购品类" };
    return { params: { category: topicInput.trim() } };
  }
  return { params: {} };
}

export function showTopicInput(category: string) {
  return category !== "recommended" && category !== "contract";
}

export function showVendorInput(category: string) {
  return category === "vendor" || category === "contract";
}

export function showQuotesInput(category: string) {
  return category === "quote" || category === "contract";
}
