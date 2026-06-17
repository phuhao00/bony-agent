"use client";

import { Loader2, Sparkles, Zap } from "lucide-react";
import type { EnvironmentProfile, SystemSuggestion } from "../hooks/useSystemAssistantRunner";
import { SYSTEM_PRESETS } from "../lib/presets";

export function SystemAssistantRecommendedPanel({
  environment,
  suggestions,
  loading,
  initLoading,
  onRunSuggestion,
  onRunPreset,
}: {
  environment: EnvironmentProfile | null;
  suggestions: SystemSuggestion[];
  loading: boolean;
  initLoading: boolean;
  onRunSuggestion: (recipeId: string, params?: Record<string, unknown>) => void;
  onRunPreset: (recipeId: string, params?: Record<string, unknown>, category?: string) => void;
}) {
  const downloadsPath = environment?.default_paths?.downloads_path || environment?.ui_labels?.downloads_path;

  if (initLoading) {
    return (
      <div className="flex min-h-[200px] items-center justify-center rounded-2xl border border-[var(--border-subtle)] bg-[var(--card-bg)]">
        <div className="flex items-center gap-2 text-sm text-[color:var(--label-secondary)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在检测环境…
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--card-bg)] p-5">
        <div className="mb-4 flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[color:color-mix(in_srgb,var(--accent)_14%,transparent)] text-[color:var(--accent)]">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-[color:var(--foreground)]">智能推荐</h2>
            <p className="mt-0.5 text-xs text-[color:var(--label-secondary)]">
              基于当前后端环境诊断结果，为你推荐下一步操作
            </p>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          {SYSTEM_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              disabled={loading}
              onClick={() => {
                const params = { ...preset.params };
                if (preset.recipe_id === "organize.preview" && downloadsPath) {
                  params.root_path = downloadsPath;
                }
                onRunPreset(preset.recipe_id, params, preset.category);
              }}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--nav-active-fill)]/40 px-3 py-1.5 text-xs font-medium text-[color:var(--foreground)] hover:border-[color:color-mix(in_srgb,var(--accent)_35%,transparent)] disabled:opacity-50"
            >
              <Zap className="h-3 w-3 text-[color:var(--accent)]" />
              {preset.label}
            </button>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {suggestions.slice(0, 8).map((s) => (
            <div
              key={s.id}
              className="flex flex-col justify-between rounded-xl border border-[var(--border-subtle)] bg-[var(--nav-active-fill)]/30 p-4"
            >
              <div>
                <div className="font-medium text-[color:var(--foreground)]">{s.title}</div>
                <p className="mt-1 text-xs leading-relaxed text-[color:var(--label-secondary)]">
                  {s.description}
                </p>
                <p className="mt-2 text-[10px] text-[color:var(--label-secondary)]">原因：{s.reason}</p>
              </div>
              <button
                type="button"
                disabled={loading}
                onClick={() => onRunSuggestion(s.recipe_id, s.params)}
                className="mt-3 w-full rounded-lg bg-[var(--card-bg)] py-2 text-sm font-medium text-[color:var(--foreground)] ring-1 ring-[var(--border-subtle)] hover:bg-[var(--nav-active-fill)] disabled:opacity-50"
              >
                执行
              </button>
            </div>
          ))}
          {suggestions.length === 0 && (
            <p className="col-span-full text-sm text-[color:var(--label-secondary)]">
              暂无推荐，环境状态良好或请稍后重试诊断
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
