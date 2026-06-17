import { requireTrimmed } from "@/app/components/assistantValidation";

export type RecipeItem = {
  id: string;
  name: string;
  category: string;
  description: string;
};

export type RecipeInputContext = {
  topicInput: string;
  contextInput: string;
};

export function buildRecipeParams(
  recipeId: string,
  ctx: RecipeInputContext,
): { params?: Record<string, unknown>; error?: string } {
  const { topicInput, contextInput } = ctx;

  if (recipeId === "case.research") {
    const err = requireTrimmed(topicInput, "请填写法律议题/关键词");
    if (err) return { error: err };
    return { params: { topic: topicInput.trim(), context: contextInput.trim() } };
  }
  if (recipeId === "compliance.audit") {
    const err = requireTrimmed(topicInput, "请填写公司概况");
    if (err) return { error: err };
    return {
      params: { company_profile: topicInput.trim(), concerns: contextInput.trim() },
    };
  }
  if (recipeId === "regulation.interpret") {
    const err = requireTrimmed(topicInput, "请填写法规/政策名称");
    if (err) return { error: err };
    return {
      params: {
        regulation: topicInput.trim(),
        business_scenario: contextInput.trim(),
      },
    };
  }
  if (recipeId === "contract.risk") {
    const err = requireTrimmed(topicInput, "请填写合同类型");
    if (err) return { error: err };
    return {
      params: { contract_type: topicInput.trim(), summary: contextInput.trim() },
    };
  }
  if (recipeId === "finance.legal") {
    const err = requireTrimmed(topicInput, "请填写法律议题/关键词");
    if (err) return { error: err };
    return { params: { topic: topicInput.trim(), details: contextInput.trim() } };
  }
  return { params: {} };
}

export function getInputHints(category: string): {
  primaryLabel: string;
  primaryPlaceholder: string;
  secondaryLabel: string;
  secondaryPlaceholder: string;
  showPrimary: boolean;
  showSecondary: boolean;
} {
  if (category === "recommended") {
    return {
      primaryLabel: "",
      primaryPlaceholder: "",
      secondaryLabel: "",
      secondaryPlaceholder: "",
      showPrimary: false,
      showSecondary: false,
    };
  }
  if (category === "compliance") {
    return {
      primaryLabel: "公司概况",
      primaryPlaceholder: "例如：互联网 SaaS 公司，50 人规模，B2B 订阅模式",
      secondaryLabel: "合规疑虑（可选）",
      secondaryPlaceholder: "例如：用户数据处理、劳动用工、广告合规…",
      showPrimary: true,
      showSecondary: true,
    };
  }
  if (category === "regulation") {
    return {
      primaryLabel: "法规 / 政策",
      primaryPlaceholder: "例如：个人信息保护法、数据出境安全评估办法",
      secondaryLabel: "业务场景（可选）",
      secondaryPlaceholder: "例如：用户数据采集、跨境传输、第三方共享",
      showPrimary: true,
      showSecondary: true,
    };
  }
  if (category === "contract") {
    return {
      primaryLabel: "合同类型",
      primaryPlaceholder: "例如：股权投资协议、劳动合同、SaaS 服务合同",
      secondaryLabel: "合同要点摘要（可选）",
      secondaryPlaceholder: "粘贴关键条款、争议焦点或完整原文…",
      showPrimary: true,
      showSecondary: true,
    };
  }
  if (category === "finance") {
    return {
      primaryLabel: "法律议题 / 关键词",
      primaryPlaceholder: "例如：股权转让税务合规、融资对赌条款",
      secondaryLabel: "补充细节（可选）",
      secondaryPlaceholder: "交易结构、主体类型、金额规模等",
      showPrimary: true,
      showSecondary: true,
    };
  }
  return {
    primaryLabel: "法律议题 / 关键词",
    primaryPlaceholder: "例如：劳动合同解除与经济补偿",
    secondaryLabel: "业务背景 / 条款原文",
    secondaryPlaceholder: "粘贴案情摘要、合同条款或法规条文…",
    showPrimary: true,
    showSecondary: true,
  };
}

export function filterRecipes(
  recipes: RecipeItem[],
  category: string,
  query: string,
): RecipeItem[] {
  const q = query.trim().toLowerCase();
  const list =
    category === "recommended" ? [] : recipes.filter((r) => r.category === category);
  if (!q) return list;
  return list.filter(
    (r) =>
      r.name.toLowerCase().includes(q) ||
      r.description.toLowerCase().includes(q) ||
      r.id.toLowerCase().includes(q),
  );
}
