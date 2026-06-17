"use client";

import { Code2, Copy, GitBranch } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { navigateToMemGraph } from "@/lib/contextNavigation";
import type { CodeEntityRef, MemoryChunk } from "./memoryChunkTypes";

interface MemoryChunkDetailProps {
  chunk: MemoryChunk;
}

function ConfidenceBar({ pct, label }: { pct: number; label: string }) {
  return (
    <div className="mt-3">
      <div className="mb-1 flex justify-between text-[10px] text-[color:var(--label-secondary)]">
        <span>{label}</span>
        <span>{pct}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--nav-active-fill)]">
        <div
          className="h-full rounded-full bg-[color:var(--accent)]"
          style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
        />
      </div>
    </div>
  );
}

export default function MemoryChunkDetail({ chunk }: MemoryChunkDetailProps) {
  const { t } = useTranslation();
  const [codeEntities, setCodeEntities] = useState<CodeEntityRef[]>(chunk.code_entities ?? []);
  const [copied, setCopied] = useState(false);
  const confidence = Number(chunk.metadata?.confidence ?? 0);
  const confidencePct = confidence <= 1 ? Math.round(confidence * 100) : Math.round(confidence);

  useEffect(() => {
    setCodeEntities(chunk.code_entities ?? []);
    fetch(`/api/context/memory/${encodeURIComponent(chunk.id)}/code-entities`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.code_entities?.length) setCodeEntities(data.code_entities);
      })
      .catch(() => undefined);
  }, [chunk.id, chunk.code_entities]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(chunk.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* ignore */
    }
  }, [chunk.id]);

  const body = chunk.content_full || chunk.content_preview;

  return (
    <article className="mw-pane-detail">
      <div className="border-b border-[color:var(--separator-subtle)] px-5 py-4">
        <div className="text-[11px] uppercase tracking-wide text-[color:var(--label-secondary)]">
          {chunk.source_kind} · {chunk.source_id}
        </div>
        <h3 className="mt-1 text-[15px] font-semibold text-[color:var(--foreground)] line-clamp-2">
          {(chunk.content_preview || "").split("\n")[0]}
        </h3>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {chunk.entities.slice(0, 8).map((e) => (
            <span
              key={e.id}
              className="rounded-md bg-[var(--nav-active-fill)] px-2 py-0.5 text-[11px] text-[color:var(--label-secondary)]"
            >
              {e.label}
            </span>
          ))}
        </div>
        {confidencePct > 0 ? (
          <ConfidenceBar pct={confidencePct} label={t("settings.context.confidence")} />
        ) : null}
      </div>

      <div className="mw-detail-body">{body}</div>

      {codeEntities.length > 0 ? (
        <div className="border-t border-[color:var(--separator-subtle)] px-5 py-3">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--label-secondary)]">
            <Code2 className="h-3.5 w-3.5" />
            {t("settings.context.codeEntities")}
          </div>
          <div className="flex flex-wrap gap-1">
            {codeEntities.map((ent, i) => (
              <span key={`${ent.label}-${i}`} className="mw-code-chip" title={ent.path || ent.symbol}>
                {ent.kind === "file" ? "📄" : "ƒ"} {ent.label}
                {ent.source === "codegraph" ? " · cg" : ""}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <footer className="flex items-center justify-between gap-2 border-t border-[color:var(--separator-subtle)] px-5 py-2 text-[11px] text-[color:var(--label-secondary)]">
        <span className="font-mono">{chunk.id.slice(0, 12)}…</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigateToMemGraph(chunk.id)}
            className="inline-flex items-center gap-1 hover:text-[color:var(--accent)]"
          >
            <GitBranch className="h-3 w-3" />
            {t("settings.context.viewInGraph")}
          </button>
          <button type="button" onClick={() => void handleCopy()} className="inline-flex items-center gap-1 hover:text-[color:var(--foreground)]">
            <Copy className="h-3 w-3" />
            {copied ? t("settings.context.copied") : t("settings.context.copyId")}
          </button>
        </div>
      </footer>
    </article>
  );
}
