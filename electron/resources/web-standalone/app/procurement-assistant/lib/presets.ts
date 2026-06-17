export type ProcurementPreset = {
  label: string;
  recipe_id: string;
  params?: Record<string, unknown>;
  category: string;
};

export const PROCUREMENT_PRESETS: ProcurementPreset[] = [
  {
    label: "IT 设备 RFQ",
    recipe_id: "rfq.draft",
    params: {
      item: "企业 IT 办公设备（笔记本）",
      quantity: "200 台",
      deadline: "45 天内交付",
    },
    category: "rfq",
  },
  {
    label: "供应商尽职评估",
    recipe_id: "vendor.evaluate",
    params: { vendor_name: "目标供应商", category: "你的采购品类" },
    category: "vendor",
  },
  {
    label: "三家报价对比",
    recipe_id: "quote.compare",
    params: {
      item: "办公耗材",
      quotes: "A: 单价 10 元, 交期 7 天\nB: 单价 9.5 元, 交期 14 天",
    },
    category: "quote",
  },
  {
    label: "采购合同审查",
    recipe_id: "contract.review",
    params: { contract_summary: "粘贴合同关键条款…", vendor_name: "供应商名称" },
    category: "contract",
  },
  {
    label: "品类降本分析",
    recipe_id: "cost.optimize",
    params: { category: "MRO 间接物料", current_spend: "年 spend 约 500 万" },
    category: "cost",
  },
  {
    label: "寻源策略规划",
    recipe_id: "sourcing.strategy",
    params: { category: "电子元器件", constraints: "交期稳定、国产化备选" },
    category: "sourcing",
  },
];
