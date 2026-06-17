"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  FileSpreadsheet,
  GripVertical,
  Plus,
  Save,
  Search,
  Trash2,
} from "lucide-react";
import { type FaqItem, isFaqDocument, newFaqItem } from "@/lib/knowledge-faq";

type DocLite = {
  id: string;
  filename: string;
  content_type?: string;
  faq_count?: number;
};

type Props = {
  document: DocLite;
  onSaved?: () => void;
  notify: (message: string, tone?: "ok" | "err") => void;
};

export function KnowledgeFaqPanel({ document, onSaved, notify }: Props) {
  const [title, setTitle] = useState("");
  const [items, setItems] = useState<FaqItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [importing, setImporting] = useState(false);
  const excelInputRef = useRef<HTMLInputElement>(null);
  const pendingImportModeRef = useRef<"append" | "replace">("append");

  const loadFaq = useCallback(async () => {
    if (!isFaqDocument(document)) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/knowledge/documents/${encodeURIComponent(document.id)}/faq`,
      );
      const data = await res.json();
      if (!res.ok || !data.success) {
        notify(data.detail || data.error || "加载 FAQ 失败", "err");
        return;
      }
      setTitle(data.title || document.filename);
      setItems(Array.isArray(data.items) ? data.items : []);
      setDirty(false);
      if (data.items?.[0]?.id) setExpandedId(data.items[0].id);
    } catch (error) {
      notify(`加载 FAQ 出错: ${error}`, "err");
    } finally {
      setLoading(false);
    }
  }, [document, notify]);

  useEffect(() => {
    void loadFaq();
  }, [loadFaq]);

  const filteredItems = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => {
      const extraHay = Object.entries(item.extra || {})
        .map(([k, v]) => `${k} ${v}`)
        .join(" ");
      const hay = [item.question, item.answer, extraHay, ...item.tags]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [items, filter]);

  const updateExtraField = (id: string, key: string, value: string) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const extra = { ...(item.extra || {}) };
        if (value.trim()) extra[key] = value;
        else delete extra[key];
        return { ...item, extra };
      }),
    );
    setDirty(true);
  };

  const updateItem = (id: string, patch: Partial<FaqItem>) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
    setDirty(true);
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
    setDirty(true);
  };

  const addItem = () => {
    const item = newFaqItem(items.length);
    setItems((prev) => [...prev, item]);
    setExpandedId(item.id);
    setDirty(true);
  };

  const moveItem = (id: string, direction: -1 | 1) => {
    setItems((prev) => {
      const index = prev.findIndex((x) => x.id === id);
      if (index < 0) return prev;
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next.map((item, idx) => ({ ...item, order: idx }));
    });
    setDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(
        `/api/knowledge/documents/${encodeURIComponent(document.id)}/faq`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: title.trim() || document.filename,
            items: items.map((item, idx) => ({
              ...item,
              order: idx,
            })),
          }),
        },
      );
      const data = await res.json();
      if (!res.ok || !data.success) {
        notify(data.detail || data.error || "保存失败", "err");
        return;
      }
      setItems(data.items || items);
      setDirty(false);
      notify("FAQ 已保存并更新索引");
      onSaved?.();
    } catch (error) {
      notify(`保存出错: ${error}`, "err");
    } finally {
      setSaving(false);
    }
  };

  const startExcelImport = (mode: "append" | "replace") => {
    if (mode === "replace" && items.length > 0) {
      const ok = window.confirm(
        "将用 Excel 内容替换当前全部问答，此操作不可撤销。确定继续？",
      );
      if (!ok) return;
    }
    pendingImportModeRef.current = mode;
    excelInputRef.current?.click();
  };

  const handleExcelSelected = async (file: File | undefined) => {
    if (!file) return;
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext !== "xlsx" && ext !== "xls") {
      notify("请选择 .xlsx 或 .xls 文件", "err");
      return;
    }

    setImporting(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("mode", pendingImportModeRef.current);

      const res = await fetch(
        `/api/knowledge/documents/${encodeURIComponent(document.id)}/faq/import`,
        { method: "POST", body: form },
      );
      const data = await res.json();
      if (!res.ok || !data.success) {
        notify(data.detail || data.error || "导入失败", "err");
        return;
      }

      setTitle(data.title || title);
      setItems(Array.isArray(data.items) ? data.items : []);
      setDirty(false);
      const count =
        data.imported_count ?? (Array.isArray(data.items) ? data.items.length : 0);
      notify(
        pendingImportModeRef.current === "replace"
          ? `已导入 ${count} 条问答（已替换）`
          : `已追加 ${count} 条问答`,
      );
      if (data.items?.[0]?.id) setExpandedId(data.items[0].id);
      onSaved?.();
    } catch (error) {
      notify(`导入出错: ${error}`, "err");
    } finally {
      setImporting(false);
    }
  };

  if (loading) {
    return (
      <div className="card-surface rounded-2xl p-8 text-center text-[13px] text-[color:var(--label-secondary)]">
        加载 FAQ…
      </div>
    );
  }

  return (
    <div className="card-surface flex flex-col rounded-2xl border border-[color:var(--separator-subtle)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--separator-subtle)] px-4 py-3">
        <div className="min-w-0 flex-1">
          <input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setDirty(true);
            }}
            className="w-full rounded-lg border border-transparent bg-transparent px-1 py-0.5 text-[15px] font-semibold text-[color:var(--foreground)] outline-none focus:border-[color:var(--separator-subtle)] focus:bg-[var(--card-bg)]"
            placeholder="FAQ 标题"
          />
          <p className="mt-0.5 text-[12px] text-[color:var(--label-secondary)]">
            {items.length} 条问答
            {document.faq_count != null ? ` · 已索引 ${document.faq_count} 条` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={excelInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              void handleExcelSelected(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => startExcelImport("append")}
            disabled={importing}
            className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-[12px] font-medium text-emerald-700 hover:bg-emerald-500/15 disabled:opacity-50"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            {importing ? "导入中…" : "Excel 追加"}
          </button>
          {items.length > 0 && (
            <button
              type="button"
              onClick={() => startExcelImport("replace")}
              disabled={importing}
              className="inline-flex items-center gap-1 rounded-lg border border-[color:var(--separator-subtle)] px-3 py-1.5 text-[12px] font-medium text-[color:var(--foreground)] hover:bg-[var(--nav-active-fill)] disabled:opacity-50"
            >
              Excel 替换
            </button>
          )}
          <button
            type="button"
            onClick={addItem}
            className="inline-flex items-center gap-1 rounded-lg border border-[color:var(--separator-subtle)] px-3 py-1.5 text-[12px] font-medium text-[color:var(--foreground)] hover:bg-[var(--nav-active-fill)]"
          >
            <Plus className="h-3.5 w-3.5" />
            新增问答
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !dirty}
            className="inline-flex items-center gap-1 rounded-lg bg-[color:color-mix(in_srgb,var(--accent)_85%,#000)] px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </div>

      <div className="border-b border-[color:var(--separator-subtle)] px-4 py-2 text-[11px] leading-relaxed text-[color:var(--label-secondary)]">
        支持任意表头：自动识别「问题/回答/关键词」，其余列（如场景编号、场景名称）保留为扩展字段；汇总类工作表会自动跳过
      </div>

      <div className="border-b border-[color:var(--separator-subtle)] px-4 py-2.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--label-secondary)]" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="搜索问题、答案、关键词或扩展字段…"
            className="w-full rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] py-2 pl-9 pr-3 text-[12px] text-[color:var(--foreground)] outline-none"
          />
        </div>
      </div>

      <div className="max-h-[min(70vh,640px)] overflow-y-auto p-3">
        {filteredItems.length === 0 ? (
          <div className="py-10 text-center text-[13px] text-[color:var(--label-secondary)]">
            {items.length === 0
              ? "暂无问答。可点击「Excel 追加」导入表格，或使用「新增问答」手动编辑"
              : "没有匹配的 FAQ 条目"}
          </div>
        ) : (
          <div className="space-y-2">
            {filteredItems.map((item, idx) => {
              const expanded = expandedId === item.id;
              return (
                <div
                  key={item.id}
                  className="rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)]"
                >
                  <div className="flex items-start gap-2 px-3 py-2.5">
                    <GripVertical className="mt-1 h-4 w-4 shrink-0 text-[color:var(--label-secondary)] opacity-50" />
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedId(expanded ? null : item.id)
                      }
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="text-[11px] font-medium uppercase tracking-wide text-amber-600">
                        Q{idx + 1}
                      </div>
                      <div className="mt-0.5 text-[13px] font-medium text-[color:var(--foreground)]">
                        {item.question || "（未填写问题）"}
                      </div>
                      {Object.keys(item.extra || {}).length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {Object.entries(item.extra || {}).map(([key, val]) => (
                            <span
                              key={key}
                              className="inline-flex max-w-full truncate rounded-full bg-[var(--card-bg)] px-2 py-0.5 text-[10px] text-[color:var(--label-secondary)]"
                            >
                              {key}: {val}
                            </span>
                          ))}
                        </div>
                      )}
                    </button>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => moveItem(item.id, -1)}
                        className="rounded p-1 text-[color:var(--label-secondary)] hover:bg-[var(--nav-active-fill)]"
                        title="上移"
                      >
                        <ChevronUp className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveItem(item.id, 1)}
                        className="rounded p-1 text-[color:var(--label-secondary)] hover:bg-[var(--nav-active-fill)]"
                        title="下移"
                      >
                        <ChevronDown className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeItem(item.id)}
                        className="rounded p-1 text-red-500 hover:bg-red-500/10"
                        title="删除"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  {expanded && (
                    <div className="space-y-2 border-t border-[color:var(--separator-subtle)] px-3 py-3">
                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-[color:var(--label-secondary)]">
                          问题
                        </label>
                        <textarea
                          value={item.question}
                          onChange={(e) =>
                            updateItem(item.id, { question: e.target.value })
                          }
                          rows={2}
                          className="w-full resize-none rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-2.5 py-2 text-[13px] text-[color:var(--foreground)] outline-none"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-[color:var(--label-secondary)]">
                          答案
                        </label>
                        <textarea
                          value={item.answer}
                          onChange={(e) =>
                            updateItem(item.id, { answer: e.target.value })
                          }
                          rows={5}
                          className="w-full resize-y rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-2.5 py-2 text-[13px] leading-relaxed text-[color:var(--foreground)] outline-none"
                        />
                      </div>
                      {Object.keys(item.extra || {}).length > 0 && (
                        <div className="space-y-2 rounded-lg border border-dashed border-[color:var(--separator-subtle)] p-2.5">
                          <div className="text-[11px] font-medium text-[color:var(--label-secondary)]">
                            扩展字段（来自 Excel 表头）
                          </div>
                          {Object.entries(item.extra || {}).map(([key, val]) => (
                            <div key={key}>
                              <label className="mb-1 block text-[11px] text-[color:var(--label-secondary)]">
                                {key}
                              </label>
                              <input
                                value={val}
                                onChange={(e) =>
                                  updateExtraField(item.id, key, e.target.value)
                                }
                                className="w-full rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-2.5 py-2 text-[13px] outline-none"
                              />
                            </div>
                          ))}
                        </div>
                      )}
                      {item.tags.length > 0 && (
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-[color:var(--label-secondary)]">
                            关键词
                          </label>
                          <input
                            value={item.tags.join(", ")}
                            onChange={(e) =>
                              updateItem(item.id, {
                                tags: e.target.value
                                  .split(/[,，、]/)
                                  .map((t) => t.trim())
                                  .filter(Boolean),
                              })
                            }
                            className="w-full rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-2.5 py-2 text-[13px] outline-none"
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
