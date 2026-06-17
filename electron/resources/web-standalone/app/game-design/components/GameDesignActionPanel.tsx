"use client";

import {
  BookOpen,
  Calculator,
  Layers,
  Map,
  Sparkles,
  Target,
} from "lucide-react";
import {
  AssistantRecipeActionShell,
  type AssistantCategoryTab,
} from "@/app/components/AssistantRecipeUi";
import type { GameDesignSuggestion } from "../hooks/useGameDesignRunner";
import {
  buildRecipeParams,
  ideaLabel,
  scopeLabel,
  showIdeaInput,
  showScopeInput,
} from "../lib/recipeActions";

const CATEGORIES: AssistantCategoryTab[] = [
  { id: "recommended", label: "推荐", icon: Sparkles },
  { id: "concept", label: "概念案", icon: Target },
  { id: "system", label: "系统", icon: Layers },
  { id: "level", label: "关卡", icon: Map },
  { id: "narrative", label: "叙事", icon: BookOpen },
  { id: "balance", label: "数值", icon: Calculator },
];

type Recipe = {
  id: string;
  name: string;
  category: string;
  description: string;
};

export function GameDesignActionPanel({
  category,
  onCategoryChange,
  recipes,
  suggestions,
  loading,
  onRunRecipe,
  ideaInput,
  onIdeaInputChange,
  scopeInput,
  onScopeInputChange,
  onValidationError,
}: {
  category: string;
  onCategoryChange: (id: string) => void;
  recipes: Recipe[];
  suggestions: GameDesignSuggestion[];
  loading: boolean;
  onRunRecipe: (recipeId: string, params?: Record<string, unknown>) => void;
  ideaInput: string;
  onIdeaInputChange: (v: string) => void;
  scopeInput: string;
  onScopeInputChange: (v: string) => void;
  onValidationError?: (message: string) => void;
}) {
  const showInputs = category !== "recommended";

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
      buildParams={(recipeId) => buildRecipeParams(recipeId, { ideaInput, scopeInput })}
      showInputs={showInputs}
      startLabel="开始策划"
      loadingLabel="策划中…"
      searchPlaceholder="搜索策划模板"
      inputSection={
        <>
          <p className="text-xs font-medium text-[color:var(--label-tertiary)]">告诉 AI 一些背景</p>
          {showIdeaInput(category) ? (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[color:var(--label-secondary)]">
                {ideaLabel(category)}
              </label>
              <input
                type="text"
                value={ideaInput}
                onChange={(e) => onIdeaInputChange(e.target.value)}
                placeholder="例如：Roguelike 卡牌、开放世界生存"
                className="w-full rounded-xl bg-[var(--card-surface)] px-3.5 py-2.5 text-sm text-[color:var(--foreground)] outline-none ring-1 ring-[var(--border-subtle)] focus:ring-[color:var(--accent)]"
              />
            </div>
          ) : null}
          {showScopeInput(category) ? (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[color:var(--label-secondary)]">
                {scopeLabel(category)}
              </label>
              <input
                type="text"
                value={scopeInput}
                onChange={(e) => onScopeInputChange(e.target.value)}
                placeholder={
                  category === "level"
                    ? "例如：第一章、新手村到主城"
                    : category === "balance"
                      ? "例如：战斗数值、经济系统"
                      : "例如：角色养成、公会系统"
                }
                className="w-full rounded-xl bg-[var(--card-surface)] px-3.5 py-2.5 text-sm text-[color:var(--foreground)] outline-none ring-1 ring-[var(--border-subtle)] focus:ring-[color:var(--accent)]"
              />
            </div>
          ) : null}
        </>
      }
    />
  );
}
