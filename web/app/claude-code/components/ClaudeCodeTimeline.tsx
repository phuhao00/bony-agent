"use client";

import type { ClaudeCodeTimelineItem } from "../lib/types";

export function ClaudeCodeTimeline({ items }: { items: ClaudeCodeTimelineItem[] }) {
  if (!items.length) {
    return (
      <p className="text-sm text-[color:var(--label-secondary)]">
        执行步骤将显示在这里。
      </p>
    );
  }

  const kindColor: Record<string, string> = {
    start: "text-[color:var(--accent)]",
    message: "text-[color:var(--foreground)]",
    permission: "text-amber-700 dark:text-amber-300",
    error: "text-red-600 dark:text-red-400",
    final: "text-emerald-700 dark:text-emerald-300",
  };

  return (
    <ol className="relative space-y-0 border-l border-[color:var(--separator-subtle)] pl-4">
      {items.map((item) => (
        <li key={item.id} className="relative pb-4 last:pb-0">
          <span className="absolute -left-[calc(0.5rem+1px)] top-1.5 h-2 w-2 rounded-full bg-[color:var(--accent)] ring-2 ring-[var(--chrome-rail-bg)]" />
          <div className="text-xs">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className={`font-semibold ${kindColor[item.kind] || ""}`}>
                {item.title}
              </span>
              <span className="font-mono text-[10px] text-[color:var(--label-secondary)]">
                {item.kind}
              </span>
            </div>
            {item.detail ? (
              <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-[var(--shell-bg)] px-2 py-1.5 font-mono text-[10px] text-[color:var(--label-secondary)]">
                {item.detail}
              </pre>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
