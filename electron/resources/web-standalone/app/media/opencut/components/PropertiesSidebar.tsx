"use client";

import { SlidersHorizontal } from "lucide-react";
import type { TimelineElement } from "../lib/types";

interface PropertiesSidebarProps {
  selectedElements: TimelineElement[];
}

export default function PropertiesSidebar({ selectedElements }: PropertiesSidebarProps) {
  if (selectedElements.length === 0) {
    return (
      <div className="chrome-rail chrome-rail-edge-left flex h-full w-80 shrink-0 flex-col">
        <div className="flex h-11 items-center border-b border-[var(--separator-subtle)] px-4">
          <span className="text-xs font-semibold text-[var(--foreground)]">Properties</span>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center text-center text-[var(--foreground)]/60">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--shell-bg)]">
            <SlidersHorizontal size={22} strokeWidth={1.5} />
          </div>
          <p className="text-sm font-medium text-[var(--foreground)]">It&apos;s empty here</p>
          <p className="mt-1 max-w-[180px] text-xs leading-relaxed text-[var(--foreground)]/60">
            Click an element on the timeline to edit its properties
          </p>
        </div>
      </div>
    );
  }

  const el = selectedElements[0];
  return (
    <div className="chrome-rail chrome-rail-edge-left flex h-full w-80 shrink-0 flex-col">
      <div className="flex h-11 items-center border-b border-[var(--separator-subtle)] px-4">
        <span className="text-xs font-semibold text-[var(--foreground)]">Properties</span>
      </div>
      <div className="p-4">
        <div className="mb-4 text-sm font-semibold text-[var(--foreground)]">{el.name}</div>
        <div className="space-y-3 rounded-xl bg-[var(--shell-bg)] p-3 text-xs text-[var(--foreground)]/60">
          <div className="flex justify-between">
            <span>Type</span>
            <span className="text-[var(--foreground)]">{el.type}</span>
          </div>
          <div className="flex justify-between">
            <span>Start</span>
            <span className="text-[var(--foreground)]">{el.startTime.toFixed(2)}s</span>
          </div>
          <div className="flex justify-between">
            <span>Duration</span>
            <span className="text-[var(--foreground)]">{el.duration.toFixed(2)}s</span>
          </div>
        </div>
      </div>
    </div>
  );
}
