"use client";

import { CheckCircle2, ChevronDown, Globe, Loader2, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import type { ProductManagerTask } from "../hooks/useProductManagerRunner";
import {
  extractExecution,
  extractRecipeSteps,
  type PmExecutionLog,
} from "../lib/executionTypes";

const PHASE_HUMAN: Record<string, string> = {
  skill: "方法论",
  recipe: "工作流",
  collect: "资料收集",
  search: "联网检索",
  llm: "撰写报告",
};

function humanSummary(
  execution: NonNullable<ReturnType<typeof extractExecution>>,
  recipeName?: string,
): string {
  const parts: string[] = [];
  if (recipeName) parts.push(recipeName);
  else if (execution.recipe_id) parts.push(execution.recipe_id);
  if (execution.skill_id) parts.push(`「${execution.skill_id}」方法论`);
  const n = execution.search_queries?.length || 0;
  if (n > 0) parts.push(`参考 ${n} 条网络资料`);
  if (execution.duration_ms != null) parts.push(`${(execution.duration_ms / 1000).toFixed(0)} 秒`);
  return parts.join(" · ") || "分析完成";
}

function FriendlyLog({ entry }: { entry: PmExecutionLog }) {
  const phase = PHASE_HUMAN[entry.phase || ""] || entry.phase || "步骤";
  return (
    <li className="flex gap-3 py-2.5">
      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--accent)]" />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium text-[color:var(--label-tertiary)]">{phase}</p>
        <p className="mt-0.5 text-sm text-[color:var(--foreground)]">{entry.message}</p>
      </div>
    </li>
  );
}

export function ProductManagerActivitySheet({
  task,
  lastResult,
  loading,
  recipeName,
}: {
  task: ProductManagerTask | null;
  lastResult: unknown;
  loading: boolean;
  recipeName?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const execution = useMemo(
    () => extractExecution(task, lastResult),
    [task, lastResult],
  );
  const steps = useMemo(() => extractRecipeSteps(task), [task]);
  const logs = execution?.logs || [];

  if (!execution && !loading) return null;

  const summary = execution ? humanSummary(execution, recipeName) : "正在准备分析…";
  const modelLine =
    execution?.model && execution?.provider
      ? `${execution.provider} · ${execution.model}`
      : execution?.model || null;

  return (
    <div className="mb-4">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="group flex w-full items-start gap-3 rounded-2xl bg-[var(--page-canvas)] px-4 py-3.5 text-left transition hover:bg-[var(--nav-active-fill)]/50"
      >
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--card-surface)] shadow-sm">
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin text-[color:var(--accent)]" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-[color:var(--status-success-text)]" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-[color:var(--foreground)]">
            {loading ? "正在为你撰写…" : "这份报告是怎么来的"}
          </span>
          <span className="mt-0.5 block text-xs leading-relaxed text-[color:var(--label-secondary)]">
            {summary}
          </span>
          {modelLine && !loading ? (
            <span className="mt-1 block text-[11px] text-[color:var(--label-tertiary)]">{modelLine}</span>
          ) : null}
        </span>
        <ChevronDown
          className={`mt-1 h-4 w-4 shrink-0 text-[color:var(--label-tertiary)] transition group-hover:text-[color:var(--foreground)] ${expanded ? "rotate-180" : ""}`}
        />
      </button>

      {expanded ? (
        <div className="mt-1 overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--card-surface)]">
          {execution?.skill_loaded ? (
            <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-4 py-3 text-xs text-[color:var(--label-secondary)]">
              <Sparkles className="h-3.5 w-3.5 text-[color:var(--accent)]" />
              已按 PM Skill 规范生成
              {execution.has_template ? " · 含输出模板" : ""}
              {execution.has_example ? " · 含示例参考" : ""}
            </div>
          ) : null}

          {steps.length ? (
            <ul className="divide-y divide-[var(--border-subtle)] px-4">
              {steps.map((step) => (
                <li key={`${step.id}-${step.kind}`} className="flex items-center justify-between py-3 text-sm">
                  <span className="text-[color:var(--foreground)]">{step.id || step.kind}</span>
                  <span className="text-xs text-[color:var(--label-tertiary)]">
                    {step.status === "completed" ? "完成" : step.status === "running" ? "进行中" : "等待"}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          {execution?.search_queries?.length ? (
            <div className="border-t border-[var(--border-subtle)] px-4 py-3">
              <p className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-[color:var(--label-tertiary)]">
                <Globe className="h-3.5 w-3.5" />
                参考检索
              </p>
              <ul className="space-y-1.5">
                {execution.search_queries.map((q) => (
                  <li
                    key={q}
                    className="rounded-lg bg-[var(--page-canvas)] px-3 py-2 text-xs text-[color:var(--label-secondary)]"
                  >
                    {q}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {logs.length ? (
            <ul className="max-h-56 divide-y divide-[var(--border-subtle)] overflow-y-auto border-t border-[var(--border-subtle)] px-4">
              {logs.map((entry, idx) => (
                <FriendlyLog key={`${entry.phase}-${idx}`} entry={entry} />
              ))}
            </ul>
          ) : loading ? (
            <p className="border-t border-[var(--border-subtle)] px-4 py-3 text-xs text-[color:var(--label-secondary)]">
              加载方法论、检索资料、调用模型中…
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
