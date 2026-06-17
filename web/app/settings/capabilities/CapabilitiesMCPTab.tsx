"use client";

import { useTranslation } from "@/hooks/useTranslation";
import {
    AlertCircle,
    ChevronDown,
    ChevronRight,
    Loader2,
    Plus,
    RefreshCw,
    Server,
    Unplug,
    Wrench,
    X,
    Package,
    Github
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

// ─── Types ───────────────────────────────────────────────────────────────────

type ServerStatus = "unknown" | "connected" | "error" | "pinging";

interface MCPTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

interface MCPServer {
  id: string;
  name: string;
  url: string;
  description?: string;
  enabled: boolean;
  status?: ServerStatus;
  status_msg?: string;
  server_name?: string;
  server_version?: string;
  preset_id?: string;
}

interface MCPPresetRow {
  id: string;
  server_row_id: string;
  github: string;
  default_port?: number;
  http_path?: string;
  description_zh?: string;
  description_en?: string;
  installed: boolean;
  running: boolean;
  url?: string | null;
}


// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusDot({ status }: { status: ServerStatus }) {
  if (status === "pinging")
    return (
      <span className="flex h-2 w-2 items-center justify-center">
        <Loader2
          className="h-3 w-3 animate-spin text-[color:var(--accent)]"
          strokeWidth={2.5}
        />
      </span>
    );
  if (status === "connected")
    return (
      <span className="h-2 w-2 rounded-full bg-[color:var(--accent)] shadow-[0_0_4px_rgba(255,149,0,0.45)]" />
    );
  if (status === "error")
    return <span className="h-2 w-2 rounded-full bg-red-400" />;
  return <span className="h-2 w-2 rounded-full bg-[color:var(--separator-subtle)]" />;
}

