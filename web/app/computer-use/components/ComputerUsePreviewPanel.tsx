"use client";

import { MarkdownSummaryPreview } from "@/components/MarkdownSummaryPreview";
import {
  BookOpen,
  Camera,
  ExternalLink,
  Globe,
  ListTree,
  Monitor,
  Search,
  Sparkles,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { ComputerUseResult } from "../lib/types";
import { ComputerUseApprovalCard } from "./ComputerUseApprovalCard";
import { ComputerUseTimeline } from "./ComputerUseTimeline";
import { ZoomableScreenshot } from "./ZoomableScreenshot";

type PreviewTab = "report" | "results" | "timeline";

const IDLE_TIPS = [
  "用自然语言描述目标，系统会自动选择搜索引擎或站点起点",
  "右侧将展示浏览器最终截图，支持缩放与平移查看细节",
  "任务结束后可生成 AutoResearch 报告，提炼页面要点与结论",
];

export function ComputerUsePreviewPanel({
  loading,
  result,
  onApprove,
  onDeny,
}: {
  loading: boolean;
  result: ComputerUseResult | null;
  onApprove: () => Promise<void>;
  onDeny: () => Promise<void>;
}) {
  const [tab, setTab] = useState<PreviewTab>("report");

  const searchResults = result?.search_results ?? [];
  const hasSearchResults = searchResults.length > 0;
  const hasReportContent =
    result?.success &&
    (result.autoresearch_markdown !== undefined ||
      result.autoresearch_error ||
      result.autoresearch_skipped);
  const hasTimelineContent = Boolean(result?.rounds?.length);

  useEffect(() => {
    if (hasSearchResults) setTab("results");
    else if (hasReportContent) setTab("report");
    else if (hasTimelineContent) setTab("timeline");
  }, [
    result?.task_id,
    result?.status,
    hasSearchResults,
    hasReportContent,
    hasTimelineContent,
  ]);

  const waitingApproval =
    result?.status === "waiting_approval" && result.requires_approval;
  const livePreview =
    result?.preview_screenshot_base64 || result?.computer_use?.preview_screenshot_base64;
  const hasScreenshot = Boolean(livePreview || result?.final_screenshot_base64);
  const screenshotSrc = livePreview || result?.final_screenshot_base64;
  const hasReport =
    result?.success &&
    (result.autoresearch_markdown !== undefined ||
      result.autoresearch_error ||
      result.autoresearch_skipped);
  const hasTimeline = Boolean(result?.rounds?.length);
  const showResults = result && !loading;

  return (
    <section className="card-surface flex min-h-[480px] flex-col overflow-hidden rounded-2xl lg:sticky lg:top-6 lg:min-h-[calc(100vh-12rem)]">
      <div className="flex items-center gap-2 border-b border-[color:var(--separator-subtle)] px-4 py-3 sm:px-5">
        <Monitor className="h-4 w-4 text-[color:var(--accent)]" />
        <h2 className="text-sm font-semibold text-[color:var(--foreground)]">
          预览与结果
        </h2>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {loading && (
          <div className="flex flex-1 flex-col gap-4 p-5">
            {livePreview ? (
              <div className="bg-[#1a1a1e] p-3 sm:p-4">
                <p className="mb-2 text-xs text-[color:var(--label-secondary)]">
                  实时视口
                  {result?.computer_use?.last_plan
                    ? ` · ${result.computer_use.last_plan}`
                    : ""}
                </p>
                <ZoomableScreenshot
                  src={`data:image/png;base64,${livePreview}`}
                  alt="实时截图"
                />
              </div>
            ) : (
              <div className="space-y-3">
                <div className="h-4 w-1/3 animate-pulse rounded-lg bg-[var(--chrome-rail-bg)]" />
                <div className="aspect-[16/10] w-full animate-pulse rounded-2xl bg-[var(--chrome-rail-bg)]" />
              </div>
            )}
            <p className="text-center text-xs text-[color:var(--label-secondary)]">
              每 2 秒同步任务进度与截图…
            </p>
          </div>
        )}

        {!loading && !showResults && (
          <div className="flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--nav-active-fill)] text-[color:var(--accent)]">
              <Globe className="h-8 w-8" />
            </div>
            <div className="max-w-md space-y-2">
              <p className="text-base font-medium text-[color:var(--foreground)]">
                浏览器自动化工作台
              </p>
              <p className="text-sm text-[color:var(--label-secondary)]">
                在左侧输入任务并运行，最终截图与研究报告将显示在此区域。
              </p>
            </div>
            <ul className="max-w-sm space-y-2 text-left text-xs text-[color:var(--label-secondary)]">
              {IDLE_TIPS.map((tip) => (
                <li key={tip} className="flex items-start gap-2">
                  <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[color:var(--accent)]" />
                  {tip}
                </li>
              ))}
            </ul>
          </div>
        )}

        {showResults && (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {waitingApproval && (
              <div className="shrink-0 border-b border-[color:var(--separator-subtle)] p-4">
                <ComputerUseApprovalCard
                  result={result}
                  onApproved={onApprove}
                  onDenied={onDeny}
                />
              </div>
            )}

            {result.success === false && result.error && !waitingApproval && (
              <div className="shrink-0 border-b border-[color:var(--separator-subtle)] p-4">
                <div className="rounded-2xl border border-red-500/35 bg-red-500/10 px-4 py-3 text-sm text-red-600">
                  {result.error}
                </div>
              </div>
            )}

            {hasScreenshot && (
              <div className="shrink-0 border-b border-[color:var(--separator-subtle)]">
                <div className="flex items-center gap-2 bg-[var(--chrome-rail-bg)] px-4 py-2.5">
                  <Camera className="h-4 w-4 text-[color:var(--accent)]" />
                  <span className="text-sm font-semibold text-[color:var(--foreground)]">
                    {result.status === "completed" ? "最终画面" : "画面预览"}
                  </span>
                  {result.final_page_context?.title && (
                    <span className="truncate text-xs text-[color:var(--label-secondary)]">
                      · {result.final_page_context.title}
                    </span>
                  )}
                </div>
                <div className="bg-[#1a1a1e] p-3 sm:p-4">
                  <ZoomableScreenshot
                    src={`data:image/png;base64,${screenshotSrc}`}
                    alt="浏览器截图"
                  />
                </div>
              </div>
            )}

            {(hasSearchResults || hasReport || hasTimeline) && (
              <>
                <div className="flex shrink-0 gap-1 border-b border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] px-4 py-2">
                  {hasSearchResults && (
                    <button
                      type="button"
                      onClick={() => setTab("results")}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                        tab === "results"
                          ? "bg-[var(--card-bg)] text-[color:var(--foreground)] shadow-sm"
                          : "text-[color:var(--label-secondary)] hover:text-[color:var(--foreground)]"
                      }`}
                    >
                      <Search className="h-3.5 w-3.5" />
                      搜索结果
                      <span className="text-[10px] opacity-70">
                        ({searchResults.length})
                      </span>
                    </button>
                  )}
                  {hasReport && (
                    <button
                      type="button"
                      onClick={() => setTab("report")}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                        tab === "report"
                          ? "bg-[var(--card-bg)] text-[color:var(--foreground)] shadow-sm"
                          : "text-[color:var(--label-secondary)] hover:text-[color:var(--foreground)]"
                      }`}
                    >
                      <BookOpen className="h-3.5 w-3.5" />
                      报告
                    </button>
                  )}
                  {hasTimeline && (
                    <button
                      type="button"
                      onClick={() => setTab("timeline")}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                        tab === "timeline"
                          ? "bg-[var(--card-bg)] text-[color:var(--foreground)] shadow-sm"
                          : "text-[color:var(--label-secondary)] hover:text-[color:var(--foreground)]"
                      }`}
                    >
                      <ListTree className="h-3.5 w-3.5" />
                      过程
                    </button>
                  )}
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto p-4">
                  {tab === "results" && hasSearchResults && (
                    <ul className="space-y-3">
                      {searchResults.map((item, idx) => (
                        <li
                          key={`${item.url ?? item.title ?? idx}-${idx}`}
                          className="rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] px-4 py-3"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-medium text-[color:var(--foreground)]">
                              {item.title || `结果 ${idx + 1}`}
                            </p>
                            {item.url ? (
                              <a
                                href={item.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="shrink-0 text-[color:var(--accent)] hover:opacity-80"
                                title="打开链接"
                              >
                                <ExternalLink className="h-4 w-4" />
                              </a>
                            ) : null}
                          </div>
                          {item.snippet ? (
                            <p className="mt-1.5 text-xs leading-relaxed text-[color:var(--label-secondary)]">
                              {item.snippet}
                            </p>
                          ) : null}
                          {item.url ? (
                            <p className="mt-1 truncate font-mono text-[10px] text-[color:var(--label-secondary)]">
                              {item.url}
                            </p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}

                  {tab === "report" && hasReport && (
                    <div>
                      {result.autoresearch_error && (
                        <p className="mb-3 rounded-xl border border-amber-500/30 bg-[color-mix(in_srgb,#f59e0b_12%,transparent)] px-3 py-2 text-sm text-[color:var(--foreground)]">
                          {result.autoresearch_error}
                        </p>
                      )}
                      {result.autoresearch_skipped ? (
                        <p className="text-sm text-[color:var(--label-secondary)]">
                          本次已关闭自动生成研究报告。
                        </p>
                      ) : result.autoresearch_markdown ? (
                        <MarkdownSummaryPreview
                          markdown={result.autoresearch_markdown}
                        />
                      ) : (
                        <p className="text-sm text-[color:var(--label-secondary)]">
                          未生成报告正文（可检查 LLM 配置或重试）。
                        </p>
                      )}
                      {result.final_page_context?.text_excerpt_preview ? (
                        <details className="mt-4 rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] px-3 py-2">
                          <summary className="cursor-pointer text-xs text-[color:var(--label-secondary)] hover:text-[color:var(--foreground)]">
                            分析所依据的正文摘录（预览）
                          </summary>
                          <pre className="mt-2 max-h-52 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-[color:var(--label-secondary)]">
                            {result.final_page_context.text_excerpt_preview}
                          </pre>
                        </details>
                      ) : null}
                    </div>
                  )}

                  {tab === "timeline" && hasTimeline && result.rounds && (
                    <ComputerUseTimeline rounds={result.rounds} />
                  )}
                </div>
              </>
            )}

            {!hasScreenshot && !hasReport && !hasTimeline && waitingApproval && (
              <div className="flex flex-1 items-center justify-center p-8 text-sm text-[color:var(--label-secondary)]">
                批准后将重新启动浏览器并继续执行
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
