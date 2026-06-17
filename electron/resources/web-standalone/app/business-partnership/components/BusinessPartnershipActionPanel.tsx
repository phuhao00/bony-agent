"use client";

import {
  FileText,
  GitBranch,
  Handshake,
  Mail,
  Scale,
  Sparkles,
  UserCheck,
} from "lucide-react";
import {
  AssistantRecipeActionShell,
  type AssistantCategoryTab,
} from "@/app/components/AssistantRecipeUi";
import type { BusinessPartnershipSuggestion } from "../hooks/useBusinessPartnershipRunner";
import {
  buildRecipeParams,
  showOurField,
  showPartnerField,
  showPipelineField,
} from "../lib/recipeActions";

const CATEGORIES: AssistantCategoryTab[] = [
  { id: "recommended", label: "推荐", icon: Sparkles },
  { id: "outreach", label: "Outreach", icon: Mail },
  { id: "proposal", label: "合作方案", icon: FileText },
  { id: "contract", label: "条款要点", icon: Scale },
  { id: "partner", label: "伙伴评估", icon: UserCheck },
  { id: "pipeline", label: "Pipeline", icon: GitBranch },
];

type Recipe = {
  id: string;
  name: string;
  category: string;
  description: string;
};

export function BusinessPartnershipActionPanel({
  category,
  onCategoryChange,
  recipes,
  suggestions,
  loading,
  onRunRecipe,
  ourCompanyInput,
  onOurCompanyInputChange,
  partnerInput,
  onPartnerInputChange,
  onValidationError,
}: {
  category: string;
  onCategoryChange: (id: string) => void;
  recipes: Recipe[];
  suggestions: BusinessPartnershipSuggestion[];
  loading: boolean;
  onRunRecipe: (recipeId: string, params?: Record<string, unknown>) => void;
  ourCompanyInput: string;
  onOurCompanyInputChange: (v: string) => void;
  partnerInput: string;
  onPartnerInputChange: (v: string) => void;
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
        buildRecipeParams(recipeId, { ourCompanyInput, partnerInput })
      }
      showInputs={category !== "recommended"}
      startLabel="开始 BD 分析"
      searchPlaceholder="搜索合作模板"
      footerNote={
        category !== "recommended" ? (
          <p className="flex items-center gap-1 px-1 text-[10px] text-[color:var(--label-tertiary)]">
            <Handshake className="h-3 w-3" />
            条款分析仅供参考，正式合同请法务复核
          </p>
        ) : null
      }
      inputSection={
        <>
          <p className="text-xs font-medium text-[color:var(--label-tertiary)]">录入合作背景</p>
          {showOurField(category) ? (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[color:var(--label-secondary)]">
                我方公司/品牌
              </label>
              <input
                type="text"
                value={ourCompanyInput}
                onChange={(e) => onOurCompanyInputChange(e.target.value)}
                placeholder="你的公司或品牌名"
                className="w-full rounded-xl bg-[var(--card-surface)] px-3.5 py-2.5 text-sm text-[color:var(--foreground)] outline-none ring-1 ring-[var(--border-subtle)] focus:ring-[color:var(--accent)]"
              />
            </div>
          ) : null}
          {showPartnerField(category) && !showPipelineField(category) ? (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[color:var(--label-secondary)]">
                {category === "contract" ? "合同/条款摘要" : "目标合作方"}
              </label>
              <textarea
                value={partnerInput}
                onChange={(e) => onPartnerInputChange(e.target.value)}
                rows={category === "contract" ? 4 : 2}
                placeholder={
                  category === "contract"
                    ? "粘贴合作合同关键条款…"
                    : "目标公司或品牌名"
                }
                className="w-full resize-y rounded-xl bg-[var(--card-surface)] px-3.5 py-2.5 text-sm leading-relaxed text-[color:var(--foreground)] outline-none ring-1 ring-[var(--border-subtle)] focus:ring-[color:var(--accent)]"
              />
            </div>
          ) : null}
          {showPipelineField(category) ? (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[color:var(--label-secondary)]">
                业务目标
              </label>
              <input
                type="text"
                value={partnerInput}
                onChange={(e) => onPartnerInputChange(e.target.value)}
                placeholder="例如：拓展 3 家战略渠道伙伴"
                className="w-full rounded-xl bg-[var(--card-surface)] px-3.5 py-2.5 text-sm text-[color:var(--foreground)] outline-none ring-1 ring-[var(--border-subtle)] focus:ring-[color:var(--accent)]"
              />
            </div>
          ) : null}
        </>
      }
    />
  );
}
