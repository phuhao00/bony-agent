export type ProductManagerPreset = {
  label: string;
  recipe_id: string;
  params?: Record<string, unknown>;
  category: string;
};

export const PRODUCT_MANAGER_PRESETS: ProductManagerPreset[] = [
  {
    label: "AI 工具市场洞察",
    recipe_id: "market.research",
    params: { topic: "AI 生产力工具", audience: "创作者与知识工作者", region: "中国" },
    category: "market",
  },
  {
    label: "SaaS 产品创意",
    recipe_id: "idea.generate",
    params: { market: "中小企业协作办公", constraints: "6 个月 MVP", count: 5 },
    category: "idea",
  },
  {
    label: "产品健康诊断",
    recipe_id: "product.analyze",
    params: { product_name: "你的产品", description: "", target_users: "" },
    category: "product",
  },
  {
    label: "迭代优化方案",
    recipe_id: "product.optimize",
    params: { product_name: "你的产品", goals: "提升留存与核心功能渗透" },
    category: "product",
  },
  {
    label: "竞品格局扫描",
    recipe_id: "competitor.scan",
    params: { category: "你的赛道", competitors: "" },
    category: "competitor",
  },
];
