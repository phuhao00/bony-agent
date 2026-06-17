"use client";

import {
  ArrowRight,
  BarChart3,
  BookOpen,
  Lightbulb,
  Loader2,
  Package,
  Play,
  Search,
  Sparkles,
  Swords,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";
import type { ProductManagerSuggestion } from "../hooks/useProductManagerRunner";
import {
  buildRecipeParams,
  filterRecipes,
  getInputHints,
  type RecipeItem,
} from "../lib/recipeActions";

const METHODOLOGY_CATEGORIES = new Set(["discovery", "strategy", "delivery"]);

const CATEGORIES: { id: string; label: string; icon: LucideIcon }[] = [
  { id: "recommended", label: "推荐", icon: Sparkles },
  { id: "market", label: "市场", icon: BarChart3 },
  { id: "idea", label: "创意", icon: Lightbulb },
  { id: "product", label: "产品", icon: Package },
  { id: "competitor", label: "竞品", icon: Swords },
  { id: "methodology", label: "方法论", icon: BookOpen },
];

function SegmentedControl({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex gap-1 overflow-x-auto rounded-xl bg-[var(--page-canvas)] p-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {CATEGORIES.map(({ id, label, icon: Icon }) => {
        const active = value === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition ${
              active
                ? "bg-[var(--card-surface)] text-[color:var(--foreground)] shadow-sm"
                : "text-[color:var(--label-secondary)] hover:text-[color:var(--foreground)]"
            }`}
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={2} />
            {label}
          </button>
        );
      })}
    </div>
  );
}

function RecipeCard({
  recipe,
  selected,
  onSelect,
}: {
  recipe: RecipeItem;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-2xl px-4 py-3.5 text-left transition ${
        selected
          ? "bg-[color:color-mix(in_srgb,var(--accent)_10%,var(--card-surface))] ring-2 ring-[color:var(--accent)]"
          : "bg-[var(--page-canvas)] hover:bg-[var(--nav-active-fill)]/60"
      }`}
    >
      <p className="text-[15px] font-medium text-[color:var(--foreground)]">{recipe.name}</p>
      <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-[color:var(--label-secondary)]">
        {recipe.description}
      </p>
      {METHODOLOGY_CATEGORIES.has(recipe.category) ? (
        <span className="mt-2 inline-block text-[10px] font-medium uppercase tracking-wider text-[color:var(--label-tertiary)]">
          PM Skill
        </span>
      ) : null}
    </button>
  );
}

function SuggestionCard({
  suggestion,
  selected,
  onSelect,
}: {
  suggestion: ProductManagerSuggestion;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-2xl px-4 py-3.5 text-left transition ${
        selected
          ? "bg-[color:color-mix(in_srgb,var(--accent)_10%,var(--card-surface))] ring-2 ring-[color:var(--accent)]"
          : "bg-[var(--page-canvas)] hover:bg-[var(--nav-active-fill)]/60"
      }`}
    >
      <p className="text-[15px] font-medium text-[color:var(--foreground)]">{suggestion.title}</p>
      <p className="mt-1 text-xs leading-relaxed text-[color:var(--label-secondary)]">
        {suggestion.description}
      </p>
    </button>
  );
}

export function ProductManagerActionPanel({
  category,
  onCategoryChange,
  recipes,
  suggestions,
  loading,
  onRunRecipe,
  topicInput,
  onTopicInputChange,
  productInput,
  onProductInputChange,
  onValidationError,
}: {
  category: string;
  onCategoryChange: (id: string) => void;
  recipes: RecipeItem[];
  suggestions: ProductManagerSuggestion[];
  loading: boolean;
  onRunRecipe: (recipeId: string, params?: Record<string, unknown>) => void;
  topicInput: string;
  onTopicInputChange: (v: string) => void;
  productInput: string;
  onProductInputChange: (v: string) => void;
  onValidationError?: (message: string) => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null);
  const [selectedSuggestionId, setSelectedSuggestionId] = useState<string | null>(null);

  const filtered = useMemo(
    () => filterRecipes(recipes, category, searchQuery),
    [recipes, category, searchQuery],
  );

  const selectedRecipe = useMemo(
    () => recipes.find((r) => r.id === selectedRecipeId) ?? null,
    [recipes, selectedRecipeId],
  );

  const selectedSuggestion = useMemo(
    () => suggestions.find((s) => s.id === selectedSuggestionId) ?? null,
    [suggestions, selectedSuggestionId],
  );

  const inputHints = getInputHints(category);
  const activeRecipeId = selectedRecipe?.id || selectedSuggestion?.recipe_id;
  const activeRecipe =
    selectedRecipe || (selectedSuggestion ? recipes.find((r) => r.id === selectedSuggestion.recipe_id) : null);

  const handleCategoryChange = (id: string) => {
    setSearchQuery("");
    setSelectedRecipeId(null);
    setSelectedSuggestionId(null);
    onCategoryChange(id);
  };

  const handleStart = () => {
    if (selectedSuggestion) {
      onRunRecipe(selectedSuggestion.recipe_id, selectedSuggestion.params);
      return;
    }
    if (!selectedRecipeId) return;
    const { params, error } = buildRecipeParams(selectedRecipeId, { topicInput, productInput });
    if (error) {
      onValidationError?.(error);
      return;
    }
    onRunRecipe(selectedRecipeId, params);
  };

  const canStart = Boolean(activeRecipeId) && !loading;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden">
      <SegmentedControl value={category} onChange={handleCategoryChange} />

      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--label-tertiary)]" />
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="搜索模板"
          className="w-full rounded-full bg-[var(--page-canvas)] py-2.5 pl-10 pr-4 text-sm text-[color:var(--foreground)] outline-none placeholder:text-[color:var(--label-tertiary)] focus:ring-2 focus:ring-[color:color-mix(in_srgb,var(--accent)_35%,transparent)]"
        />
      </div>

      {inputHints.showPrimary && activeRecipe ? (
        <div className="space-y-3 rounded-2xl bg-[var(--page-canvas)] p-4">
          <p className="text-xs font-medium text-[color:var(--label-tertiary)]">告诉 AI 一些背景</p>
          <input
            type="text"
            value={category === "product" ? productInput : topicInput}
            onChange={(e) =>
              category === "product"
                ? onProductInputChange(e.target.value)
                : onTopicInputChange(e.target.value)
            }
            placeholder={inputHints.primaryPlaceholder}
            className="w-full rounded-xl bg-[var(--card-surface)] px-3.5 py-2.5 text-sm text-[color:var(--foreground)] outline-none ring-1 ring-[var(--border-subtle)] focus:ring-[color:var(--accent)]"
          />
          {inputHints.showSecondary ? (
            <input
              type="text"
              value={productInput}
              onChange={(e) => onProductInputChange(e.target.value)}
              placeholder={inputHints.secondaryPlaceholder}
              className="w-full rounded-xl bg-[var(--card-surface)] px-3.5 py-2.5 text-sm text-[color:var(--foreground)] outline-none ring-1 ring-[var(--border-subtle)] focus:ring-[color:var(--accent)]"
            />
          ) : null}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-0.5">
        {category === "recommended" ? (
          suggestions.length === 0 ? (
            <p className="px-2 py-8 text-center text-sm text-[color:var(--label-secondary)]">暂无推荐</p>
          ) : (
            suggestions.map((s) => (
              <SuggestionCard
                key={s.id}
                suggestion={s}
                selected={selectedSuggestionId === s.id}
                onSelect={() => {
                  setSelectedSuggestionId(s.id);
                  setSelectedRecipeId(null);
                }}
              />
            ))
          )
        ) : filtered.length === 0 ? (
          <p className="px-2 py-8 text-center text-sm text-[color:var(--label-secondary)]">
            {searchQuery ? "没有匹配的模板" : "该分类暂无模板"}
          </p>
        ) : (
          filtered.map((recipe) => (
            <RecipeCard
              key={recipe.id}
              recipe={recipe}
              selected={selectedRecipeId === recipe.id}
              onSelect={() => {
                setSelectedRecipeId(recipe.id);
                setSelectedSuggestionId(null);
              }}
            />
          ))
        )}
      </div>

      <div className="sticky bottom-0 shrink-0 space-y-2 border-t border-[var(--border-subtle)] pt-3">
        {activeRecipe ? (
          <p className="truncate px-1 text-xs text-[color:var(--label-secondary)]">
            已选：<span className="font-medium text-[color:var(--foreground)]">{activeRecipe.name}</span>
          </p>
        ) : (
          <p className="px-1 text-xs text-[color:var(--label-tertiary)]">先选一个模板，再开始分析</p>
        )}
        <button
          type="button"
          disabled={!canStart}
          onClick={handleStart}
          className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[color:var(--accent)] py-3.5 text-[15px] font-semibold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-35"
        >
          {loading ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              分析中…
            </>
          ) : (
            <>
              <Play className="h-5 w-5 fill-current" />
              开始分析
              <ArrowRight className="h-4 w-4 opacity-70" />
            </>
          )}
        </button>
      </div>
    </div>
  );
}
