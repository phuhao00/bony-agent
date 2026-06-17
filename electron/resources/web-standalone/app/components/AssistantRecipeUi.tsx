"use client";

import { ArrowRight, Loader2, Play, Search } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";

export type AssistantCategoryTab = {
  id: string;
  label: string;
  icon: LucideIcon;
};

export type AssistantRecipeItem = {
  id: string;
  name: string;
  category: string;
  description: string;
};

export type AssistantSuggestionItem = {
  id: string;
  title: string;
  description: string;
  reason?: string;
  recipe_id: string;
  params?: Record<string, unknown>;
};

export function AssistantSegmentedControl({
  categories,
  value,
  onChange,
}: {
  categories: AssistantCategoryTab[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex gap-1 overflow-x-auto rounded-xl bg-[var(--page-canvas)] p-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {categories.map(({ id, label, icon: Icon }) => {
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

function RecipePickCard({
  recipe,
  selected,
  onSelect,
}: {
  recipe: AssistantRecipeItem;
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
    </button>
  );
}

function SuggestionPickCard({
  suggestion,
  selected,
  onSelect,
}: {
  suggestion: AssistantSuggestionItem;
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
      {suggestion.reason ? (
        <p className="mt-1.5 text-[10px] text-[color:var(--label-tertiary)]">{suggestion.reason}</p>
      ) : null}
    </button>
  );
}

export function filterAssistantRecipes(
  recipes: AssistantRecipeItem[],
  category: string,
  query: string,
): AssistantRecipeItem[] {
  const q = query.trim().toLowerCase();
  const list = category === "recommended" ? [] : recipes.filter((r) => r.category === category);
  if (!q) return list;
  return list.filter(
    (r) =>
      r.name.toLowerCase().includes(q) ||
      r.description.toLowerCase().includes(q) ||
      r.id.toLowerCase().includes(q),
  );
}

export function AssistantRecipeActionShell({
  categories,
  category,
  onCategoryChange,
  recipes,
  suggestions,
  loading,
  onRunRecipe,
  onValidationError,
  buildParams,
  inputSection,
  showInputs = false,
  startLabel = "开始分析",
  loadingLabel = "分析中…",
  searchPlaceholder = "搜索模板",
  emptyRecommended = "暂无推荐，可切换分类开始",
  emptyFiltered = "该分类暂无模板",
  selectHint = "先选一个模板，再开始分析",
  footerNote,
  extraListContent,
}: {
  categories: AssistantCategoryTab[];
  category: string;
  onCategoryChange: (id: string) => void;
  recipes: AssistantRecipeItem[];
  suggestions: AssistantSuggestionItem[];
  loading: boolean;
  onRunRecipe: (recipeId: string, params?: Record<string, unknown>) => void;
  onValidationError?: (message: string) => void;
  buildParams: (recipeId: string) => { params?: Record<string, unknown>; error?: string };
  inputSection?: ReactNode;
  showInputs?: boolean;
  startLabel?: string;
  loadingLabel?: string;
  searchPlaceholder?: string;
  emptyRecommended?: string;
  emptyFiltered?: string;
  selectHint?: string;
  footerNote?: ReactNode;
  extraListContent?: ReactNode;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null);
  const [selectedSuggestionId, setSelectedSuggestionId] = useState<string | null>(null);

  const filtered = useMemo(
    () => filterAssistantRecipes(recipes, category, searchQuery),
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

  const activeRecipeId = selectedRecipe?.id || selectedSuggestion?.recipe_id;
  const activeRecipe =
    selectedRecipe ||
    (selectedSuggestion ? recipes.find((r) => r.id === selectedSuggestion.recipe_id) : null);

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
    const { params, error } = buildParams(selectedRecipeId);
    if (error) {
      onValidationError?.(error);
      return;
    }
    onRunRecipe(selectedRecipeId, params);
  };

  const canStart = Boolean(activeRecipeId) && !loading;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden">
      <AssistantSegmentedControl
        categories={categories}
        value={category}
        onChange={handleCategoryChange}
      />

      {category !== "recommended" ? (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--label-tertiary)]" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full rounded-full bg-[var(--page-canvas)] py-2.5 pl-10 pr-4 text-sm text-[color:var(--foreground)] outline-none placeholder:text-[color:var(--label-tertiary)] focus:ring-2 focus:ring-[color:color-mix(in_srgb,var(--accent)_35%,transparent)]"
          />
        </div>
      ) : null}

      {showInputs && inputSection ? (
        <div className="space-y-3 rounded-2xl bg-[var(--page-canvas)] p-4">{inputSection}</div>
      ) : null}

      {extraListContent}

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-0.5">
        {category === "recommended" ? (
          suggestions.length === 0 ? (
            <p className="px-2 py-8 text-center text-sm text-[color:var(--label-secondary)]">
              {emptyRecommended}
            </p>
          ) : (
            suggestions.map((s) => (
              <SuggestionPickCard
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
            {searchQuery ? "没有匹配的模板" : emptyFiltered}
          </p>
        ) : (
          filtered.map((recipe) => (
            <RecipePickCard
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
        {footerNote}
        {activeRecipe ? (
          <p className="truncate px-1 text-xs text-[color:var(--label-secondary)]">
            已选：<span className="font-medium text-[color:var(--foreground)]">{activeRecipe.name}</span>
          </p>
        ) : (
          <p className="px-1 text-xs text-[color:var(--label-tertiary)]">{selectHint}</p>
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
              {loadingLabel}
            </>
          ) : (
            <>
              <Play className="h-5 w-5 fill-current" />
              {startLabel}
              <ArrowRight className="h-4 w-4 opacity-70" />
            </>
          )}
        </button>
      </div>
    </div>
  );
}
