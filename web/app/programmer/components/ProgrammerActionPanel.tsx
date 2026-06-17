"use client";

import { Database, GitBranch, Server, Sparkles, TestTube } from "lucide-react";
import {
  AssistantRecipeActionShell,
  type AssistantCategoryTab,
} from "@/app/components/AssistantRecipeUi";
import type { ProgrammerSuggestion } from "../hooks/useProgrammerRunner";

const CATEGORIES: AssistantCategoryTab[] = [
  { id: "recommended", label: "推荐", icon: Sparkles },
  { id: "git", label: "Git/SSH", icon: GitBranch },
  { id: "infra", label: "中间件", icon: Server },
  { id: "dev", label: "开发", icon: TestTube },
];

type Recipe = {
  id: string;
  name: string;
  category: string;
  description: string;
  requires_approval?: boolean;
};

export function ProgrammerActionPanel({
  category,
  onCategoryChange,
  recipes,
  suggestions,
  components,
  selectedComponent,
  onSelectComponent,
  loading,
  onRunRecipe,
}: {
  category: string;
  onCategoryChange: (id: string) => void;
  recipes: Recipe[];
  suggestions: ProgrammerSuggestion[];
  components: Array<{ id: string; name: string; default_port: number }>;
  selectedComponent: string;
  onSelectComponent: (id: string) => void;
  loading: boolean;
  onRunRecipe: (recipeId: string, params?: Record<string, unknown>) => void;
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
      buildParams={(recipeId) => ({
        params:
          category === "infra" && recipeId !== "infra.scan_all"
            ? { component_id: selectedComponent || "redis" }
            : {},
      })}
      startLabel="开始执行"
      loadingLabel="执行中…"
      searchPlaceholder="搜索运维模板"
      emptyRecommended="暂无推荐，可先扫描环境或切换分类"
      extraListContent={
        category === "infra" ? (
          <div className="rounded-2xl bg-[var(--page-canvas)] p-4">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-[color:var(--label-secondary)]">
              <Database className="h-3.5 w-3.5" />
              目标组件
            </div>
            <select
              value={selectedComponent}
              onChange={(e) => onSelectComponent(e.target.value)}
              className="w-full rounded-xl bg-[var(--card-surface)] px-3 py-2.5 text-sm outline-none ring-1 ring-[var(--border-subtle)] focus:ring-[color:var(--accent)]"
            >
              {components.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} (:{c.default_port})
                </option>
              ))}
            </select>
          </div>
        ) : null
      }
    />
  );
}
