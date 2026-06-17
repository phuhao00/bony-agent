"use client";

import type { EditCanvasMode } from "@/lib/image-edit-modes";
import { ChevronLeft, ChevronRight, History } from "lucide-react";

export interface EditSessionItem {
  id: string;
  url: string;
  label: string;
  mode: EditCanvasMode;
}

interface ImageEditSessionBarProps {
  items: EditSessionItem[];
  currentId: string | null;
  onSelect: (item: EditSessionItem) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
}

export default function ImageEditSessionBar({
  items,
  currentId,
  onSelect,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
}: ImageEditSessionBarProps) {
  if (items.length <= 1) return null;

  return (
    <div className="rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-medium text-[color:var(--foreground)]">
          <History className="h-3.5 w-3.5" />
          编辑历史
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            disabled={!canUndo}
            onClick={onUndo}
            className="rounded-md p-1 text-[color:var(--label-secondary)] hover:bg-[var(--nav-active-fill)] disabled:opacity-40"
            aria-label="撤销"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            disabled={!canRedo}
            onClick={onRedo}
            className="rounded-md p-1 text-[color:var(--label-secondary)] hover:bg-[var(--nav-active-fill)] disabled:opacity-40"
            aria-label="重做"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {items.map((item, index) => {
          const active = item.id === currentId;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item)}
              className={`shrink-0 overflow-hidden rounded-lg border transition-all ${
                active
                  ? "border-[color:color-mix(in_srgb,var(--accent)_50%,transparent)] ring-2 ring-[color:color-mix(in_srgb,var(--accent)_25%,transparent)]"
                  : "border-[color:var(--separator-subtle)] hover:border-[color:color-mix(in_srgb,var(--accent)_30%,transparent)]"
              }`}
            >
              <img src={item.url} alt={item.label} className="h-14 w-14 object-cover" />
              <span className="block max-w-[72px] truncate px-1 py-0.5 text-[10px] text-[color:var(--label-secondary)]">
                {index === 0 ? "原图" : item.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
