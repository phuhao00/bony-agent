"use client";

import { Code2, ExternalLink, Loader2, RefreshCw, Terminal } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import CodeGraphGraphView from "./CodeGraphGraphView";

interface CodeGraphStatus {
  status?: string;
  cli_available?: boolean;
  cli_mode?: "local" | "global" | "npx" | null;
  codegraph_home?: string;
  sdk_available?: boolean;
  cli_path?: string | null;
  initialized?: boolean;
  index_path?: string;
  project_root?: string;
  nodeCount?: number;
  fileCount?: number;
  edgeCount?: number;
  hint?: string;
  mcp_preset_id?: string;
  npx_package?: string;
}

export default function CodeGraphPanel() {
  const { t } = useTranslation();
  const [data, setData] = useState<CodeGraphStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [initLoading, setInitLoading] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/context/codegraph-status");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runInit = useCallback(async () => {
    setInitLoading(true);
    setInitError(null);
    try {
      const res = await fetch("/api/context/codegraph/init?with_index=true", {
        method: "POST",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof body.detail === "string"
            ? body.detail
            : body.error || `HTTP ${res.status}`,
        );
      }
      await load();
    } catch (e) {
      setInitError(e instanceof Error ? e.message : "init failed");
    } finally {
      setInitLoading(false);
    }
  }, [load]);

  const status = data?.status ?? "unknown";
  const ready = status === "ready";
  const cliLabel =
    data?.cli_mode === "local"
      ? t("settings.context.codegraphCliLocal")
      : data?.cli_mode === "global"
        ? t("settings.context.codegraphCliGlobal")
        : data?.cli_mode === "npx"
          ? t("settings.context.codegraphCliNpx")
          : data?.cli_available
            ? t("settings.context.codegraphCliOk")
            : t("settings.context.codegraphCliMissing");

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-[color:var(--foreground)]">
            {t("settings.context.codegraphTitle")}
          </h2>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-[color:var(--label-secondary)]">
            {t("settings.context.codegraphSubtitle")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-2 self-start rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-3 py-2 text-[13px] font-medium text-[color:var(--foreground)] hover:bg-[var(--nav-active-fill)] disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          {t("settings.context.statusRefresh")}
        </button>
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50/50 p-4 text-[13px] text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300">
          {error}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatusPill
          icon={<Terminal className="h-3.5 w-3.5" />}
          label="CLI"
          value={cliLabel}
          detail={
            data?.cli_mode === "npx" && data?.npx_package
              ? `npx ${data.npx_package}`
              : data?.cli_path ?? undefined
          }
        />
        <StatusPill
          icon={<Code2 className="h-3.5 w-3.5" />}
          label={t("settings.context.codegraphIndex")}
          value={
            data?.initialized
              ? t("settings.context.codegraphIndexed")
              : t("settings.context.codegraphNotIndexed")
          }
          detail={
            ready
              ? `${data?.nodeCount ?? "?"} nodes · ${data?.fileCount ?? "?"} files · ${data?.edgeCount ?? "?"} edges`
              : undefined
          }
        />
        <StatusPill
          label="MCP"
          value={t("settings.context.codegraphMcpPreset")}
          detail={`preset: ${data?.mcp_preset_id ?? "codegraph"}`}
        />
        <StatusPill
          label={t("settings.context.codegraphGraph.viewTitle")}
          value={ready ? t("settings.context.codegraphGraph.ready") : "—"}
          detail={ready ? t("settings.context.codegraphGraph.readyHint") : undefined}
        />
      </div>

      {!ready && data?.cli_available ? (
        <div className="rounded-2xl border border-[color:var(--separator-subtle)] bg-[var(--nav-active-fill)] p-4">
          <p className="text-[13px] font-medium text-[color:var(--foreground)]">
            {t("settings.context.codegraphSetupTitle")}
          </p>
          {data?.hint ? (
            <pre className="mt-2 overflow-x-auto rounded-lg bg-black/5 p-3 font-mono text-[12px] text-[color:var(--foreground)] dark:bg-white/5">
              {data.hint}
            </pre>
          ) : null}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void runInit()}
              disabled={initLoading}
              className="inline-flex items-center gap-2 rounded-xl bg-[color:var(--accent)] px-4 py-2 text-[13px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {initLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {initLoading
                ? t("settings.context.codegraphInitRunning")
                : t("settings.context.codegraphInitBtn")}
            </button>
            <p className="text-[12px] text-[color:var(--label-secondary)]">
              {t("settings.context.codegraphInitNote")}
            </p>
          </div>
          {initError ? (
            <p className="mt-3 text-[12px] text-red-500">{initError}</p>
          ) : null}
          <p className="mt-3 text-[12px] text-[color:var(--label-secondary)]">
            {t("settings.context.codegraphMcpHint")}
          </p>
        </div>
      ) : null}

      {!ready && !data?.cli_available && data?.hint ? (
        <div className="rounded-2xl border border-amber-200/80 bg-amber-50/40 p-4 dark:border-amber-900/40 dark:bg-amber-950/20">
          <p className="text-[13px] font-medium text-[color:var(--foreground)]">
            {t("settings.context.codegraphNodeRequired")}
          </p>
          <pre className="mt-2 overflow-x-auto rounded-lg bg-black/5 p-3 font-mono text-[12px] text-[color:var(--foreground)] dark:bg-white/5">
            {data.hint}
          </pre>
        </div>
      ) : null}

      <CodeGraphGraphView ready={ready} defaultSymbol="get_codegraph_status" />

      <div className="rounded-2xl card-surface p-5">
        <h3 className="text-[14px] font-semibold text-[color:var(--foreground)]">
          {t("settings.context.codegraphToolsTitle")}
        </h3>
        <ul className="mt-3 grid gap-2 text-[13px] text-[color:var(--label-secondary)] sm:grid-cols-2">
          <li>
            <code className="text-[color:var(--foreground)]">codegraph_explore</code> —{" "}
            {t("settings.context.codegraphToolExplore")}
          </li>
          <li>
            <code className="text-[color:var(--foreground)]">codegraph_search</code> —{" "}
            {t("settings.context.codegraphToolSearch")}
          </li>
          <li>
            <code className="text-[color:var(--foreground)]">codegraph_callers</code> —{" "}
            {t("settings.context.codegraphToolCallers")}
          </li>
          <li>
            <code className="text-[color:var(--foreground)]">codegraph_impact</code> —{" "}
            {t("settings.context.codegraphToolImpact")}
          </li>
        </ul>
        <a
          href="https://github.com/colbymchenry/codegraph"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-[color:var(--accent)] hover:underline"
        >
          CodeGraph GitHub
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
    </div>
  );
}

function StatusPill({
  icon,
  label,
  value,
  detail,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="rounded-2xl card-surface px-4 py-3">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-[color:var(--label-secondary)]">
        {icon}
        {label}
      </div>
      <p className="mt-1 text-[14px] font-semibold text-[color:var(--foreground)]">{value}</p>
      {detail ? (
        <p className="mt-0.5 truncate font-mono text-[10px] text-[color:var(--label-secondary)]">
          {detail}
        </p>
      ) : null}
    </div>
  );
}
