"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownContentProps {
  markdown: string;
  className?: string;
}

export function MarkdownContent({ markdown, className }: MarkdownContentProps) {
  return (
    <div
      className={
        "prose prose-sm max-w-none dark:prose-invert " +
        "prose-headings:font-semibold prose-headings:text-[var(--foreground)] " +
        "prose-p:text-[var(--foreground)] prose-strong:text-[var(--foreground)] " +
        "prose-li:text-[var(--foreground)] prose-code:text-[color:var(--accent)] " +
        "prose-pre:bg-[var(--nav-active-fill)] prose-pre:text-[var(--foreground)] " +
        "prose-blockquote:border-l-[color:var(--accent)] " +
        (className || "")
      }
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown || "*暂无内容*"}</ReactMarkdown>
    </div>
  );
}
