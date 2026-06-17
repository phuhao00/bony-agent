"use client";

import { useEffect, useState } from "react";
import { FolderOpen, Loader2, Trash2 } from "lucide-react";

type Category = {
  id: string;
  name: string;
  icon: string;
  color: string;
};

type Document = {
  id: string;
  filename: string;
  category: string;
  description?: string;
  size: number;
  created_at: string;
  updated_at?: string;
  append_count?: number;
  source_filename?: string;
  source_type?: string;
  converted?: boolean;
  char_count?: number;
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type Props = {
  document: Document;
  categories: Category[];
  saving?: boolean;
  onSaveCategory: (categoryId: string) => Promise<void>;
  onSaveDescription: (description: string) => Promise<void>;
  onAdd: () => void;
  onDelete: () => void;
};

export function KnowledgeDocumentMeta({
  document,
  categories,
  saving = false,
  onSaveCategory,
  onSaveDescription,
  onAdd,
  onDelete,
}: Props) {
  const [categoryId, setCategoryId] = useState(document.category || "uncategorized");
  const [description, setDescription] = useState(document.description || "");
  const [descDirty, setDescDirty] = useState(false);

  useEffect(() => {
    setCategoryId(document.category || "uncategorized");
    setDescription(document.description || "");
    setDescDirty(false);
  }, [document.id, document.category, document.description]);

  const activeCategory =
    categories.find((c) => c.id === categoryId) ||
    categories.find((c) => c.id === "uncategorized");

  return (
    <div className="card-surface rounded-xl p-4 lg:rounded-2xl lg:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold text-[color:var(--foreground)] lg:text-lg">
            {document.filename}
          </h2>
          <p className="mt-1 text-[12px] text-[color:var(--label-secondary)]">
            {document.converted && document.char_count
              ? `${(document.char_count / 1000).toFixed(1)}k 字`
              : formatSize(document.size)}
            {document.source_filename
              ? ` · 来源 ${document.source_type?.toUpperCase() || "文件"}：${document.source_filename}`
              : ""}
            {" · 创建于 "}
            {document.created_at}
            {document.updated_at ? ` · 更新于 ${document.updated_at}` : ""}
            {document.append_count
              ? ` · 已追加 ${document.append_count} 次`
              : ""}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={onAdd}
            className="rounded-lg px-2.5 py-1.5 text-[12px] text-[color:var(--label-secondary)] hover:bg-[var(--nav-active-fill)]"
          >
            新增
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-red-500 hover:bg-red-500/10"
            title="删除文档 (Delete)"
          >
            <Trash2 className="h-4 w-4" />
            删除
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[color:var(--label-secondary)]">
            <FolderOpen className="h-3.5 w-3.5" />
            分类
            {saving && (
              <Loader2 className="h-3 w-3 animate-spin text-[color:var(--accent)]" />
            )}
          </span>
          <div className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: activeCategory?.color || "#6B7280" }}
            />
            <select
              value={categoryId}
              disabled={saving}
              onChange={(e) => {
                const next = e.target.value;
                setCategoryId(next);
                void onSaveCategory(next);
              }}
              className="min-w-0 flex-1 rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-2.5 py-2 text-[13px] outline-none focus:ring-2 focus:ring-[color:color-mix(in_srgb,var(--accent)_35%,transparent)] disabled:opacity-60"
            >
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.icon} {cat.name}
                </option>
              ))}
            </select>
          </div>
        </label>

        <label className="flex flex-col gap-1.5 sm:col-span-1">
          <span className="text-[12px] font-medium text-[color:var(--label-secondary)]">
            描述（可选）
          </span>
          <div className="flex gap-2">
            <input
              value={description}
              disabled={saving}
              onChange={(e) => {
                setDescription(e.target.value);
                setDescDirty(true);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && descDirty) {
                  e.preventDefault();
                  void onSaveDescription(description.trim()).then(() =>
                    setDescDirty(false),
                  );
                }
              }}
              placeholder="便于检索与识别的简短说明"
              className="min-w-0 flex-1 rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-2.5 py-2 text-[13px] outline-none focus:ring-2 focus:ring-[color:color-mix(in_srgb,var(--accent)_35%,transparent)]"
            />
            {descDirty && (
              <button
                type="button"
                disabled={saving}
                onClick={() =>
                  void onSaveDescription(description.trim()).then(() =>
                    setDescDirty(false),
                  )
                }
                className="shrink-0 rounded-lg bg-[color:color-mix(in_srgb,var(--accent)_85%,#000)] px-3 py-2 text-[12px] font-semibold text-white disabled:opacity-50"
              >
                保存
              </button>
            )}
          </div>
        </label>
      </div>
    </div>
  );
}
