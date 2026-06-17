"use client";

import { extractMediaPathFromResult } from "@/lib/image-edit-utils";
import { Clock, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

interface HistoryItem {
  id: string;
  type: string;
  prompt: string;
  result: string;
  timestamp: string;
}

interface ImageEditHistoryPickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (url: string, label: string) => void;
}

const IMAGE_TYPES = new Set(["image", "image_edit"]);

export default function ImageEditHistoryPicker({
  open,
  onClose,
  onSelect,
}: ImageEditHistoryPickerProps) {
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<Array<{ id: string; url: string; prompt: string; type: string; timestamp: string }>>([]);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/history?limit=80");
      const data = await res.json();
      const parsed = (data.items || [] as HistoryItem[])
        .filter((item: HistoryItem) => IMAGE_TYPES.has(item.type))
        .map((item: HistoryItem) => {
          const url = extractMediaPathFromResult(item.result);
          if (!url) return null;
          return {
            id: item.id,
            url,
            prompt: item.prompt || item.type,
            type: item.type,
            timestamp: item.timestamp,
          };
        })
        .filter(Boolean) as Array<{ id: string; url: string; prompt: string; type: string; timestamp: string }>;
      setItems(parsed);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) fetchHistory();
  }, [open, fetchHistory]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-2xl border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[color:var(--separator-subtle)] px-4 py-3">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-[color:var(--label-secondary)]" />
            <h2 className="text-sm font-semibold text-[color:var(--foreground)]">从历史记录选图</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 hover:bg-[var(--nav-active-fill)]">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-[color:var(--label-secondary)]">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              加载中…
            </div>
          ) : items.length === 0 ? (
            <p className="py-12 text-center text-sm text-[color:var(--label-secondary)]">
              暂无图片生成历史
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    onSelect(item.url, item.prompt.slice(0, 20) || "历史图片");
                    onClose();
                  }}
                  className="group overflow-hidden rounded-xl border border-[color:var(--separator-subtle)] text-left transition-all hover:border-[color:color-mix(in_srgb,var(--accent)_40%,transparent)] hover:shadow-md"
                >
                  <img src={item.url} alt="" className="aspect-square w-full object-cover" />
                  <div className="p-1.5">
                    <p className="truncate text-[10px] text-[color:var(--foreground)]">{item.prompt}</p>
                    <p className="text-[9px] text-[color:var(--label-secondary)]">
                      {item.type === "image_edit" ? "编辑" : "生成"}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
