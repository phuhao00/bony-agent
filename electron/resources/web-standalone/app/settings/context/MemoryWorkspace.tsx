"use client";

import { GitBranch, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { navigateToMemGraph } from "@/lib/contextNavigation";
import MemoryChunkDetail from "./MemoryChunkDetail";
import MemoryNavigator from "./MemoryNavigator";
import MemoryResultList from "./MemoryResultList";
import type { MemoryChunk, MemoryChunksResponse, NavigatorSelection } from "./memoryChunkTypes";
import "./memory-workspace.css";

interface MemoryWorkspaceProps {
  initialMemoryId?: string;
  onMemoryIdConsumed?: () => void;
}

export default function MemoryWorkspace({
  initialMemoryId,
  onMemoryIdConsumed,
}: MemoryWorkspaceProps) {
  const { t } = useTranslation();
  const [data, setData] = useState<MemoryChunksResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selection, setSelection] = useState<NavigatorSelection>({ sourceIds: [], entityIds: [] });
  const [selectedId, setSelectedId] = useState<string | null>(initialMemoryId ?? null);

  useEffect(() => {
    if (initialMemoryId) {
      setSelectedId(initialMemoryId);
      onMemoryIdConsumed?.();
    }
  }, [initialMemoryId, onMemoryIdConsumed]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchQuery.trim()) params.set("search", searchQuery.trim());
      const res = await fetch(`/api/context/memory/chunks?${params}`);
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, [searchQuery]);

  useEffect(() => {
    const t = setTimeout(() => void load(), searchQuery ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, searchQuery]);

  const filteredChunks = useMemo(() => {
    const chunks = data?.chunks ?? [];
    return chunks.filter((c) => {
      if (selection.sourceIds.length && !selection.sourceIds.includes(c.source_id)) return false;
      if (selection.entityIds.length) {
        const ids = new Set(c.entities.map((e) => e.id));
        if (!selection.entityIds.some((id) => ids.has(id))) return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        if (!c.content_preview.toLowerCase().includes(q) && !c.source_id.toLowerCase().includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [data?.chunks, selection, searchQuery]);

  const selectedChunk: MemoryChunk | null =
    filteredChunks.find((c) => c.id === selectedId) ?? filteredChunks[0] ?? null;

  useEffect(() => {
    if (!selectedId && filteredChunks[0]) setSelectedId(filteredChunks[0].id);
  }, [filteredChunks, selectedId]);

  return (
    <div className="memory-workspace-root">
      <div className="flex items-center justify-between border-b border-[color:var(--separator-subtle)] px-4 py-2">
        <span className="text-[12px] text-[color:var(--label-secondary)]">
          {filteredChunks.length} memories · browser view
        </span>
        <div className="flex items-center gap-1">
          {selectedChunk ? (
            <button
              type="button"
              onClick={() => navigateToMemGraph(selectedChunk.id)}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-[color:var(--accent)] hover:bg-[var(--nav-active-fill)]"
            >
              <GitBranch className="h-3.5 w-3.5" />
              {t("settings.context.viewInGraphShort")}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="rounded-lg p-1.5 text-[color:var(--label-secondary)] hover:bg-[var(--nav-active-fill)] disabled:opacity-40"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>
      <div className="memory-workspace-grid">
        <MemoryNavigator
          chunks={filteredChunks}
          sources={data?.sources ?? []}
          topTopics={data?.top_topics ?? []}
          selection={selection}
          onSelectionChange={setSelection}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
        />
        <MemoryResultList
          chunks={filteredChunks}
          selectedChunkId={selectedChunk?.id ?? null}
          onSelectChunk={setSelectedId}
        />
        {selectedChunk ? <MemoryChunkDetail chunk={selectedChunk} /> : (
          <div className="mw-pane-detail flex items-center justify-center text-[13px] text-[color:var(--label-secondary)]">
            Select a memory
          </div>
        )}
      </div>
    </div>
  );
}
