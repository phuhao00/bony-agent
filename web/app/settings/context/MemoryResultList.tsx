"use client";

import { useEffect, useMemo, useRef } from "react";
import type { MemoryChunk } from "./memoryChunkTypes";

type GroupKey = "TODAY" | "YESTERDAY" | "THIS WEEK" | "OLDER";

const DAY_MS = 24 * 60 * 60 * 1000;

function bucketFor(ts: number, todayMs: number, yesterdayMs: number, weekStartMs: number): GroupKey {
  if (ts >= todayMs) return "TODAY";
  if (ts >= yesterdayMs) return "YESTERDAY";
  if (ts >= weekStartMs) return "THIS WEEK";
  return "OLDER";
}

function formatTime(ts: number, group: GroupKey): string {
  const d = new Date(ts);
  if (group === "TODAY" || group === "YESTERDAY") {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });
}

function chunkSubject(chunk: MemoryChunk): string {
  const preview = (chunk.content_preview ?? "").trim();
  if (!preview) return chunk.id;
  const firstLine = preview.split("\n")[0];
  return firstLine.length > 120 ? `${firstLine.slice(0, 117)}…` : firstLine;
}

interface MemoryResultListProps {
  chunks: MemoryChunk[];
  selectedChunkId: string | null;
  onSelectChunk: (id: string) => void;
}

export default function MemoryResultList({
  chunks,
  selectedChunkId,
  onSelectChunk,
}: MemoryResultListProps) {
  const activeRef = useRef<HTMLButtonElement | null>(null);

  const groups = useMemo(() => {
    const now = Date.now();
    const todayMs = new Date(now).setHours(0, 0, 0, 0);
    const yesterdayMs = todayMs - DAY_MS;
    const weekStartMs = now - 7 * DAY_MS;
    const map = new Map<GroupKey, MemoryChunk[]>();
    const order: GroupKey[] = ["TODAY", "YESTERDAY", "THIS WEEK", "OLDER"];
    for (const key of order) map.set(key, []);
    for (const c of chunks) {
      const key = bucketFor(c.timestamp_ms || 0, todayMs, yesterdayMs, weekStartMs);
      map.get(key)!.push(c);
    }
    return order
      .map((key) => ({ key, chunks: map.get(key) ?? [] }))
      .filter((g) => g.chunks.length > 0);
  }, [chunks]);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedChunkId]);

  return (
    <div className="mw-pane-results overflow-y-auto">
      {groups.map((group) => (
        <div key={group.key}>
          <div className="mw-group-header">{group.key}</div>
          {group.chunks.map((chunk) => (
            <button
              key={chunk.id}
              ref={selectedChunkId === chunk.id ? activeRef : null}
              type="button"
              className={`mw-result-row${selectedChunkId === chunk.id ? " active" : ""}`}
              onClick={() => onSelectChunk(chunk.id)}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[13px] font-medium text-[color:var(--foreground)] line-clamp-1">
                  {chunkSubject(chunk)}
                </span>
                <span className="shrink-0 text-[11px] text-[color:var(--label-secondary)]">
                  {formatTime(chunk.timestamp_ms, group.key)}
                </span>
              </div>
              <div className="mt-1 text-[11px] text-[color:var(--label-secondary)]">
                {chunk.source_kind} · {chunk.source_id}
              </div>
            </button>
          ))}
        </div>
      ))}
      {chunks.length === 0 ? (
        <p className="p-6 text-center text-[13px] text-[color:var(--label-secondary)]">No memories match filters.</p>
      ) : null}
    </div>
  );
}