function ToolBadge({ tool }: { tool: MCPTool }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const props = Object.keys((tool.inputSchema as any)?.properties ?? {});
  const paramHint =
    props.length === 0
      ? null
      : props.length === 1
        ? t("settings.mcp.paramOne")
        : t("settings.mcp.paramMany", { count: props.length });
  return (
    <div className="rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] px-3 py-2 text-[12px]">
      <button
        className="flex w-full items-center gap-1.5 text-left font-medium text-[color:var(--foreground)]"
        onClick={() => setOpen((o) => !o)}
      >
        <Wrench className="h-3 w-3 shrink-0 text-[color:var(--label-secondary)]" strokeWidth={2} />
        <span className="flex-1 truncate">{tool.name}</span>
        {props.length > 0 && (
          <span className="ml-auto shrink-0 text-[10px] text-[color:var(--label-secondary)]">
            {paramHint}
          </span>
        )}
        {open ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-[color:var(--label-secondary)]" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-[color:var(--label-secondary)]" />
        )}
      </button>
      {open && (
        <div className="mt-1.5 space-y-1 pl-4">
          {tool.description && (
            <p className="text-[11px] text-[color:var(--label-secondary)]">{tool.description}</p>
          )}
          {props.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {props.map((p) => (
                <span
                  key={p}
                  className="rounded-md bg-[var(--nav-active-fill)] px-1.5 py-0.5 font-mono text-[10px] text-[color:var(--accent)]"
                >
                  {p}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Tab ─────────────────────────────────────────────────────────────────

export default function CapabilitiesMCPTab() {
  const { t, locale } = useTranslation();
  const [servers, setServers] = useState<MCPServer[]>([]);
  const [presetsCatalog, setPresetsCatalog] = useState<MCPPresetRow[]>([]);
  const [presetBusyIds, setPresetBusyIds] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: "", url: "", description: "" });
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [toolsMap, setToolsMap] = useState<Record<string, MCPTool[]>>({});
  const [toolsLoading, setToolsLoading] = useState<Record<string, boolean>>({});
  const pingingRef = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [serversRes, presetsRes] = await Promise.all([
        fetch("/api/mcp/servers"),
        fetch("/api/mcp/presets"),
      ]);
      const serversData = await serversRes.json();
      const presetsData = await presetsRes.json();
      setServers(serversData.servers || []);
      setPresetsCatalog(Array.isArray(presetsData.presets) ? presetsData.presets : []);
    } catch {
      setServers([]);
      setPresetsCatalog([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // ── Add server ──────────────────────────────────────────────────────────────
  const addServer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.url.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/mcp/servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (data.success) {
        setForm({ name: "", url: "", description: "" });
        await load();
        // Auto-ping after add
        if (data.server?.id) pingServer(data.server.id, data.server.url);
      }
    } finally {
      setSaving(false);
    }
  };

  // ── Toggle enabled ──────────────────────────────────────────────────────────
  const toggleServer = async (id: string, enabled: boolean) => {
    await fetch(`/api/mcp/servers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    setServers((prev) =>
      prev.map((s) => (s.id === id ? { ...s, enabled } : s)),
    );
  };

  // ── Delete ──────────────────────────────────────────────────────────────────
  const deleteServer = async (id: string) => {
    if (!confirm(t("settings.mcp.confirmDelete"))) return;
    await fetch(`/api/mcp/servers/${id}`, { method: "DELETE" });
    setServers((prev) => prev.filter((s) => s.id !== id));
    setToolsMap((m) => {
      const next = { ...m };
      delete next[id];
      return next;
    });
  };

  // ── Ping ────────────────────────────────────────────────────────────────────
  const pingServer = useCallback(async (id: string, _url?: string) => {
    if (pingingRef.current.has(id)) return;
    pingingRef.current.add(id);
    setServers((prev) =>
      prev.map((s) => (s.id === id ? { ...s, status: "pinging" } : s)),
    );
    try {
      const res = await fetch(`/api/mcp/servers/${id}/ping`, {
        method: "POST",
      });
      const data = await res.json();
      setServers((prev) =>
        prev.map((s) =>
          s.id === id
            ? {
                ...s,
                status: data.success ? "connected" : "error",
                status_msg: data.error ?? "",
                server_name: data.server_name ?? s.server_name,
                server_version: data.server_version ?? s.server_version,
              }
            : s,
        ),
      );
      // Auto-load tools if connected
      if (data.success) loadTools(id);
    } catch {
      setServers((prev) =>
        prev.map((s) =>
          s.id === id
            ? { ...s, status: "error", status_msg: t("settings.mcp.networkError") }
            : s,
        ),
      );
    } finally {
      pingingRef.current.delete(id);
    }
  }, [t]);

  // ── Load tools ──────────────────────────────────────────────────────────────
  const loadTools = async (id: string) => {
    setToolsLoading((m) => ({ ...m, [id]: true }));
    try {
      const res = await fetch(`/api/mcp/servers/${id}/tools`);
      const data = await res.json();
      setToolsMap((m) => ({ ...m, [id]: data.tools ?? [] }));
    } finally {
      setToolsLoading((m) => ({ ...m, [id]: false }));
    }
  };

  // ── Expand row ──────────────────────────────────────────────────────────────
  const toggleExpand = (id: string) => {
    const next = expandedId === id ? null : id;
    setExpandedId(next);
    if (next && !toolsMap[next] && !toolsLoading[next]) loadTools(next);
  };

  const presetLabelKey = (id: string) => `settings.mcp.presetCatalog.names.${id}`;

  const presetDisplayName = (id: string) => {
    const k = presetLabelKey(id);
    const v = t(k);
    return v === k ? id : v;
  };

  const presetDescription = (p: MCPPresetRow) =>
    locale === "en"
      ? (p.description_en ?? p.description_zh ?? "")
      : (p.description_zh ?? p.description_en ?? "");

  const setPresetBusy = (presetId: string, busy: boolean) => {
    setPresetBusyIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(presetId);
      else next.delete(presetId);
      return next;
    });
  };

  const installPreset = async (presetId: string) => {
    if (presetBusyIds.has(presetId)) return;
    setPresetBusy(presetId, true);
    try {
      const res = await fetch(
        `/api/mcp/presets/${encodeURIComponent(presetId)}/install`,
        { method: "POST" },
      );
      const data = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok) {
        let msg: string =
          typeof data.detail === "string"
            ? data.detail
            : typeof data.error === "string"
              ? data.error
              : res.statusText;
        if (
          typeof data.detail === "object" &&
          data.detail !== null &&
          !msg
        ) {
          msg = JSON.stringify(data.detail);
        }
        window.alert(`${t("settings.mcp.presetCatalog.installFailedTitle")}: ${msg}`);
        return;
      }
      await load();
      const srv = data as {
        server?: { id?: string };
      };
      const sid =
        typeof srv.server?.id === "string"
          ? srv.server.id
          : `mcp-preset-${presetId}`;
      void pingServer(sid);
    } finally {
      setPresetBusy(presetId, false);
    }
  };

  const uninstallPreset = async (presetId: string) => {
    if (!window.confirm(t("settings.mcp.presetCatalog.uninstallConfirm"))) return;
    if (presetBusyIds.has(presetId)) return;
    setPresetBusy(presetId, true);
    try {
      const res = await fetch(
        `/api/mcp/presets/${encodeURIComponent(presetId)}/uninstall`,
        { method: "DELETE" },
      );
      await res.json().catch(() => ({}));
      await load();
    } finally {
      setPresetBusy(presetId, false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2
          className="h-7 w-7 animate-spin text-[color:var(--accent)]"
          strokeWidth={2}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {presetsCatalog.length > 0 && (
        <section className="card-surface rounded-2xl p-5">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <Package className="mt-0.5 h-5 w-5 shrink-0 text-[color:var(--accent)]" strokeWidth={2} />
              <div className="min-w-0">
                <p className="text-[14px] font-semibold text-[color:var(--foreground)]">
                  {t("settings.mcp.presetCatalog.title")}
                </p>
                <p className="mt-0.5 max-w-xl text-[12px] text-[color:var(--label-secondary)]">
                  {t("settings.mcp.presetCatalog.subtitle")}
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {presetsCatalog.map((p) => {
              const busy = presetBusyIds.has(p.id);
              const name = presetDisplayName(p.id);
              const desc = presetDescription(p);

              return (
                <div
                  key={p.id}
                  className="rounded-2xl border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-[13px] font-semibold text-[color:var(--foreground)]">{name}</p>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${p.running ? "bg-[color:rgba(76,217,100,0.15)] text-[color:#34C759]" : "bg-[var(--nav-active-fill)] text-[color:var(--label-secondary)]"}`}>
                          {p.running ? t("settings.mcp.presetCatalog.running") : t("settings.mcp.presetCatalog.stopped")}
                        </span>
                        {p.installed && (
                          <span className="rounded-full bg-[var(--nav-active-fill)] px-2 py-0.5 text-[10px] font-medium text-[color:var(--accent)]">
                            {t("settings.mcp.presetCatalog.registered")}
                          </span>
                        )}
                      </div>
                      {desc && (
                        <p className="mt-1.5 text-[12px] leading-relaxed text-[color:var(--label-secondary)]">
                          {desc}
                        </p>
                      )}
                      {p.url ? (
                        <p className="mt-1 break-all font-mono text-[11px] text-[color:var(--label-secondary)]">
                          {p.url}
                        </p>
                      ) : p.default_port != null ? (
                        <p className="mt-1 font-mono text-[11px] text-[color:var(--label-secondary)]">
                          {(() => {
                            const pathRaw = (p.http_path ?? "/mcp").trim();
                            const pathPrefix = pathRaw.startsWith("/")
                              ? pathRaw
                              : `/${pathRaw}`;
                            return `http://127.0.0.1:${p.default_port}${pathPrefix}`;
                          })()}
                        </p>
                      ) : null}
                      {p.github && (
                        <a
                          href={p.github}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-2 inline-flex items-center gap-1 text-[11px] text-[color:var(--accent)] hover:underline"
                        >
                          <Github className="h-3 w-3 shrink-0" strokeWidth={2} />
                          {t("settings.mcp.presetCatalog.github")}
                        </a>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void installPreset(p.id)}
                      className="flex items-center gap-1.5 rounded-xl bg-[color:var(--accent)] px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm transition-opacity hover:opacity-92 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      {busy ? (
                        <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2.5} />
                      ) : null}
                      {busy ? t("settings.mcp.presetCatalog.installing") : t("settings.mcp.presetCatalog.install")}
                    </button>
                    <button
                      type="button"
                      disabled={busy || (!p.installed && !p.running)}
                      onClick={() => void uninstallPreset(p.id)}
                      className="rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-3 py-1.5 text-[12px] text-[color:var(--foreground)] transition-colors hover:border-[color:rgba(255,59,48,0.45)] hover:text-[color:rgba(255,59,48,0.95)] disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      {t("settings.mcp.presetCatalog.uninstall")}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Add form ──────────────────────────────────────────────────────── */}
      <form
        onSubmit={addServer}
        className="card-surface rounded-2xl p-5"
      >
        <div className="flex flex-wrap gap-3">
          <input
            required
            placeholder="名称"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className="w-36 rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-3 py-2 text-[13px] text-[color:var(--foreground)] focus:border-[color:var(--accent)] focus:outline-none"
          />
          <input
            required
            placeholder={t("settings.mcp.urlPlaceholder")}
            value={form.url}
            onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
            className="min-w-[200px] flex-1 rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-3 py-2 text-[13px] text-[color:var(--foreground)] focus:border-[color:var(--accent)] focus:outline-none"
          />
          <input
            placeholder="描述 (可选)"
            value={form.description}
            onChange={(e) =>
              setForm((f) => ({ ...f, description: e.target.value }))
            }
            className="w-48 rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-3 py-2 text-[13px] text-[color:var(--foreground)] focus:border-[color:var(--accent)] focus:outline-none"
          />
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-1.5 rounded-xl bg-[color:var(--accent)] px-4 py-2 text-[13px] font-semibold text-white shadow-sm transition-opacity hover:opacity-92 disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.5} />
            ) : (
              <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
            )}
            添加服务器
          </button>
        </div>
      </form>

      {/* ── Server list ───────────────────────────────────────────────────── */}
      {servers.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-[color:var(--separator-subtle)] py-16 text-center">
          <Server className="h-10 w-10 text-[color:var(--separator-subtle)]" strokeWidth={1.5} />
          <p className="text-[13px] text-[color:var(--label-secondary)]">暂无 MCP 服务器</p>
          <p className="text-[12px] text-[color:var(--label-secondary)] opacity-80">
            添加支持 MCP 协议的外部工具服务器（HTTP / SSE transport）
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {servers.map((s) => {
            const isExpanded = expandedId === s.id;
            const tools: MCPTool[] = toolsMap[s.id] ?? [];
            const toolsLoaded = !!toolsMap[s.id];
            const status = (s.status ?? "unknown") as ServerStatus;

            return (
              <div
                key={s.id}
                className={`rounded-2xl border shadow-sm transition-all ${
                  s.enabled
                    ? "border-[color:rgba(255,149,0,0.2)] bg-[var(--card-bg)]"
                    : "border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] opacity-75"
                }`}
              >
                {/* Header row */}
                <div className="flex items-center gap-3 px-4 py-3.5">
                  {/* Expand toggle */}
                  <button
                    type="button"
                    onClick={() => toggleExpand(s.id)}
                    className="shrink-0 text-[color:var(--label-secondary)] hover:text-[color:var(--foreground)]"
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4" strokeWidth={2} />
                    ) : (
                      <ChevronRight className="h-4 w-4" strokeWidth={2} />
                    )}
                  </button>

                  {/* Status dot */}
                  <StatusDot status={status} />

                  {/* Info */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-[13px] font-semibold text-[color:var(--foreground)]">
                        {s.name}
                      </p>
                      {s.server_name && (
                        <span className="shrink-0 rounded-md bg-[var(--nav-active-fill)] px-1.5 py-0.5 text-[10px] text-[color:var(--label-secondary)]">
                          {s.server_name}
                          {s.server_version ? ` v${s.server_version}` : ""}
                        </span>
                      )}
                      {toolsLoaded && tools.length > 0 && (
                        <span className="shrink-0 rounded-md bg-[var(--nav-active-fill)] px-1.5 py-0.5 text-[10px] font-medium text-[color:var(--accent)]">
                          {t("settings.mcp.toolsBadge", { count: tools.length })}
                        </span>
                      )}
                    </div>
                    <p className="truncate text-[11px] text-[color:var(--label-secondary)]">
                      {s.url}
                    </p>
                    {status === "error" && s.status_msg && (
                      <p className="mt-0.5 truncate text-[11px] text-red-400">
                        {s.status_msg}
                      </p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex shrink-0 items-center gap-2">
                    {/* Ping button */}
                    <button
                      type="button"
                      onClick={() => pingServer(s.id)}
                      disabled={status === "pinging"}
                      title="测试连接"
                      className="rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-2 py-1.5 text-[11px] text-[color:var(--label-secondary)] hover:border-[color:var(--accent)] hover:text-[color:var(--accent)] disabled:opacity-50"
                    >
                      {status === "pinging" ? (
                        <Loader2
                          className="h-3.5 w-3.5 animate-spin"
                          strokeWidth={2.5}
                        />
                      ) : (
                        <Unplug className="h-3.5 w-3.5" strokeWidth={2} />
                      )}
                    </button>

                    {/* Enable toggle */}
                    <button
                      type="button"
                      role="switch"
                      aria-checked={s.enabled}
                      onClick={() => toggleServer(s.id, !s.enabled)}
                      title={s.enabled ? "禁用" : "启用"}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
                        s.enabled ? "bg-[color:var(--accent)]" : "bg-[color:var(--separator-subtle)]"
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow ring-0 transition-transform duration-200 ${
                          s.enabled ? "translate-x-4" : "translate-x-0"
                        }`}
                      />
                    </button>

                    {/* Delete */}
                    <button
                      type="button"
                      onClick={() => deleteServer(s.id)}
                      title="删除"
                      className="rounded-xl border border-[color:rgba(255,59,48,0.35)] bg-[color:rgba(255,59,48,0.06)] p-1.5 text-[color:rgba(255,59,48,0.9)] hover:bg-[color:rgba(255,59,48,0.1)]"
                    >
                      <X className="h-3.5 w-3.5" strokeWidth={2.5} />
                    </button>
                  </div>
                </div>

                {/* Expanded tools panel */}
                {isExpanded && (
                  <div className="border-t border-[color:var(--separator-subtle)] px-4 pb-4 pt-3">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-[color:var(--label-secondary)]">
                        可用工具
                      </p>
                      <button
                        type="button"
                        onClick={() => loadTools(s.id)}
                        disabled={toolsLoading[s.id]}
                        className="flex items-center gap-1 rounded-lg border border-[color:var(--separator-subtle)] px-2 py-1 text-[11px] text-[color:var(--label-secondary)] hover:border-[color:var(--accent)] hover:text-[color:var(--accent)] disabled:opacity-50"
                      >
                        <RefreshCw
                          className={`h-3 w-3 ${toolsLoading[s.id] ? "animate-spin" : ""}`}
                          strokeWidth={2}
                        />
                        刷新
                      </button>
                    </div>

                    {toolsLoading[s.id] ? (
                      <div className="flex items-center gap-2 py-4 text-[12px] text-[color:var(--label-secondary)]">
                        <Loader2
                          className="h-4 w-4 animate-spin"
                          strokeWidth={2}
                        />
                        正在加载工具…
                      </div>
                    ) : tools.length === 0 ? (
                      <div className="flex items-center gap-2 py-4 text-[12px] text-[color:var(--label-secondary)]">
                        <AlertCircle
                          className="h-4 w-4 text-[color:var(--separator-subtle)]"
                          strokeWidth={2}
                        />
                        {status === "error"
                          ? "服务器不可达，无法获取工具列表"
                          : "无工具（点击「测试连接」后重试）"}
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                        {tools.map((toolItem) => (
                          <ToolBadge key={toolItem.name} tool={toolItem} />
                        ))}
                      </div>
                    )}

                    {s.description && (
                      <p className="mt-3 text-[11px] text-[color:var(--label-secondary)]">
                        {s.description}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Footer note ───────────────────────────────────────────────────── */}
      <p className="text-[11px] text-[color:var(--label-secondary)]">
        已启用服务器的工具会自动注入到 Agent 的工具链中。支持 MCP Streamable
        HTTP 及 SSE transport（协议版本 2024-11-05）。
      </p>
    </div>
  );
}
