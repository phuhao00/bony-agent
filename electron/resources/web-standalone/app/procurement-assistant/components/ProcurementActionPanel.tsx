"use client";

import {
  ClipboardList,
  FileText,
  Scale,
  ShoppingCart,
  Sparkles,
  TrendingDown,
  Truck,
} from "lucide-react";
import {
  AssistantRecipeActionShell,
  type AssistantCategoryTab,
} from "@/app/components/AssistantRecipeUi";
import type { ProcurementSuggestion } from "../hooks/useProcurementRunner";
import {
  buildRecipeParams,
  showQuotesInput,
  showTopicInput,
  showVendorInput,
} from "../lib/recipeActions";

const CATEGORIES: AssistantCategoryTab[] = [
  { id: "recommended", label: "推荐", icon: Sparkles },
  { id: "vendor", label: "供应商", icon: Truck },
  { id: "rfq", label: "询价 RFQ", icon: ClipboardList },
  { id: "quote", label: "报价比对", icon: Scale },
  { id: "contract", label: "合同审查", icon: FileText },
  { id: "cost", label: "成本优化", icon: TrendingDown },
  { id: "sourcing", label: "寻源策略", icon: ShoppingCart },
];

type Recipe = {
  id: string;
  name: string;
  category: string;
  description: string;
};

export function ProcurementActionPanel({
  category,
  onCategoryChange,
  recipes,
  suggestions,
  loading,
  onRunRecipe,
  topicInput,
  onTopicInputChange,
  vendorInput,
  onVendorInputChange,
  quotesInput,
  onQuotesInputChange,
  onValidationError,
}: {
  category: string;
  onCategoryChange: (id: string) => void;
  recipes: Recipe[];
  suggestions: ProcurementSuggestion[];
  loading: boolean;
  onRunRecipe: (recipeId: string, params?: Record<string, unknown>) => void;
  topicInput: string;
  onTopicInputChange: (v: string) => void;
  vendorInput: string;
  onVendorInputChange: (v: string) => void;
  quotesInput: string;
  onQuotesInputChange: (v: string) => void;
  onValidationError?: (message: string) => void;
}) {
  return (
    <AssistantRecipeActionShell
      categories={CATEGORIES}
      category={category}
      onCategoryChange={onCategoryChange}
      recipes={recipes}
      suggestions={suggestions}
      loading={loading}
      onRunRecipe={onRunRecipe}
      onValidationError={onValidationError}
      buildParams={(recipeId) =>
        buildRecipeParams(recipeId, { topicInput, vendorInput, quotesInput })
      }
      showInputs={category !== "recommended"}
      startLabel="开始采购分析"
      searchPlaceholder="搜索采购模板"
      inputSection={
        <>
          <p className="text-xs font-medium text-[color:var(--label-tertiary)]">录入采购信息</p>
          {showTopicInput(category) ? (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[color:var(--label-secondary)]">
                {category === "quote" ? "采购标的" : category === "vendor" ? "采购品类" : "品类/标的"}
              </label>
              <input
                type="text"
                value={topicInput}
                onChange={(e) => onTopicInputChange(e.target.value)}
                placeholder="例如：IT 设备、MRO 耗材、电子元器件"
                className="w-full rounded-xl bg-[var(--card-surface)] px-3.5 py-2.5 text-sm text-[color:var(--foreground)] outline-none ring-1 ring-[var(--border-subtle)] focus:ring-[color:var(--accent)]"
              />
            </div>
          ) : null}
          {showVendorInput(category) ? (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[color:var(--label-secondary)]">
                供应商名称
              </label>
              <input
                type="text"
                value={vendorInput}
                onChange={(e) => onVendorInputChange(e.target.value)}
                placeholder="供应商名称"
                className="w-full rounded-xl bg-[var(--card-surface)] px-3.5 py-2.5 text-sm text-[color:var(--foreground)] outline-none ring-1 ring-[var(--border-subtle)] focus:ring-[color:var(--accent)]"
              />
            </div>
          ) : null}
          {showQuotesInput(category) ? (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[color:var(--label-secondary)]">
                {category === "contract" ? "合同关键条款" : "报价摘要（每家一行）"}
              </label>
              <textarea
                value={quotesInput}
                onChange={(e) => onQuotesInputChange(e.target.value)}
                rows={4}
                placeholder={
                  category === "contract"
                    ? "粘贴付款、交付、质保、违约等关键条款…"
                    : "A 公司: 单价 10 元, 交期 7 天\nB 公司: …"
                }
                className="w-full resize-y rounded-xl bg-[var(--card-surface)] px-3.5 py-2.5 text-sm leading-relaxed text-[color:var(--foreground)] outline-none ring-1 ring-[var(--border-subtle)] focus:ring-[color:var(--accent)]"
              />
            </div>
          ) : null}
        </>
      }
    />
  );
}
