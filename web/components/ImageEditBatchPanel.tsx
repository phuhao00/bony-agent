"use client";

import { CheckCircle2, Circle, Loader2, Plus, Trash2, XCircle } from "lucide-react";

export type BatchItemStatus = "pending" | "running" | "done" | "error";

export interface BatchEditItem {
  id: string;
  displayUrl: string;
  sourceUrl: string;
  label: string;
  status: BatchItemStatus;
  resultUrl?: string;
  error?: string;
}

interface ImageEditBatchPanelProps {
  items: BatchEditItem[];
  running: boolean;
  progress: { done: number; total: number };
  onRemove: (id: string) => void;
  onClear: () => void;
  onRun: () => void;
  onSelectResult: (item: BatchEditItem) => void;
}

export default function ImageEditBatchPanel({
  items,
  running,
  progress,
  onRemove,
  onClear,
  onRun,
  onSelectResult,
}: ImageEditBatchPanelProps) {
  if (items.length === 0) return null;

  return (
    <div className="rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-[color:var(--foreground)]">
          批量队列 ({items.length} 张)
        </p>
        <button type="button" onClick={onClear} disabled={running} className="text-xs text-[color:var(--label-secondary)] hover:text-red-500 disabled:opacity-50">
          清空
        </button>
      </div>

      {running && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-[color:var(--label-secondary)]">
            <span>处理中…</span>
            <span>{progress.done}/{progress.total}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-[var(--nav-active-fill)]">
            <div
              className="h-full rounded-full bg-blue-500 transition-all"
              style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}

      <div className="max-h-48 space-y-2 overflow-y-auto">
        {items.map((item) => (
          <div key={item.id} className="flex items-center gap-2 rounded-lg bg-[var(--chrome-rail-bg)] p-2">
            <img src={item.displayUrl} alt="" className="h-10 w-10 shrink-0 rounded object-cover" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs text-[color:var(--foreground)]">{item.label}</p>
              {item.status === "error" && (
                <p className="truncate text-[10px] text-red-500">{item.error}</p>
              )}
            </div>
            {item.status === "pending" && <Circle className="h-4 w-4 shrink-0 text-[color:var(--label-secondary)]" />}
            {item.status === "running" && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-500" />}
            {item.status === "done" && (
              <button type="button" onClick={() => onSelectResult(item)} title="查看结果">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
              </button>
            )}
            {item.status === "error" && <XCircle className="h-4 w-4 shrink-0 text-red-500" />}
            {!running && item.status === "pending" && (
              <button type="button" onClick={() => onRemove(item.id)} className="shrink-0 p-1 hover:text-red-500">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={onRun}
        disabled={running || items.every((i) => i.status !== "pending")}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {running ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            批量处理中…
          </>
        ) : (
          <>
            <Plus className="h-4 w-4" />
            开始批量编辑
          </>
        )}
      </button>
    </div>
  );
}
