"use client";

import {
  Image,
  Map,
  Palette,
  Search,
  Sparkles,
  User,
} from "lucide-react";
import {
  AssistantRecipeActionShell,
  type AssistantCategoryTab,
} from "@/app/components/AssistantRecipeUi";
import type { GameArtSuggestion } from "../hooks/useGameArtRunner";
import { buildRecipeParams, showSubjectInput } from "../lib/recipeActions";

const CATEGORIES: AssistantCategoryTab[] = [
  { id: "recommended", label: "推荐", icon: Sparkles },
  { id: "style", label: "视觉风格", icon: Palette },
  { id: "character", label: "角色", icon: User },
  { id: "scene", label: "场景", icon: Map },
  { id: "ui", label: "UI", icon: Image },
  { id: "research", label: "竞品视觉", icon: Search },
];

type Recipe = {
  id: string;
  name: string;
  category: string;
  description: string;
};

export function GameArtActionPanel({
  category,
  onCategoryChange,
  recipes,
  suggestions,
  loading,
  onRunRecipe,
  projectInput,
  onProjectInputChange,
  subjectInput,
  onSubjectInputChange,
  onValidationError,
}: {
  category: string;
  onCategoryChange: (id: string) => void;
  recipes: Recipe[];
  suggestions: GameArtSuggestion[];
  loading: boolean;
  onRunRecipe: (recipeId: string, params?: Record<string, unknown>) => void;
  projectInput: string;
  onProjectInputChange: (v: string) => void;
  subjectInput: string;
  onSubjectInputChange: (v: string) => void;
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
      buildParams={(recipeId) => buildRecipeParams(recipeId, { projectInput, subjectInput })}
      showInputs={category !== "recommended"}
      startLabel="开始美术分析"
      searchPlaceholder="搜索美术模板"
      inputSection={
        <>
          <p className="text-xs font-medium text-[color:var(--label-tertiary)]">项目 Brief</p>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[color:var(--label-secondary)]">
              游戏项目
            </label>
            <input
              type="text"
              value={projectInput}
              onChange={(e) => onProjectInputChange(e.target.value)}
              placeholder="例如：二次元 RPG、休闲益智手游"
              className="w-full rounded-xl bg-[var(--card-surface)] px-3.5 py-2.5 text-sm text-[color:var(--foreground)] outline-none ring-1 ring-[var(--border-subtle)] focus:ring-[color:var(--accent)]"
            />
          </div>
          {showSubjectInput(category) ? (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[color:var(--label-secondary)]">
                {category === "character" ? "角色名/定位" : "场景名称"}
              </label>
              <input
                type="text"
                value={subjectInput}
                onChange={(e) => onSubjectInputChange(e.target.value)}
                placeholder={
                  category === "character" ? "例如：主角、反派 Boss" : "例如：冰雪主城"
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
