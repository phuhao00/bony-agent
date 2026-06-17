"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  Scale,
  Sparkles,
} from "lucide-react";
import { useMemo } from "react";
import { AssistantMarkdownPreview } from "@/app/components/AssistantMarkdownPreview";
import {
  extractReportFromResult,
  inferRiskLevel,
  type RiskLevel,
} from "@/app/components/assistantTextParsing";
import type { LegalAdvisorTask } from "../hooks/useLegalAdvisorRunner";

const RISK_META: Record<
  RiskLevel,
  { label: string; pill: string; Icon: typeof AlertTriangle }
> = {
  high: {
    label: "高风险",
    pill: "bg-red-500/12 text-red-700 dark:text-red-400",
    Icon: AlertTriangle,
  },
  medium: {
    label: "中等风险",
    pill: "bg-amber-500/12 text-amber-800 dark:text-amber-400",
    Icon: AlertTriangle,
  },
  low: {
    label: "低风险",
    pill: "bg-emerald-500/12 text-emerald-800 dark:text-emerald-400",
    Icon: CheckCircle2,
  },
  unknown: {
    label: "待评估",
    pill: "bg-[var(--nav-active-fill)] text-[color:var(--label-secondary)]",
    Icon: Clock,
  },
};

function RiskPill({ level, loading }: { level: RiskLevel; loading: boolean }) {
  const meta = RISK_META[level];
  const Icon = meta.Icon;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${meta.pill}`}
    >
      {loading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Icon className="h-3.5 w-3.5" strokeWidth={2} />
      )}
      {meta.label}
    </span>
  );
}

function EmptyDocumentState() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 py-16 text-center">
      <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-[28px] bg-gradient-to-b from-[var(--nav-active-fill)] to-[var(--page-canvas)]">
        <Scale className="h-9 w-9 text-[color:var(--label-tertiary)]" strokeWidth={1.25} />
      </div>
      <h2 className="text-2xl font-semibold tracking-tight text-[color:var(--foreground)]">
        法律解读与风险提示
      </h2>
      <p className="mt-3 max-w-md text-[15px] leading-relaxed text-[color:var(--label-secondary)]">
        在左侧选择审阅类型，录入案情或条款原文，点「开始审阅」。解读会固定显示在这里，对话栏始终在底部。
      </p>
      <p className="mt-4 max-w-sm text-xs leading-relaxed text-[color:var(--label-tertiary)]">
        本助手仅供参考，不构成正式法律意见。重大事项请咨询持证律师。
      </p>
    </div>
  );
}

function RunningHero({ message }: { message?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 py-16 text-center">
      <div className="relative mb-8 flex h-16 w-16 items-center justify-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-[color:color-mix(in_srgb,var(--accent)_20%,transparent)]" />
        <span className="relative flex h-16 w-16 items-center justify-center rounded-full bg-[var(--nav-active-fill)]">
          <Loader2 className="h-7 w-7 animate-spin text-[color:var(--accent)]" />
        </span>
      </div>
      <h2 className="text-xl font-semibold tracking-tight text-[color:var(--foreground)]">
        正在审阅中
      </h2>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-[color:var(--label-secondary)]">
        {message || "我在对照法规与案例，整理解读要点与风险提示。"}
      </p>
    </div>
  );
}

function extractError(task: LegalAdvisorTask | null, lastResult: unknown): string {
  const fromTask =
    (typeof task?.result?.error === "string" ? task.result.error : "") ||
    (task?.status === "failed" ? task.message : "");
  if (fromTask) return fromTask;
  return (lastResult as { error?: string })?.error || "";
}

export function LegalAdvisorResultPanel({
  task,
  streamText,
  lastResult,
  loading,
  recipes = [],
}: {
  task: LegalAdvisorTask | null;
  streamText: string;
  lastResult: unknown;
  loading: boolean;
  recipes?: { id: string; name: string }[];
}) {
  const report = extractReportFromResult(task, lastResult);
  const combined = report || streamText;
  const riskLevel = combined ? inferRiskLevel(combined) : "unknown";
  const taskError = extractError(task, lastResult);
  const isRunning = loading && task?.status === "running" && !report;
  const hasContent = Boolean(report || streamText || taskError || isRunning);

  const recipeName = useMemo(() => {
    const recipeId =
      typeof task?.metadata?.recipe_id === "string" ? task.metadata.recipe_id : undefined;
    return recipes.find((r) => r.id === recipeId)?.name;
  }, [task, recipes]);

  const documentTitle = useMemo(() => {
    if (report) return recipeName || "法律分析报告";
    if (streamText) return "对话解读";
    return "法律审阅";
  }, [report, streamText, recipeName]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[28px] bg-[var(--card-surface)] shadow-sm ring-1 ring-[var(--border-subtle)]">
      {!hasContent ? (
        <EmptyDocumentState />
      ) : isRunning ? (
        <RunningHero message={task?.message} />
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
                    可在底部继续追问，或复制解读内容
                  </p>
                ) : task?.message ? (
                  <p className="mt-1.5 text-sm text-[color:var(--label-secondary)]">{task.message}</p>
                ) : null}
              </div>
              <RiskPill level={riskLevel} loading={loading && !combined} />
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-6 sm:px-8 sm:py-8">
            {taskError && !report ? (
              <div className="mb-6 rounded-2xl bg-red-500/8 px-4 py-3.5 text-sm text-red-600 dark:text-red-400">
                {taskError}
              </div>
            ) : null}

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
                    后续讨论
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
