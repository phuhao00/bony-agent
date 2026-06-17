"use client";

import { MarkdownSummaryPreview } from "@/components/MarkdownSummaryPreview";

/** Renders assistant stream/report text as formatted Markdown (not raw source). */
export function AssistantMarkdownPreview({
  markdown,
  loading,
}: {
  markdown: string;
  loading?: boolean;
}) {
  return (
    <div className="assistant-markdown-preview">
      <MarkdownSummaryPreview markdown={markdown} />
      {loading && !markdown.endsWith("\n") ? (
        <span className="ml-0.5 inline-block h-4 w-1 animate-pulse bg-[color:var(--accent)]" />
      ) : null}
    </div>
  );
}
