"use client";

import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import type { FileUploadItem } from "@/lib/knowledge-upload-client";
import {
  computeOverallUploadProgress,
  uploadStageLabel,
} from "@/lib/knowledge-upload-client";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type Props = {
  items: FileUploadItem[];
};

export function KnowledgeUploadProgress({ items }: Props) {
  if (!items.length) return null;

  const overallProgress = computeOverallUploadProgress(items);
  const active = items.filter((i) => i.stage !== "done" && i.stage !== "error");
  const done = items.filter((i) => i.stage === "done").length;
  const failed = items.filter((i) => i.stage === "error").length;
  const allFinished = active.length === 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-[color:var(--foreground)]">
            导入进度
          </p>
          <p className="mt-0.5 text-[12px] text-[color:var(--label-secondary)]">
            {active.length > 0
              ? `正在处理 ${active.length} 个文件（索引/OCR 可能需数分钟）`
              : `已完成 ${done} 个${failed ? `，${failed} 个失败` : ""}`}
          </p>
        </div>
        <span className="shrink-0 text-[13px] font-semibold tabular-nums text-[color:var(--accent)]">
          {allFinished ? "100" : overallProgress}%
        </span>
      </div>

      <div className="h-2 overflow-hidden rounded-full bg-[var(--chrome-rail-bg)]">
        <div
          className={`h-full rounded-full transition-all duration-300 ${
            allFinished
              ? failed === items.length
                ? "bg-red-500"
                : "bg-emerald-500"
              : "bg-[color:var(--accent)]"
          }`}
          style={{ width: `${allFinished ? 100 : overallProgress}%` }}
        />
      </div>

      <ul className="max-h-[280px] space-y-2 overflow-y-auto pr-1">
        {items.map((item) => {
          const isDone = item.stage === "done";
          const isError = item.stage === "error";
          const isActive = !isDone && !isError;

          return (
            <li
              key={item.id}
              className="rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-3 py-2.5"
            >
              <div className="flex items-start gap-2.5">
                <div className="mt-0.5 shrink-0">
                  {isDone ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  ) : isError ? (
                    <XCircle className="h-4 w-4 text-red-500" />
                  ) : (
                    <Loader2 className="h-4 w-4 animate-spin text-[color:var(--accent)]" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-[13px] font-medium text-[color:var(--foreground)]">
                      {item.fileName}
                    </p>
                    <span className="shrink-0 text-[11px] tabular-nums text-[color:var(--label-secondary)]">
                      {item.progress}%
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-[color:var(--label-secondary)]">
                    {formatSize(item.fileSize)}
                    {isDone && item.categoryName
                      ? ` · 归入「${item.categoryName}」`
                      : ""}
                    {isActive ? ` · ${uploadStageLabel(item.stage)}` : ""}
                    {isError && item.error ? ` · ${item.error}` : ""}
                  </p>
                  {isActive && (
                    <div className="mt-2 h-1 overflow-hidden rounded-full bg-[var(--chrome-rail-bg)]">
                      <div
                        className="h-full rounded-full bg-[color:color-mix(in_srgb,var(--accent)_70%,transparent)] transition-all duration-200"
                        style={{ width: `${item.progress}%` }}
                      />
                    </div>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
