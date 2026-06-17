"use client";

import { Brain, Code2, History, Layers, RefreshCw, Sparkles } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "@/hooks/useTranslation";

interface MemoryStatus {
  memory_count: number;
  layers: Record<string, number>;
  skills_enabled: number;
  skills_total: number;
  codegraph?: {
    status?: string;
    cli_available?: boolean;
    initialized?: boolean;
    nodeCount?: number;
    fileCount?: number;
    hint?: string;
  };
  sessions?: {
    session_count?: number;
    message_count?: number;
    last_updated?: number | null;
  };
}

function StatCard({
  label,
  value,
  icon: Icon,
  sub,
}: {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  sub?: string;
}) {
  return (
    <div className="rounded-2xl border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] p-4 shadow-sm">
      <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-[color:var(--label-secondary)]">
        <Icon className="h-3.5 w-3.5" strokeWidth={2} />
        {label}
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-[color:var(--foreground)]">{value}</p>
      {sub ? (
        <p className="mt-1 text-[11px] text-[color:var(--label-secondary)]">{sub}</p>
      ) : null}
    </div>
  );
}

export default function MemoryStatusPanel() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<MemoryStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/context/memory-status");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [load]);

  const cg = status?.codegraph;
  const cgLabel =
    cg?.status === "ready"
      ? t("settings.context.statusCodegraphReady")
      : cg?.status === "not_indexed"
        ? t("settings.context.statusCodegraphNotIndexed")
        : cg?.status === "cli_missing"
          ? t("settings.context.statusCodegraphCliMissing")
          : t("settings.context.statusCodegraphUnknown");

  return (
    <section className="mb-6">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[13px] font-semibold text-[color:var(--foreground)]">
          {t("settings.context.statusTitle")}
        </h2>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] text-[color:var(--label-secondary)] hover:bg-[var(--nav-active-fill)] disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          {t("settings.context.statusRefresh")}
        </button>
      </div>

      {error ? (
        <p className="text-[12px] text-red-500">{error}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard
            label={t("settings.context.statusMemories")}
            value={status?.memory_count ?? "—"}
            icon={Brain}
          />
          <StatCard
            label={t("settings.context.statusSessions")}
            value={status?.sessions?.session_count ?? "—"}
            icon={History}
            sub={
              status?.sessions
                ? `${status.sessions.message_count ?? 0} ${t("settings.context.messagesCount")}`
                : undefined
            }
          />
          <StatCard
            label={t("settings.context.statusLayers")}
            value={Object.keys(status?.layers ?? {}).length || "—"}
            icon={Layers}
            sub={
              status?.layers
                ? Object.entries(status.layers)
                    .slice(0, 3)
                    .map(([k, v]) => `${k}: ${v}`)
                    .join(" · ")
                : undefined
            }
          />
          <StatCard
            label={t("settings.context.statusSkills")}
            value={status ? `${status.skills_enabled}/${status.skills_total}` : "—"}
            icon={Sparkles}
          />
          <StatCard
            label={t("settings.context.statusCodegraph")}
            value={cgLabel}
            icon={Code2}
            sub={
              cg?.status === "ready"
                ? `${cg.nodeCount ?? "?"} nodes · ${cg.fileCount ?? "?"} files`
                : cg?.hint
            }
          />
        </div>
      )}
    </section>
  );
}
