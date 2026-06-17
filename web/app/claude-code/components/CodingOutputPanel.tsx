"use client";

import type { ClaudeCodeTimelineItem } from "../lib/types";
import { ClaudeCodeTimeline } from "./ClaudeCodeTimeline";

export function CodingOutputPanel({
  timeline,
  error,
}: {
  timeline: ClaudeCodeTimelineItem[];
  error: string;
}) {
  return (
    <div className="flex min-h-0 flex-col bg-[var(--chrome-rail-bg)]">
      <div className="flex shrink-0 items-center justify-between border-b border-[color:var(--separator-subtle)] px-3 py-2">
        <span className="text-xs font-semibold text-[color:var(--foreground)]">
          执行日志
        </span>
        {timeline.length > 0 ? (
          <span className="text-[10px] text-[color:var(--label-secondary)]">
            {timeline.length} 条
          </span>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {error ? (
          <p className="mb-3 rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-2 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        ) : null}
        {timeline.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-[color:var(--label-secondary)]">
            工具调用与 SDK 事件会显示在这里
          </p>
        ) : (
          <ClaudeCodeTimeline items={timeline} />
        )}
      </div>
    </div>
  );
}
