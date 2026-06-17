"use client";

import {
  BarChart3,
  DollarSign,
  Megaphone,
  Sparkles,
  Target,
  Users,
} from "lucide-react";
import {
  AssistantRecipeActionShell,
  type AssistantCategoryTab,
} from "@/app/components/AssistantRecipeUi";
import type { AdCampaignSuggestion } from "../hooks/useAdCampaignRunner";
import { buildRecipeParams, inputLabel, inputPlaceholder } from "../lib/recipeActions";

const CATEGORIES: AssistantCategoryTab[] = [
  { id: "recommended", label: "推荐", icon: Sparkles },
  { id: "strategy", label: "投放策略", icon: Target },
  { id: "creative", label: "创意文案", icon: Megaphone },
  { id: "audience", label: "受众定向", icon: Users },
  { id: "budget", label: "预算分配", icon: DollarSign },
  { id: "report", label: "效果复盘", icon: BarChart3 },
];

type Recipe = {
  id: string;
  name: string;
  category: string;
  description: string;
};

export function AdCampaignActionPanel({
  category,
  onCategoryChange,
  recipes,
  suggestions,
  loading,
  onRunRecipe,
  productInput,
  onProductInputChange,
  campaignInput,
  onCampaignInputChange,
  onValidationError,
}: {
  category: string;
  onCategoryChange: (id: string) => void;
  recipes: Recipe[];
  suggestions: AdCampaignSuggestion[];
  loading: boolean;
  onRunRecipe: (recipeId: string, params?: Record<string, unknown>) => void;
  productInput: string;
  onProductInputChange: (v: string) => void;
  campaignInput: string;
  onCampaignInputChange: (v: string) => void;
  onValidationError?: (message: string) => void;
}) {
  const inputValue = category === "report" ? campaignInput : productInput;
  const onInputChange = category === "report" ? onCampaignInputChange : onProductInputChange;

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
        buildRecipeParams(recipeId, { productInput, campaignInput })
      }
      showInputs={category !== "recommended"}
      startLabel="开始投放分析"
      searchPlaceholder="搜索投放模板"
      inputSection={
        <>
          <p className="text-xs font-medium text-[color:var(--label-tertiary)]">战役背景</p>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[color:var(--label-secondary)]">
              {inputLabel(category)}
            </label>
            <input
              type="text"
              value={inputValue}
              onChange={(e) => onInputChange(e.target.value)}
              placeholder={inputPlaceholder(category)}
              className="w-full rounded-xl bg-[var(--card-surface)] px-3.5 py-2.5 text-sm text-[color:var(--foreground)] outline-none ring-1 ring-[var(--border-subtle)] focus:ring-[color:var(--accent)]"
            />
          </div>
        </>
      }
    />
  );
}
