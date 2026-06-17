"use client";

import type { InputHTMLAttributes } from "react";
import { useCallback, useRef, useState } from "react";
import { FolderOpen, Upload } from "lucide-react";
import {
  KNOWLEDGE_ACCEPT_ATTR,
  collectFilesFromDataTransfer,
  collectFilesFromFileList,
} from "@/lib/knowledge-upload";
import type { FileUploadItem } from "@/lib/knowledge-upload-client";
import { computeOverallUploadProgress } from "@/lib/knowledge-upload-client";
import { KnowledgeUploadProgress } from "./KnowledgeUploadProgress";

type Props = {
  disabled?: boolean;
  compact?: boolean;
  uploadItems?: FileUploadItem[];
  onFilesReady: (files: File[]) => void | Promise<void>;
};

export function KnowledgeUploadDropzone({
  disabled = false,
  compact = false,
  uploadItems = [],
  onFilesReady,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  const [dragActive, setDragActive] = useState(false);
  const [collecting, setCollecting] = useState(false);

  const overallProgress = computeOverallUploadProgress(uploadItems);
  const hasActiveUpload = uploadItems.some(
    (item) => item.stage !== "done" && item.stage !== "error",
  );

  const emitFiles = useCallback(
    async (files: File[]) => {
      if (!files.length || disabled) return;
      await onFilesReady(files);
    },
    [disabled, onFilesReady],
  );

  const onDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current += 1;
    setDragActive(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragActive(false);
  }, []);

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragDepthRef.current = 0;
      setDragActive(false);
      if (disabled) return;
      setCollecting(true);
      try {
        const files = await collectFilesFromDataTransfer(e.dataTransfer);
        await emitFiles(files);
      } finally {
        setCollecting(false);
      }
    },
    [disabled, emitFiles],
  );

  const busy = disabled || collecting || hasActiveUpload;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div
        role="button"
        tabIndex={busy ? -1 : 0}
        onKeyDown={(e) => {
          if (busy) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            fileInputRef.current?.click();
          }
        }}
        onClick={() => {
          if (busy) return;
          fileInputRef.current?.click();
        }}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onDrop={onDrop}
        className={`relative flex min-h-[140px] flex-col items-center justify-center rounded-xl border border-dashed text-center transition-colors ${
          compact ? "px-4 py-5" : "px-6 py-6"
        } ${
          dragActive
            ? "border-[color:color-mix(in_srgb,var(--accent)_55%,transparent)] bg-[color:color-mix(in_srgb,var(--accent)_10%,var(--card-bg))]"
            : "border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] hover:border-[color:color-mix(in_srgb,var(--accent)_35%,transparent)]"
        } ${busy ? "cursor-wait opacity-80" : "cursor-pointer"}`}
      >
        <Upload
          className={`text-[color:var(--label-secondary)] ${compact ? "mb-2 h-6 w-6" : "mb-2.5 h-7 w-7"}`}
        />
        <p className="text-[13px] font-medium text-[color:var(--foreground)]">
          {collecting
            ? "正在扫描文件夹…"
            : hasActiveUpload
              ? `正在导入… ${overallProgress}%`
              : dragActive
                ? "松开以上传"
                : disabled
                  ? "正在导入，请稍候…"
                  : "拖拽文件或文件夹到此处"}
        </p>
        <p className="mt-1 max-w-lg text-[12px] leading-relaxed text-[color:var(--label-secondary)]">
          支持 TXT · MD · PDF · DOCX · JSON · CSV · XLSX · XLS（单文件最大 20MB）
          <br />
          上传后自动解析为 Markdown 知识条目（非源文件直存）
        </p>

        {hasActiveUpload && (
          <div className="mt-3 w-full max-w-xs">
            <div className="h-1.5 overflow-hidden rounded-full bg-[var(--card-bg)]">
              <div
                className="h-full rounded-full bg-[color:var(--accent)] transition-all duration-300"
                style={{ width: `${overallProgress}%` }}
              />
            </div>
          </div>
        )}

        <div
          className="mt-3 flex flex-wrap items-center justify-center gap-2"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[color:color-mix(in_srgb,var(--accent)_85%,#000)] px-3.5 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
          >
            <Upload className="h-3.5 w-3.5" />
            选择文件
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => folderInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-3.5 py-1.5 text-[12px] font-medium text-[color:var(--foreground)] disabled:opacity-50"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            选择文件夹
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={KNOWLEDGE_ACCEPT_ATTR}
          className="hidden"
          onChange={(e) => {
            const picked = collectFilesFromFileList(e.target.files);
            void emitFiles(picked);
            e.target.value = "";
          }}
        />
        <input
          ref={folderInputRef}
          type="file"
          className="hidden"
          multiple
          {...({
            webkitdirectory: "",
            directory: "",
            mozdirectory: "",
          } as InputHTMLAttributes<HTMLInputElement>)}
          onChange={(e) => {
            const picked = collectFilesFromFileList(e.target.files);
            void emitFiles(picked);
            e.target.value = "";
          }}
        />
      </div>

      {uploadItems.length > 0 && (
        <KnowledgeUploadProgress items={uploadItems} />
      )}
    </div>
  );
}
