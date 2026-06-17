"use client";

import { FileText, HelpCircle } from "lucide-react";
import { isFaqDocument } from "@/lib/knowledge-faq";

type Category = {
  id: string;
  name: string;
  icon: string;
  document_count: number;
  color?: string;
};

type KnowledgeDoc = {
  id: string;
  filename: string;
  category: string;
  faq_count?: number;
  content_type?: string;
  description?: string;
};

type QuerySource = {
  text: string;
  score: number;
  category?: string;
  file_name?: string;
  doc_id?: string;
};

type QueryResult = {
  success: boolean;
  answer?: string;
  error?: string;
  sources?: QuerySource[];
};

type Props = {
  documents: KnowledgeDoc[];
  categories: Category[];
  query: string;
  queryScope: string;
  queryLoading: boolean;
  queryResult: QueryResult | null;
  onQueryChange: (v: string) => void;
  onQueryScopeChange: (v: string) => void;
  onSearch: () => void;
};

function scopeLabel(
  scope: string,
  documents: KnowledgeDoc[],
  categories: Category[],
): string {
  if (scope === "all") return "全部文档";
  if (scope.startsWith("doc:")) {
    const id = scope.slice(4);
    return documents.find((d) => d.id === id)?.filename || "指定文档";
  }
  if (scope.startsWith("cat:")) {
    const id = scope.slice(4);
    return categories.find((c) => c.id === id)?.name || id;
  }
  return "全部文档";
}

export function KnowledgeQueryPanel({
  documents,
  categories,
  query,
  queryScope,
  queryLoading,
  queryResult,
  onQueryChange,
  onQueryScopeChange,
  onSearch,
}: Props) {
  const categoriesWithDocs = categories.filter((c) => c.document_count > 0);
  const docsByCategory = (catId: string) =>
    documents.filter((d) => (d.category || "uncategorized") === catId);

  if (documents.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-md text-center">
          <p className="text-[15px] font-medium text-[color:var(--foreground)]">
            知识库还是空的
          </p>
          <p className="mt-2 text-[13px] text-[color:var(--label-secondary)]">
            请先在「文档」页新增内容，再使用智能检索提问。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto grid h-full max-w-6xl gap-4 lg:grid-cols-[minmax(260px,320px)_minmax(0,1fr)]">
      <div className="flex min-h-0 flex-col gap-4">
        <div>
          <h2 className="text-lg font-semibold text-[color:var(--foreground)]">
            智能检索
          </h2>
          <p className="mt-1 text-[13px] text-[color:var(--label-secondary)]">
            基于已索引的 {documents.length} 篇文档回答问题
          </p>
        </div>

        <div className="card-surface flex min-h-0 flex-1 flex-col rounded-2xl p-4">
          <h3 className="mb-2 shrink-0 text-[12px] font-semibold text-[color:var(--label-secondary)]">
            已索引知识库
          </h3>
          <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto">
          {documents.map((doc) => {
            const cat = categories.find((c) => c.id === doc.category);
            const scoped = queryScope === `doc:${doc.id}`;
            return (
              <button
                key={doc.id}
                type="button"
                onClick={() => onQueryScopeChange(`doc:${doc.id}`)}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] transition-colors ${
                  scoped
                    ? "bg-[color:color-mix(in_srgb,var(--accent)_14%,var(--card-bg))]"
                    : "hover:bg-[var(--nav-active-fill)]"
                }`}
              >
                {isFaqDocument(doc) ? (
                  <HelpCircle className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                ) : (
                  <FileText className="h-3.5 w-3.5 shrink-0 text-[color:var(--label-secondary)]" />
                )}
                <span className="min-w-0 flex-1 truncate font-medium text-[color:var(--foreground)]">
                  {doc.description || doc.filename}
                </span>
                <span className="shrink-0 text-[11px] text-[color:var(--label-secondary)]">
                  {cat?.icon} {cat?.name || doc.category}
                  {isFaqDocument(doc) && doc.faq_count
                    ? ` · ${doc.faq_count} 条`
                    : ""}
                </span>
              </button>
            );
          })}
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-col gap-4">
      <div className="card-surface space-y-3 rounded-2xl p-4">
        <textarea
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          rows={4}
          placeholder="输入问题，例如：一键安装 MOD 没反应怎么办？"
          className="w-full resize-none rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-3 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-[color:color-mix(in_srgb,var(--accent)_35%,transparent)]"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              onSearch();
            }
          }}
        />
        <div className="flex gap-2">
          <select
            value={queryScope}
            onChange={(e) => onQueryScopeChange(e.target.value)}
            className="flex-1 rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-3 py-2 text-[13px]"
          >
            <option value="all">全部文档 ({documents.length})</option>
            {categoriesWithDocs.map((cat) => (
              <optgroup
                key={cat.id}
                label={`${cat.icon} ${cat.name} (${cat.document_count})`}
              >
                <option value={`cat:${cat.id}`}>
                  └ 整个分类 · {cat.document_count} 篇
                </option>
                {docsByCategory(cat.id).map((doc) => (
                  <option key={doc.id} value={`doc:${doc.id}`}>
                    {isFaqDocument(doc) ? "❓ " : "📄 "}
                    {doc.description || doc.filename}
                    {isFaqDocument(doc) && doc.faq_count
                      ? ` (${doc.faq_count} 条 FAQ)`
                      : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <button
            type="button"
            onClick={onSearch}
            disabled={queryLoading || !query.trim()}
            className="rounded-xl bg-[color:color-mix(in_srgb,var(--accent)_85%,#000)] px-5 py-2 text-[13px] font-semibold text-white disabled:opacity-50"
          >
            {queryLoading ? "检索中…" : "检索"}
          </button>
        </div>
        <p className="text-[11px] text-[color:var(--label-secondary)]">
          当前范围：{scopeLabel(queryScope, documents, categories)} · ⌘/Ctrl + Enter
          快速检索
        </p>
      </div>

      {queryResult && (
        <div className="space-y-3">
          {queryResult.success ? (
            <>
              <div className="card-surface rounded-2xl p-4">
                <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-[color:var(--label-secondary)]">
                  回答
                </h3>
                <p className="whitespace-pre-wrap text-[13px] leading-relaxed">
                  {queryResult.answer}
                </p>
              </div>
              {(queryResult.sources?.length ?? 0) > 0 && (
                <div className="card-surface rounded-2xl p-4">
                  <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-[color:var(--label-secondary)]">
                    参考来源
                  </h3>
                  <div className="space-y-2">
                    {queryResult.sources!.map((source, idx) => (
                      <div
                        key={idx}
                        className="rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] p-3 text-[12px]"
                      >
                        <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-[color:var(--label-secondary)]">
                          {source.file_name && (
                            <span className="font-medium text-[color:var(--foreground)]">
                              📎 {source.file_name}
                            </span>
                          )}
                          <span>相似度 {(source.score * 100).toFixed(1)}%</span>
                        </div>
                        {source.text}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-[13px]">
              {queryResult.error}
            </div>
          )}
        </div>
      )}
      </div>
    </div>
  );
}
