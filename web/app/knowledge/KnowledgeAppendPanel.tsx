"use client";

import { Plus } from "lucide-react";

type Props = {
  title: string;
  content: string;
  loading: boolean;
  embedded?: boolean;
  onTitleChange: (v: string) => void;
  onContentChange: (v: string) => void;
  onSubmit: () => void;
};

export function KnowledgeAppendPanel({
  title,
  content,
  loading,
  embedded = false,
  onTitleChange,
  onContentChange,
  onSubmit,
}: Props) {
  const body = (
    <div className={`flex flex-col gap-3 ${embedded ? "" : "flex-1 p-4"}`}>
      <input
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        placeholder="小节标题（可选）"
        className="rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-3 py-2 text-[13px]"
      />
      <textarea
        value={content}
        onChange={(e) => onContentChange(e.target.value)}
        rows={embedded ? 5 : 8}
        placeholder="在此粘贴或输入要追加的内容…"
        className={`w-full resize-y rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-3 py-2.5 text-[13px] leading-relaxed ${
          embedded ? "min-h-[120px]" : "min-h-[160px] flex-1"
        }`}
      />
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onSubmit}
          disabled={loading || !content.trim()}
          className="inline-flex items-center gap-2 rounded-lg bg-[color:color-mix(in_srgb,var(--accent)_85%,#000)] px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          {loading ? "追加中…" : "追加并更新索引"}
        </button>
      </div>
    </div>
  );

  if (embedded) return body;

  return (
    <div className="card-surface flex min-h-0 flex-1 flex-col rounded-xl lg:rounded-2xl">
      <div className="border-b border-[color:var(--separator-subtle)] px-4 py-3">
        <h3 className="text-[13px] font-semibold">动态追加</h3>
        <p className="mt-0.5 text-[12px] text-[color:var(--label-secondary)]">
          追加内容会写入文档并更新向量索引
        </p>
      </div>
      {body}
    </div>
  );
}
