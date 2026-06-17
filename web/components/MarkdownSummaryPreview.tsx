"use client";

import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** 与主界面深色/浅色 shell 共用 CSS 变量，避免 slate-* 在深色卡片上不可读 */
const mdComponents: Partial<Components> = {
  h1: (props) => (
    <h1
      className="mt-6 mb-3 text-lg font-bold tracking-tight text-[color:var(--foreground)] first:mt-0"
      {...props}
    />
  ),
  h2: (props) => (
    <h2
      className="mt-5 mb-2 text-base font-semibold text-[color:var(--foreground)]"
      {...props}
    />
  ),
  h3: (props) => (
    <h3
      className="mt-4 mb-1.5 text-sm font-semibold text-[color:var(--foreground)]"
      {...props}
    />
  ),
  h4: (props) => (
    <h4
      className="mt-3 mb-1.5 text-sm font-semibold text-[color:var(--foreground)]"
      {...props}
    />
  ),
  p: (props) => (
    <p
      className="mb-2.5 text-[13px] leading-relaxed text-[color:var(--foreground)]"
      {...props}
    />
  ),
  ul: (props) => (
    <ul
      className="mb-2.5 list-disc space-y-0.5 pl-5 text-[13px] text-[color:var(--foreground)]"
      {...props}
    />
  ),
  ol: (props) => (
    <ol
      className="mb-2.5 list-decimal space-y-0.5 pl-5 text-[13px] text-[color:var(--foreground)]"
      {...props}
    />
  ),
  li: (props) => <li className="leading-relaxed" {...props} />,
  blockquote: (props) => (
    <blockquote
      className="mb-3 border-l-4 border-[color:var(--accent)] bg-[var(--nav-active-fill)] py-2 pl-4 pr-2 text-[color:var(--label-secondary)] [&_p]:mb-0 [&_strong]:text-[color:var(--foreground)]"
      {...props}
    />
  ),
  hr: () => (
    <hr className="my-5 border-[color:var(--separator-subtle)]" />
  ),
  a: (props) => (
    <a
      className="text-[color:var(--accent)] underline decoration-[color:color-mix(in_srgb,var(--accent)_45%,transparent)] underline-offset-2 hover:opacity-90"
      {...props}
    />
  ),
  strong: (props) => (
    <strong className="font-semibold text-[color:var(--foreground)]" {...props} />
  ),
  em: (props) => (
    <em className="italic text-[color:var(--label-secondary)]" {...props} />
  ),
  code: ({ className, children, ...props }) => {
    const isBlock = Boolean(className?.includes("language-"));
    if (isBlock) {
      return (
        <code
          className={`block whitespace-pre-wrap break-all font-mono text-[12px] leading-relaxed text-slate-100 ${className ?? ""}`}
          {...props}
        >
          {children}
        </code>
      );
    }
    return (
      <code
        className="rounded bg-[var(--chrome-rail-bg)] px-1.5 py-0.5 font-mono text-[11px] text-[color:var(--foreground)] ring-1 ring-[color:var(--separator-subtle)]"
        {...props}
      >
        {children}
      </code>
    );
  },
  pre: (props) => (
    <pre className="mb-4 overflow-x-auto rounded-lg border border-slate-700 bg-slate-900 p-4 [&>code]:bg-transparent [&>code]:p-0">
      {props.children}
    </pre>
  ),
  table: (props) => (
    <div className="mb-4 max-w-full overflow-x-auto rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)]">
      <table
        className="w-full min-w-[280px] border-collapse text-left text-sm text-[color:var(--foreground)]"
        {...props}
      />
    </div>
  ),
  thead: (props) => (
    <thead className="bg-[var(--nav-active-fill)]" {...props} />
  ),
  tbody: (props) => <tbody {...props} />,
  tr: (props) => (
    <tr
      className="border-b border-[color:var(--separator-subtle)] last:border-0"
      {...props}
    />
  ),
  th: (props) => (
    <th
      className="whitespace-nowrap px-3 py-2 font-semibold text-[color:var(--foreground)]"
      {...props}
    />
  ),
  td: (props) => (
    <td className="px-3 py-2 align-top text-[color:var(--foreground)]" {...props} />
  ),
};

export function MarkdownSummaryPreview({ markdown }: { markdown: string }) {
  return (
    <article className="markdown-summary-pre max-w-none break-words [overflow-wrap:anywhere]">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
        {markdown}
      </ReactMarkdown>
    </article>
  );
}
