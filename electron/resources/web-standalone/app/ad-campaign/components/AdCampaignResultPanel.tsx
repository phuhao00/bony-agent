"use client";

import { Megaphone } from "lucide-react";
import { useMemo } from "react";
import { AssistantMarkdownPreview } from "@/app/components/AssistantMarkdownPreview";
import { AssistantRecipeResultPanel } from "@/app/components/AssistantRecipeResultPanel";
import {
  extractCreativeVariants,
  extractReportFromResult,
} from "@/app/components/assistantTextParsing";
import type { AdCampaignTask } from "../hooks/useAdCampaignRunner";

export function AdCampaignResultPanel({
  task,
  streamText,
  lastResult,
  loading,
  channels,
  budgetLabel,
  recipes = [],
}: {
  task: AdCampaignTask | null;
  streamText: string;
  lastResult: unknown;
  loading: boolean;
  channels?: string[];
  budgetLabel?: string;
  recipes?: { id: string; name: string }[];
}) {
  const report = extractReportFromResult(task, lastResult);
  const combined = report || streamText;
  const variants = combined ? extractCreativeVariants(combined) : [];

  const headerExtra = useMemo(() => {
    if (!channels?.length && !budgetLabel) return null;
    return (
      <div className="flex flex-wrap justify-end gap-1.5">
        {budgetLabel ? (
          <span className="rounded-full bg-[var(--nav-active-fill)] px-3 py-1 text-xs font-medium text-[color:var(--foreground)]">
            预算 {budgetLabel}
          </span>
        ) : null}
        {channels?.map((c) => (
          <span
            key={c}
            className="rounded-full bg-[var(--page-canvas)] px-3 py-1 text-xs text-[color:var(--label-secondary)]"
          >
            {c}
          </span>
        ))}
      </div>
    );
  }, [channels, budgetLabel]);

  const variantSection =
    variants.length > 1 ? (
      <section className="mb-8">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-[color:var(--foreground)]">
          <Megaphone className="h-4 w-4 text-[color:var(--accent)]" />
          创意变体
        </div>
        <div className="-mx-1 flex gap-3 overflow-x-auto pb-2 px-1 snap-x snap-mandatory">
          {variants.map((variant, i) => (
            <div
              key={i}
              className="card-surface snap-start w-[min(100%,280px)] shrink-0 rounded-2xl bg-[var(--page-canvas)] p-4 ring-1 ring-[var(--border-subtle)]"
            >
              <span className="mb-2 inline-block rounded-md bg-[var(--nav-active-fill)] px-2 py-0.5 text-[10px] font-semibold text-[color:var(--accent)]">
                变体 {i + 1}
              </span>
              <div className="max-h-[200px] overflow-y-auto text-sm text-[color:var(--foreground)]">
                <AssistantMarkdownPreview markdown={variant} loading={false} />
              </div>
            </div>
          ))}
        </div>
      </section>
    ) : null;

  return (
    <AssistantRecipeResultPanel
      task={task}
      streamText={streamText}
      lastResult={lastResult}
      loading={loading}
      icon={Megaphone}
      recipes={recipes}
      headerExtra={headerExtra}
      beforeReport={variantSection}
      labels={{
        emptyTitle: "投放战役输出",
        emptyDescription:
          "在上方配置预算与渠道，左侧选择投放模板并点「开始投放分析」。创意变体与完整报告会显示在这里。",
        runningTitle: "正在生成投放方案",
        runningMessage: "我在组合渠道策略、受众定向与创意方向。",
        defaultDocumentTitle: "投放分析报告",
      }}
    />
  );
}
