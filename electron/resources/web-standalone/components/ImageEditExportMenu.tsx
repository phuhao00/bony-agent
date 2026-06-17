"use client";

import {
  downloadExportedImage,
  type ImageExportFormat,
} from "@/lib/image-export";
import { ChevronDown, Download, FileImage, Layers, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

const EXPORT_OPTIONS: {
  format: ImageExportFormat;
  label: string;
  hint: string;
  icon: typeof FileImage;
}[] = [
  { format: "png", label: "PNG", hint: "无损透明", icon: FileImage },
  { format: "jpeg", label: "JPEG", hint: "体积小", icon: FileImage },
  { format: "psd", label: "PSD", hint: "分层可编辑", icon: Layers },
];

interface ImageEditExportMenuProps {
  resultUrl: string;
  sourceUrl?: string;
  maskUrl?: string;
  disabled?: boolean;
  compact?: boolean;
}

export default function ImageEditExportMenu({
  resultUrl,
  sourceUrl,
  maskUrl,
  disabled = false,
  compact = false,
}: ImageEditExportMenuProps) {
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState<ImageExportFormat | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const handleExport = useCallback(
    async (format: ImageExportFormat) => {
      if (!resultUrl || exporting) return;
      setExporting(format);
      setOpen(false);
      try {
        await downloadExportedImage({
          imageUrl: resultUrl,
          format,
          sourceImageUrl: format === "psd" ? sourceUrl : undefined,
          maskImageUrl: format === "psd" ? maskUrl : undefined,
          jpegQuality: 92,
        });
      } catch (err) {
        alert(String(err));
      } finally {
        setExporting(null);
      }
    },
    [exporting, maskUrl, resultUrl, sourceUrl],
  );

  const busy = Boolean(exporting);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled || !resultUrl || busy}
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center justify-center gap-1.5 rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] text-[color:var(--foreground)] transition-colors hover:bg-[var(--nav-active-fill)] disabled:opacity-50 ${
          compact ? "px-3 py-2 text-xs" : "px-4 py-2 text-sm"
        }`}
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Download className="h-4 w-4" />
        )}
        {busy ? "导出中…" : "导出"}
        {!busy && <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />}
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+6px)] z-50 min-w-[200px] overflow-hidden rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] py-1 shadow-lg">
          {EXPORT_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            return (
              <button
                key={opt.format}
                type="button"
                onClick={() => void handleExport(opt.format)}
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-[var(--nav-active-fill)]"
              >
                <Icon className="h-4 w-4 shrink-0 text-[color:var(--label-secondary)]" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-[color:var(--foreground)]">
                    {opt.label}
                  </span>
                  <span className="block text-[11px] text-[color:var(--label-secondary)]">
                    {opt.hint}
                    {opt.format === "psd" && sourceUrl ? " · 含原图图层" : ""}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
