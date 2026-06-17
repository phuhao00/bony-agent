import { requireTrimmed, rejectPlaceholders } from "@/app/components/assistantValidation";

export type RecipeItem = {
  id: string;
  name: string;
  category: string;
  description: string;
};

export type RecipeInputContext = {
  topicInput: string;
  productInput: string;
};

export function buildRecipeParams(
  recipeId: string,
  ctx: RecipeInputContext,
): { params?: Record<string, unknown>; error?: string } {
  const { topicInput, productInput } = ctx;

  if (recipeId === "market.research") {
    const err = requireTrimmed(topicInput, "请填写市场/赛道关键词");
    if (err) return { error: err };
    return { params: { topic: topicInput.trim(), region: "中国" } };
  }
  if (recipeId === "idea.generate") {
    const err = requireTrimmed(topicInput, "请填写目标市场关键词");
    if (err) return { error: err };
    return { params: { market: topicInput.trim(), count: 5 } };
  }
  if (recipeId === "competitor.scan") {
    const err = requireTrimmed(topicInput, "请填写品类/赛道关键词");
    if (err) return { error: err };
    return { params: { category: topicInput.trim() } };
  }
  if (recipeId === "product.analyze" || recipeId === "product.optimize") {
    const err = rejectPlaceholders(productInput, ["你的产品"], "请填写产品名称");
    if (err) return { error: err };
    return { params: { product_name: productInput.trim() } };
  }
  if (recipeId === "pm.discovery") {
    const err = requireTrimmed(topicInput, "请填写待探索的问题或假设");
    if (err) return { error: err };
    return {
      params: { problem: topicInput.trim(), context: productInput.trim() || undefined },
    };
  }
  if (recipeId === "pm.jtbd") {
    const err = requireTrimmed(topicInput, "请填写产品/场景");
    if (err) return { error: err };
    return {
      params: { product: topicInput.trim(), segment: productInput.trim() || undefined },
    };
  }
  if (recipeId === "pm.strategy") {
    const err = requireTrimmed(topicInput, "请填写产品愿景/方向");
    if (err) return { error: err };
    return {
      params: { vision: topicInput.trim(), market: productInput.trim() || undefined },
    };
  }
  if (recipeId === "pm.roadmap") {
    const err = requireTrimmed(topicInput, "请填写业务目标或 OKR");
    if (err) return { error: err };
    return {
      params: { goals: topicInput.trim(), horizon: productInput.trim() || undefined },
    };
  }
  if (recipeId === "pm.user_story") {
    const err = requireTrimmed(topicInput, "请填写功能/需求描述");
    if (err) return { error: err };
    return {
      params: { feature: topicInput.trim(), persona: productInput.trim() || undefined },
    };
  }
  if (recipeId === "pm.prioritize") {
    const err = requireTrimmed(topicInput, "请填写待排序的 initiative 列表");
    if (err) return { error: err };
    return {
      params: {
        initiatives: topicInput.trim(),
        constraints: productInput.trim() || undefined,
      },
    };
  }
  return { params: {} };
}

export function getInputHints(category: string): {
  primaryLabel: string;
  primaryPlaceholder: string;
  secondaryLabel?: string;
  secondaryPlaceholder?: string;
  showPrimary: boolean;
  showSecondary: boolean;
} {
  if (category === "recommended") {
    return {
      primaryLabel: "",
      primaryPlaceholder: "",
      showPrimary: false,
      showSecondary: false,
    };
  }
  if (category === "product") {
    return {
      primaryLabel: "产品名称",
      primaryPlaceholder: "例如：AI Media Agent",
      showPrimary: true,
      showSecondary: false,
    };
  }
  if (category === "methodology") {
    return {
      primaryLabel: "问题 / 目标 / 需求",
      primaryPlaceholder: "例如：用户留存下降假设、Q1 OKR、导出 PDF 功能",
      secondaryLabel: "补充上下文（可选）",
      secondaryPlaceholder: "例如：B2B SaaS、运营经理、2 人团队 1 季度",
      showPrimary: true,
      showSecondary: true,
    };
  }
  return {
    primaryLabel: "市场 / 赛道关键词",
    primaryPlaceholder: "例如：AI 生产力工具、跨境电商、本地生活",
    showPrimary: true,
    showSecondary: false,
  };
}

export function filterRecipes(
  recipes: RecipeItem[],
  category: string,
  query: string,
): RecipeItem[] {
  const q = query.trim().toLowerCase();
  let list: RecipeItem[];
  if (category === "recommended") {
    list = [];
  } else if (category === "methodology") {
    list = recipes.filter((r) => r.id.startsWith("pm."));
  } else {
    list = recipes.filter((r) => r.category === category);
  }
  if (!q) return list;
  return list.filter(
    (r) =>
      r.name.toLowerCase().includes(q) ||
      r.description.toLowerCase().includes(q) ||
      r.id.toLowerCase().includes(q),
  );
}
