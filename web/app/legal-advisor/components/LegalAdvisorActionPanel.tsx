"use client";

import {
  BookOpen,
  Building2,
  FileText,
  Landmark,
  Scale,
  Sparkles,
} from "lucide-react";
import {
  AssistantRecipeActionShell,
  type AssistantCategoryTab,
} from "@/app/components/AssistantRecipeUi";
import type { LegalAdvisorSuggestion } from "../hooks/useLegalAdvisorRunner";
import {
  buildRecipeParams,
  getInputHints,
  type RecipeItem,
} from "../lib/recipeActions";

const CATEGORIES: AssistantCategoryTab[] = [
  { id: "recommended", label: "推荐", icon: Sparkles },
  { id: "case", label: "案例解读", icon: Scale },
  { id: "compliance", label: "合规体检", icon: Building2 },
  { id: "regulation", label: "法规政策", icon: BookOpen },
  { id: "contract", label: "合同风险", icon: FileText },
  { id: "finance", label: "经济金融", icon: Landmark },
];

export function LegalAdvisorActionPanel({
  category,
  onCategoryChange,
  recipes,
  suggestions,
  loading,
  onRunRecipe,
  topicInput,
  onTopicInputChange,
  contextInput,
  onContextInputChange,
  onValidationError,
}: {
  category: string;
  onCategoryChange: (id: string) => void;
  recipes: RecipeItem[];
  suggestions: LegalAdvisorSuggestion[];
  loading: boolean;
  onRunRecipe: (recipeId: string, params?: Record<string, unknown>) => void;
  topicInput: string;
  onTopicInputChange: (v: string) => void;
  contextInput: string;
  onContextInputChange: (v: string) => void;
  onValidationError?: (message: string) => void;
}) {
  const inputHints = getInputHints(category);

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
      buildParams={(recipeId) => buildRecipeParams(recipeId, { topicInput, contextInput })}
      showInputs={inputHints.showPrimary && category !== "recommended"}
      startLabel="开始审阅"
      loadingLabel="审阅中…"
      searchPlaceholder="搜索审阅类型"
      inputSection={
        <>
          <p className="text-xs font-medium text-[color:var(--label-tertiary)]">录入审阅材料</p>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[color:var(--label-secondary)]">
              {inputHints.primaryLabel}
            </label>
            <input
              type="text"
              value={topicInput}
              onChange={(e) => onTopicInputChange(e.target.value)}
              placeholder={inputHints.primaryPlaceholder}
              className="w-full rounded-xl bg-[var(--card-surface)] px-3.5 py-2.5 text-sm text-[color:var(--foreground)] outline-none ring-1 ring-[var(--border-subtle)] focus:ring-[color:var(--accent)]"
            />
          </div>
          {inputHints.showSecondary ? (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[color:var(--label-secondary)]">
                {inputHints.secondaryLabel}
              </label>
              <textarea
                value={contextInput}
                onChange={(e) => onContextInputChange(e.target.value)}
                placeholder={inputHints.secondaryPlaceholder}
                rows={4}
                className="w-full resize-y rounded-xl bg-[var(--card-surface)] px-3.5 py-2.5 text-sm leading-relaxed text-[color:var(--foreground)] outline-none ring-1 ring-[var(--border-subtle)] focus:ring-[color:var(--accent)]"
              />
            </div>
          ) : null}
        </>
      }
    />
  );
}
