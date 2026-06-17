"use client";

import { FileText, Loader2, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useMemo } from "react";
import type { AssistantRecipeTask } from "@/app/hooks/useAssistantRecipeRunner";
import { AssistantMarkdownPreview } from "@/app/components/AssistantMarkdownPreview";
import { extractReportFromResult } from "@/app/components/assistantTextParsing";

export type AssistantRecipeResultLabels = {
  emptyTitle?: string;
  emptyDescription?: string;
  runningTitle?: string;
  runningMessage?: string;
  streamSection?: string;
  completedHint?: string;
  defaultDocumentTitle?: string;
};

function extractError(task: AssistantRecipeTask | null, lastResult: unknown): string {
  const fromTask =
    (typeof task?.result?.error === "string" ? task.result.error : "") ||
    (task?.status === "failed" ? task.message : "");
  if (fromTask) return fromTask;
  const fromLast =
    (lastResult as { error?: string; result?: { error?: string } })?.error ||
    (lastResult as { result?: { error?: string } })?.result?.error;
  return typeof fromLast === "string" ? fromLast : "";
}

function EmptyDocumentState({
  icon: Icon,
  title,
  description,
  footer,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  footer?: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 py-16 text-center">
      <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-[28px] bg-gradient-to-b from-[var(--nav-active-fill)] to-[var(--page-canvas)]">
        <Icon className="h-9 w-9 text-[color:var(--label-tertiary)]" strokeWidth={1.25} />
      </div>
      <h2 className="text-2xl font-semibold tracking-tight text-[color:var(--foreground)]">{title}</h2>
      <p className="mt-3 max-w-md text-[15px] leading-relaxed text-[color:var(--label-secondary)]">
        {description}
      </p>
      {footer ? <div className="mt-4 max-w-sm text-xs leading-relaxed text-[color:var(--label-tertiary)]">{footer}</div> : null}
    </div>
  );
}

function RunningHero({ title, message }: { title: string; message?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 py-16 text-center">
      <div className="relative mb-8 flex h-16 w-16 items-center justify-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-[color:color-mix(in_srgb,var(--accent)_20%,transparent)]" />
        <span className="relative flex h-16 w-16 items-center justify-center rounded-full bg-[var(--nav-active-fill)]">
          <Loader2 className="h-7 w-7 animate-spin text-[color:var(--accent)]" />
        </span>
      </div>
      <h2 className="text-xl font-semibold tracking-tight text-[color:var(--foreground)]">{title}</h2>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-[color:var(--label-secondary)]">
        {message || "正在整理结构化输出，请稍候…"}
      </p>
    </div>
  );
}

export function AssistantRecipeResultPanel({
  task,
  streamText,
  lastResult,
  loading,
  labels,
  icon: Icon = FileText,
  recipes = [],
  headerExtra,
  emptyFooter,
  beforeReport,
}: {
  task: AssistantRecipeTask | null;
  streamText: string;
  lastResult: unknown;
  loading: boolean;
  labels?: AssistantRecipeResultLabels;
  icon?: LucideIcon;
  recipes?: { id: string; name: string }[];
  headerExtra?: ReactNode;
  emptyFooter?: ReactNode;
  beforeReport?: ReactNode;
}) {
  const report = extractReportFromResult(task, lastResult);
  const taskError = extractError(task, lastResult);
  const isRunning = loading && task?.status === "running" && !report;
  const hasContent = Boolean(report || streamText || taskError || isRunning);

  const recipeName = useMemo(() => {
    const recipeId =
      typeof task?.metadata?.recipe_id === "string" ? task.metadata.recipe_id : undefined;
    return recipes.find((r) => r.id === recipeId)?.name;
  }, [task, recipes]);

  const documentTitle = useMemo(() => {
    if (report) return recipeName || labels?.defaultDocumentTitle || "分析报告";
    if (streamText) return "对话记录";
    return labels?.defaultDocumentTitle || "分析结果";
  }, [report, streamText, recipeName, labels?.defaultDocumentTitle]);

  const emptyTitle = labels?.emptyTitle ?? "你的下一份分析报告";
  const emptyDescription =
    labels?.emptyDescription ??
    "在左侧选一个模板，填好背景，点「开始分析」。报告会固定显示在这里，对话栏始终在底部。";

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[28px] bg-[var(--card-surface)] shadow-sm ring-1 ring-[var(--border-subtle)]">
      {!hasContent ? (
        <EmptyDocumentState
          icon={Icon}
          title={emptyTitle}
          description={emptyDescription}
          footer={emptyFooter}
        />
      ) : isRunning ? (
        <RunningHero
          title={labels?.runningTitle ?? "正在撰写中"}
          message={task?.message || labels?.runningMessage}
        />
      ) : (
        <>
          <header className="shrink-0 border-b border-[var(--border-subtle)] px-5 py-4 sm:px-8 sm:py-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                {recipeName ? (
                  <p className="mb-1 truncate text-xs font-medium text-[color:var(--accent)]">
                    {recipeName}
                  </p>
                ) : null}
                <h1 className="text-xl font-semibold leading-snug tracking-tight text-[color:var(--foreground)] sm:text-2xl">
                  {documentTitle}
                </h1>
                {task?.status === "completed" && report ? (
                  <p className="mt-1.5 text-sm text-[color:var(--label-secondary)]">
                    {labels?.completedHint ?? "可直接复制内容，或在底部继续追问"}
                  </p>
                ) : task?.message ? (
                  <p className="mt-1.5 text-sm text-[color:var(--label-secondary)]">{task.message}</p>
                ) : null}
              </div>
              {headerExtra}
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-6 sm:px-8 sm:py-8">
            {taskError && !report ? (
              <div className="mb-6 rounded-2xl bg-red-500/8 px-4 py-3.5 text-sm text-red-600 dark:text-red-400">
                {taskError}
              </div>
            ) : null}

            {beforeReport}

            {report ? (
              <article className="assistant-markdown-preview max-w-none text-[15px] leading-[1.8] text-[color:var(--foreground)] [&_h1]:mt-8 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:mt-6 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mt-4 [&_h3]:text-base [&_h3]:font-medium [&_li]:my-1 [&_p]:my-3 [&_ul]:my-3">
                <AssistantMarkdownPreview markdown={report} loading={loading} />
              </article>
            ) : null}

            {streamText ? (
              <section className={report ? "mt-10 border-t border-[var(--border-subtle)] pt-8" : ""}>
                {report ? (
                  <div className="mb-4 flex items-center gap-2 text-sm font-medium text-[color:var(--foreground)]">
                    <Sparkles className="h-4 w-4 text-[color:var(--accent)]" />
                    {labels?.streamSection ?? "后续讨论"}
                  </div>
                ) : null}
                <AssistantMarkdownPreview markdown={streamText} loading={loading} />
              </section>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
