"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { MemoryChunk, MemoryEntityRef, MemorySource, NavigatorSelection } from "./memoryChunkTypes";

interface MemoryNavigatorProps {
  chunks: MemoryChunk[];
  sources: MemorySource[];
  topTopics: MemoryEntityRef[];
  selection: NavigatorSelection;
  onSelectionChange: (next: NavigatorSelection) => void;
  searchQuery: string;
  onSearchChange: (next: string) => void;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function NavSection({
  label,
  children,
  countSummary,
  defaultOpen = true,
}: {
  label: string;
  children: React.ReactNode;
  countSummary?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mw-section">
      <button type="button" className="mw-section-heading" onClick={() => setOpen((o) => !o)}>
        <span>{label}</span>
        {countSummary ? <span className="ml-2 text-[10px] normal-case opacity-60">{countSummary}</span> : null}
        <span className="ml-auto">{open ? "▾" : "▸"}</span>
      </button>
      {open ? children : null}
    </div>
  );
}

export default function MemoryNavigator({
  chunks,
  sources,
  topTopics,
  selection,
  onSelectionChange,
  searchQuery,
  onSearchChange,
}: MemoryNavigatorProps) {
  const [recentCounts, setRecentCounts] = useState({ today: 0, week: 0 });

  useEffect(() => {
    const now = Date.now();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const startOfDayMs = startOfDay.getTime();
    const startOfWeekMs = now - 7 * DAY_MS;
    let today = 0;
    let week = 0;
    for (const c of chunks) {
      if (c.timestamp_ms >= startOfDayMs) today++;
      if (c.timestamp_ms >= startOfWeekMs) week++;
    }
    setRecentCounts({ today, week });
  }, [chunks]);

  const toggleSource = (id: string) => {
    const next = selection.sourceIds.includes(id)
      ? selection.sourceIds.filter((x) => x !== id)
      : [...selection.sourceIds, id];
    onSelectionChange({ ...selection, sourceIds: next });
  };

  const toggleEntity = (id: string) => {
    const next = selection.entityIds.includes(id)
      ? selection.entityIds.filter((x) => x !== id)
      : [...selection.entityIds, id];
    onSelectionChange({ ...selection, entityIds: next });
  };

  const heatmapDays = useMemo(() => {
    const buckets = Array(14).fill(0);
    const now = Date.now();
    for (const c of chunks) {
      const age = Math.floor((now - c.timestamp_ms) / DAY_MS);
      if (age >= 0 && age < 14) buckets[13 - age]++;
    }
    return buckets;
  }, [chunks]);

  return (
    <div className="mw-pane-navigator overflow-y-auto">
      <input
        className="mw-search"
        placeholder="Filter memories…"
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
      />

      <div className="px-3 pb-2">
        <div className="flex h-6 items-end gap-0.5">
          {heatmapDays.map((n, i) => (
            <div
              key={i}
              className="flex-1 rounded-sm bg-[color:var(--accent)]"
              style={{ height: `${Math.max(2, Math.min(24, n * 6))}px`, opacity: n ? 0.35 + n * 0.12 : 0.08 }}
              title={`${n} memories`}
            />
          ))}
        </div>
      </div>

      <NavSection label="Recent" countSummary={`${recentCounts.today} today`}>
        <div className="px-3 pb-2 text-[12px] text-[color:var(--label-secondary)]">
          {recentCounts.week} this week · {chunks.length} total
        </div>
      </NavSection>

      <NavSection label="Sources">
        {sources.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`mw-filter-chip${selection.sourceIds.includes(s.id) ? " active" : ""}`}
            onClick={() => toggleSource(s.id)}
          >
            {s.label} <span className="opacity-60">({s.count})</span>
          </button>
        ))}
      </NavSection>

      <NavSection label="Topics" defaultOpen={topTopics.length > 0}>
        {topTopics.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`mw-filter-chip${selection.entityIds.includes(t.id) ? " active" : ""}`}
            onClick={() => toggleEntity(t.id)}
          >
            {t.label}
          </button>
        ))}
      </NavSection>
    </div>
  );
}
