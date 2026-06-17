"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Eye, Loader2, Pencil, Save, Sparkles } from "lucide-react";
import { MarkdownSummaryPreview } from "@/components/MarkdownSummaryPreview";

const AUTO_OPTIMIZE_SOURCE_TYPES = new Set([
  "pdf",
  "doc",
  "docx",
  "ppt",
  "pptx",
  "url",
  "html",
  "htm",
]);

function shouldAutoOptimizeOnLoad(meta: {
  contentOptimized?: boolean;
  sourceType?: string;
  converted?: boolean;
  sourceFilename?: string;
}): boolean {
  if (meta.contentOptimized) return false;
  const sourceType = (meta.sourceType || "").toLowerCase();
  if (AUTO_OPTIMIZE_SOURCE_TYPES.has(sourceType)) return true;
  return Boolean(meta.converted || meta.sourceFilename);
}

type Props = {
  docId: string;
  refreshToken?: number;
  notify: (message: string, tone?: "ok" | "err") => void;
  onSaved?: () => void;
  autoOptimizeOnLoad?: boolean;
  contentOptimized?: boolean;
  sourceType?: string;
  converted?: boolean;
  sourceFilename?: string;
};

type ViewMode = "preview" | "edit";

export function KnowledgeContentPanel({
  docId,
  refreshToken = 0,
  notify,
  onSaved,
  autoOptimizeOnLoad = true,
  contentOptimized = false,
  sourceType = "",
  converted = false,
  sourceFilename = "",
}: Props) {
  const [mode, setMode] = useState<ViewMode>("preview");
  const [content, setContent] = useState("");
  const [draft, setDraft] = useState("");
  const [charCount, setCharCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoOptimizeAttemptedRef = useRef<string | null>(null);

  const loadContent = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/knowledge/documents/${encodeURIComponent(docId)}/content`,
        { cache: "no-store" },
      );
      const data = await res.json();
      if (!res.ok || data.success === false) {
        setError(data.detail || data.error || "加载正文失败");
        setContent("");
        setDraft("");
        setCharCount(0);
        return;
      }
      const text = typeof data.content === "string" ? data.content : "";
      setContent(text);
      setDraft(text);
      setCharCount(Number(data.char_count) || text.length);
      setMode("preview");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [docId]);

  useEffect(() => {
    void loadContent();
  }, [loadContent, refreshToken]);

  const dirty = mode === "edit" && draft !== content;

  const saveContent = async () => {
    const normalized = draft.trim();
    if (!normalized) {
      notify("正文不能为空", "err");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(
        `/api/knowledge/documents/${encodeURIComponent(docId)}/content`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: normalized }),
        },
      );
      const data = await res.json();
      if (!res.ok || data.success === false) {
        notify(data.detail || data.error || "保存失败", "err");
        return;
      }
      setContent(normalized);
      setDraft(normalized);
      setCharCount(Number(data.char_count) || normalized.length);
      setMode("preview");
      notify("正文已保存并更新索引");
      onSaved?.();
    } catch (e) {
      notify(`保存出错: ${(e as Error).message}`, "err");
    } finally {
      setSaving(false);
    }
  };

  const formatOptimizeMessage = (data: Record<string, unknown>): string => {
    if (data.unchanged) {
      return typeof data.message === "string"
        ? data.message
        : "内容已较整洁，无需进一步优化";
    }
    const method =
      data.method === "rules+llm"
        ? "规则清理 + AI 结构化"
        : data.llm_skipped === "missing_api_key"
          ? "规则清理（未配置 LLM Key，跳过 AI）"
          : "规则清理";
    return `正文已优化（${method}）`;
  };

  const optimizeContent = useCallback(
    async (options?: { silent?: boolean }) => {
      setOptimizing(true);
      try {
        const res = await fetch(
          `/api/knowledge/documents/${encodeURIComponent(docId)}/optimize`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ use_llm: true }),
          },
        );
        const data = await res.json();
        if (!res.ok || data.success === false) {
          if (!options?.silent) {
            notify(data.detail || data.error || "优化失败", "err");
          }
          return { ok: false as const };
        }
        if (data.unchanged) {
          if (!options?.silent) {
            notify(formatOptimizeMessage(data));
          }
          return { ok: true as const, unchanged: true as const };
        }
        await loadContent();
        if (!options?.silent) {
          notify(formatOptimizeMessage(data));
        }
        onSaved?.();
        return { ok: true as const, unchanged: false as const };
      } catch (e) {
        if (!options?.silent) {
          notify(`优化出错: ${(e as Error).message}`, "err");
        }
        return { ok: false as const };
      } finally {
        setOptimizing(false);
      }
    },
    [docId, loadContent, notify, onSaved],
  );

  useEffect(() => {
    if (!autoOptimizeOnLoad || loading || error || !content.trim()) return;
    if (
      !shouldAutoOptimizeOnLoad({
        contentOptimized,
        sourceType,
        converted,
        sourceFilename,
      })
    ) {
      return;
    }
    const attemptKey = `${docId}:${refreshToken}`;
    if (autoOptimizeAttemptedRef.current === attemptKey) return;
    autoOptimizeAttemptedRef.current = attemptKey;
    void optimizeContent({ silent: true }).then((result) => {
      if (result.ok && !result.unchanged) {
        notify("已自动优化正文（PDF 乱码 / 断行清理）");
        onSaved?.();
      }
    });
  }, [
    autoOptimizeOnLoad,
    content,
    contentOptimized,
    converted,
    docId,
    error,
    loading,
    notify,
    onSaved,
    optimizeContent,
    refreshToken,
    sourceFilename,
    sourceType,
  ]);

  return (
    <div className="card-surface flex min-h-[360px] flex-1 flex-col overflow-hidden rounded-xl lg:min-h-[420px] lg:rounded-2xl">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[color:var(--separator-subtle)] px-4 py-3">
        <div>
          <h3 className="text-[13px] font-semibold text-[color:var(--foreground)]">
            正文内容
          </h3>
          <p className="mt-0.5 text-[12px] text-[color:var(--label-secondary)]">
            {loading
              ? "加载中…"
              : error
                ? "无法展示正文"
                : optimizing
                  ? "正在自动优化正文…"
                  : `${charCount.toLocaleString()} 字 · 预览 / 编辑 · 自动优化 PDF 乱码`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={loading || optimizing || Boolean(error) || !content.trim()}
            onClick={() => void optimizeContent()}
            title="手动再次优化：清理 PDF 乱码、断行与页眉页脚，并用 AI 整理 Markdown 结构"
            className="inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] px-3 py-1.5 text-[12px] font-medium text-[color:var(--foreground)] disabled:opacity-50"
          >
            {optimizing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5 text-[color:var(--accent)]" />
            )}
            {optimizing ? "优化中…" : "一键优化"}
          </button>
          <div className="inline-flex rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] p-0.5">
            <button
              type="button"
              disabled={loading || Boolean(error)}
              onClick={() => setMode("preview")}
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[12px] font-medium ${
                mode === "preview"
                  ? "bg-[var(--card-bg)] text-[color:var(--foreground)] shadow-sm"
                  : "text-[color:var(--label-secondary)]"
              }`}
            >
              <Eye className="h-3.5 w-3.5" />
              预览
            </button>
            <button
              type="button"
              disabled={loading || Boolean(error)}
              onClick={() => {
                setDraft(content);
                setMode("edit");
              }}
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[12px] font-medium ${
                mode === "edit"
                  ? "bg-[var(--card-bg)] text-[color:var(--foreground)] shadow-sm"
                  : "text-[color:var(--label-secondary)]"
              }`}
            >
              <Pencil className="h-3.5 w-3.5" />
              编辑
            </button>
          </div>
          {mode === "edit" && (
            <button
              type="button"
              disabled={saving || !dirty}
              onClick={() => void saveContent()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[color:color-mix(in_srgb,var(--accent)_85%,#000)] px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              {saving ? "保存中…" : "保存"}
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex h-full min-h-[240px] items-center justify-center text-[13px] text-[color:var(--label-secondary)]">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            正在加载正文…
          </div>
        ) : error ? (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-[13px] text-[color:var(--foreground)]">
            {error}
          </div>
        ) : mode === "preview" ? (
          content.trim() ? (
            <MarkdownSummaryPreview markdown={content} />
          ) : (
            <p className="text-[13px] text-[color:var(--label-secondary)]">
              暂无正文内容
            </p>
          )
        ) : (
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            className="h-full min-h-[320px] w-full resize-y rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-3 py-2.5 font-mono text-[12px] leading-relaxed text-[color:var(--foreground)] outline-none focus:ring-2 focus:ring-[color:color-mix(in_srgb,var(--accent)_35%,transparent)]"
            placeholder="在此编辑 Markdown 正文…"
          />
        )}
      </div>
    </div>
  );
}
