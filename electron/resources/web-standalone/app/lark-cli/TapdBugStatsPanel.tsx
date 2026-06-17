"use client";

import {
  downloadBlobFile,
  exportTapdStatsReport,
  type TapdExportFormat,
} from "@/app/lark-cli/tapd-bug-utils";
import { parseJsonResponse } from "@/lib/apiJson";
import { useCallback, useEffect, useMemo, useState } from "react";

type TapdStatus = {
  configured?: boolean;
  workspace_id?: string;
  web_base?: string;
};

type StatRow = {
  key: string;
  label: string;
  count: number;
  percent: number;
};

type BugRow = {
  id: string;
  title: string;
  status: string;
  status_label: string;
  priority: string;
  priority_label: string;
  current_owner: string;
  reporter: string;
  created: string;
  url: string;
  is_closed?: boolean;
};

type StatsPayload = {
  ok?: boolean;
  error?: string;
  workspace_id?: string;
  web_base?: string;
  range?: {
    days?: number | null;
    created_start?: string | null;
    created_end?: string | null;
  };
  summary?: {
    total_in_range: number;
    total_all: number;
    open: number;
    closed: number;
    open_rate: number;
  };
  by_status?: StatRow[];
  by_priority?: StatRow[];
  by_owner?: StatRow[];
  by_reporter?: StatRow[];
  recent_bugs?: BugRow[];
};

type AnalysisMode = "summary" | "deep";

const CONTENT_CLASS = "mx-auto w-full max-w-7xl";

const RANGE_PRESETS = [
  { id: "7", label: "近 7 天", days: 7 },
  { id: "30", label: "近 30 天", days: 30 },
  { id: "90", label: "近 90 天", days: 90 },
  { id: "all", label: "全部", days: 0 },
] as const;

const EXPORT_FORMATS: { id: TapdExportFormat; label: string; hint: string }[] = [
  { id: "md", label: "Markdown", hint: ".md" },
  { id: "pdf", label: "PDF", hint: ".pdf" },
  { id: "excel", label: "Excel", hint: ".xlsx" },
  { id: "ppt", label: "PPT", hint: ".pptx" },
];

const PRIORITY_BADGE: Record<string, string> = {
  urgent: "bg-red-100 text-red-800",
  high: "bg-orange-100 text-orange-800",
  medium: "bg-blue-100 text-blue-800",
  low: "bg-slate-100 text-slate-600",
  unset: "bg-slate-50 text-slate-500",
};

const STATUS_BADGE: Record<string, string> = {
  new: "bg-sky-100 text-sky-800",
  in_progress: "bg-amber-100 text-amber-800",
  resolved: "bg-emerald-100 text-emerald-800",
  closed: "bg-slate-100 text-slate-600",
  suspended: "bg-violet-100 text-violet-800",
  rejected: "bg-rose-100 text-rose-800",
};

function StatCard({
  label,
  value,
  hint,
  accent = "text-slate-900",
}: {
  label: string;
  value: string | number;
  hint?: string;
  accent?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-100 bg-white p-4 sm:p-5">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${accent}`}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-slate-400">{hint}</p> : null}
    </div>
  );
}

function DistributionTable({
  title,
  rows,
  emptyText = "暂无数据",
}: {
  title: string;
  rows: StatRow[];
  emptyText?: string;
}) {
  const max = rows[0]?.count ?? 1;
  return (
    <div className="rounded-xl border border-slate-100 bg-white p-4 sm:p-5">
      <h4 className="text-sm font-semibold text-slate-900">{title}</h4>
      {!rows.length ? (
        <p className="mt-4 text-sm text-slate-400">{emptyText}</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {rows.map((row) => (
            <li key={row.key}>
              <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                <span className="truncate text-slate-700">{row.label}</span>
                <span className="shrink-0 tabular-nums text-slate-500">
                  {row.count}
                  <span className="ml-1 text-xs text-slate-400">({row.percent}%)</span>
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-indigo-500/80 transition-all"
                  style={{ width: `${Math.max(4, (row.count / max) * 100)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BugListPanel({
  rangeDays,
  webBase,
  statusOptions,
  priorityOptions,
}: {
  rangeDays: number;
  webBase: string;
  statusOptions: StatRow[];
  priorityOptions: StatRow[];
}) {
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [keyword, setKeyword] = useState("");
  const [debouncedKeyword, setDebouncedKeyword] = useState("");
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [owner, setOwner] = useState("");
  const [reporter, setReporter] = useState("");
  const [closure, setClosure] = useState<"all" | "open" | "closed">("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [rows, setRows] = useState<BugRow[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedKeyword(keyword.trim()), 350);
    return () => window.clearTimeout(t);
  }, [keyword]);

  useEffect(() => {
    setPage(1);
  }, [rangeDays, debouncedKeyword, status, priority, owner, reporter, closure, limit]);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const qs = new URLSearchParams({
        page: String(page),
        limit: String(limit),
        range_days: String(rangeDays),
      });
      if (debouncedKeyword) qs.set("keyword", debouncedKeyword);
      if (status) qs.set("status", status);
      if (priority) qs.set("priority", priority);
      if (owner.trim()) qs.set("current_owner", owner.trim());
      if (reporter.trim()) qs.set("reporter", reporter.trim());
      if (closure === "open") qs.set("open_only", "true");
      if (closure === "closed") qs.set("closed_only", "true");

      const res = await fetch(`/api/tapd/bugs?${qs}`, { cache: "no-store" });
      const data = await parseJsonResponse<{
        ok?: boolean;
        error?: string;
        bugs?: BugRow[];
        total?: number;
        total_pages?: number;
        truncated?: boolean;
      }>(res);
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setRows(data.bugs || []);
      setTotal(data.total ?? 0);
      setTotalPages(data.total_pages ?? 0);
      setTruncated(!!data.truncated);
    } catch (e: unknown) {
      setRows([]);
      setTotal(0);
      setTotalPages(0);
      setError(e instanceof Error ? e.message : "加载列表失败");
    } finally {
      setLoading(false);
    }
  }, [page, limit, rangeDays, debouncedKeyword, status, priority, owner, reporter, closure]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const pageNumbers = useMemo(() => {
    const maxButtons = 7;
    if (totalPages <= maxButtons) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    const start = Math.max(1, Math.min(page - 3, totalPages - maxButtons + 1));
    return Array.from({ length: maxButtons }, (_, i) => start + i);
  }, [page, totalPages]);

  return (
    <div className="mt-5 rounded-xl border border-slate-100 bg-white p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold text-slate-900">缺陷列表</h4>
          <p className="mt-0.5 text-xs text-slate-500">
            支持分页、模糊搜索与筛选
            {total ? ` · 共 ${total} 条` : ""}
            {truncated ? " · 数据量较大，部分结果被截断" : ""}
          </p>
        </div>
        <button
          type="button"
          disabled={loading}
          onClick={() => void loadList()}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          {loading ? "加载中…" : "刷新列表"}
        </button>
      </div>

      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="模糊搜索标题 / ID / 人员…"
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 sm:col-span-2 lg:col-span-2 xl:col-span-2"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-indigo-400 focus:outline-none"
        >
          <option value="">全部状态</option>
          {statusOptions.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label} ({s.count})
            </option>
          ))}
        </select>
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-indigo-400 focus:outline-none"
        >
          <option value="">全部优先级</option>
          {priorityOptions.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label} ({p.count})
            </option>
          ))}
        </select>
        <select
          value={closure}
          onChange={(e) => setClosure(e.target.value as "all" | "open" | "closed")}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-indigo-400 focus:outline-none"
        >
          <option value="all">开闭：全部</option>
          <option value="open">仅未关闭</option>
          <option value="closed">仅已关闭</option>
        </select>
        <input
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
          placeholder="处理人"
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none"
        />
        <input
          value={reporter}
          onChange={(e) => setReporter(e.target.value)}
          placeholder="报告人"
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none"
        />
      </div>

      {error ? (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <BugTable bugs={rows} webBase={webBase} loading={loading && !rows.length} />

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span>每页</span>
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="rounded border border-slate-200 px-2 py-1 text-slate-700"
          >
            {[20, 50, 100, 200].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <span>
            第 {page} / {totalPages || 1} 页
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            disabled={loading || page <= 1}
            onClick={() => setPage(1)}
            className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          >
            首页
          </button>
          <button
            type="button"
            disabled={loading || page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          >
            上一页
          </button>
          {pageNumbers.map((n) => (
            <button
              key={n}
              type="button"
              disabled={loading}
              onClick={() => setPage(n)}
              className={`min-w-[2rem] rounded border px-2 py-1 text-xs ${
                n === page
                  ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                  : "border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
            >
              {n}
            </button>
          ))}
          <button
            type="button"
            disabled={loading || page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages || 1, p + 1))}
            className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          >
            下一页
          </button>
          <button
            type="button"
            disabled={loading || page >= totalPages}
            onClick={() => setPage(totalPages || 1)}
            className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          >
            末页
          </button>
        </div>
      </div>
    </div>
  );
}

function BugTable({
  bugs,
  webBase,
  loading = false,
}: {
  bugs: BugRow[];
  webBase: string;
  loading?: boolean;
}) {
  if (loading) {
    return (
      <p className="py-8 text-center text-sm text-slate-400">正在加载缺陷列表…</p>
    );
  }
  if (!bugs.length) {
    return (
      <p className="py-8 text-center text-sm text-slate-400">没有匹配的缺陷记录</p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead>
          <tr className="border-b border-slate-100 text-xs text-slate-500">
            <th className="px-2 py-2 font-medium whitespace-nowrap">ID</th>
            <th className="px-2 py-2 font-medium">标题</th>
            <th className="px-2 py-2 font-medium whitespace-nowrap">状态</th>
            <th className="px-2 py-2 font-medium whitespace-nowrap">优先级</th>
            <th className="px-2 py-2 font-medium whitespace-nowrap">处理人</th>
            <th className="px-2 py-2 font-medium whitespace-nowrap">报告人</th>
            <th className="px-2 py-2 font-medium whitespace-nowrap">创建时间</th>
          </tr>
        </thead>
        <tbody>
          {bugs.map((bug) => {
            const href = bug.url;
            const pKey = bug.priority || "unset";
            const sKey = bug.status || "unknown";
            return (
              <tr
                key={bug.id}
                className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60"
              >
                <td className="px-2 py-2.5 whitespace-nowrap text-xs text-slate-400 tabular-nums">
                  {bug.id?.slice(-8) || "—"}
                </td>
                <td className="max-w-md px-2 py-2.5">
                  {href ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="line-clamp-2 font-medium text-indigo-700 hover:underline"
                    >
                      {bug.title || `#${bug.id}`}
                    </a>
                  ) : (
                    <span className="line-clamp-2 text-slate-800">
                      {bug.title || `#${bug.id}`}
                    </span>
                  )}
                </td>
                <td className="px-2 py-2.5 whitespace-nowrap">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                      STATUS_BADGE[sKey] || "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {bug.status_label || bug.status}
                  </span>
                </td>
                <td className="px-2 py-2.5 whitespace-nowrap">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                      PRIORITY_BADGE[pKey] || PRIORITY_BADGE.unset
                    }`}
                  >
                    {bug.priority_label || "未设置"}
                  </span>
                </td>
                <td className="px-2 py-2.5 whitespace-nowrap text-slate-600">
                  {bug.current_owner}
                </td>
                <td className="px-2 py-2.5 whitespace-nowrap text-slate-600">
                  {bug.reporter}
                </td>
                <td className="px-2 py-2.5 whitespace-nowrap text-slate-500 tabular-nums">
                  {bug.created?.slice(0, 16) || "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function TapdBugStatsPanel() {
  const [status, setStatus] = useState<TapdStatus | null>(null);
  const [stats, setStats] = useState<StatsPayload | null>(null);
  const [rangeId, setRangeId] = useState<(typeof RANGE_PRESETS)[number]["id"]>("30");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState<TapdExportFormat | null>(null);
  const [exportError, setExportError] = useState("");
  const [withAi, setWithAi] = useState(true);
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>("summary");
  const [userNote, setUserNote] = useState("");

  const rangeDays = useMemo(
    () => RANGE_PRESETS.find((r) => r.id === rangeId)?.days ?? 30,
    [rangeId],
  );

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/tapd/status", { cache: "no-store" });
      const data = await parseJsonResponse<TapdStatus & { ok?: boolean }>(res);
      setStatus(data);
    } catch {
      setStatus({ configured: false });
    }
  }, []);

  const loadStats = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const qs = new URLSearchParams({ range_days: String(rangeDays) });
      const res = await fetch(`/api/tapd/bugs/stats?${qs}`, { cache: "no-store" });
      const data = await parseJsonResponse<StatsPayload>(res);
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setStats(data);
    } catch (e: unknown) {
      setStats(null);
      setError(e instanceof Error ? e.message : "加载统计失败");
    } finally {
      setLoading(false);
    }
  }, [rangeDays]);

  const handleExport = useCallback(
    async (format: TapdExportFormat) => {
      setExporting(format);
      setExportError("");
      try {
        const { filename, blob } = await exportTapdStatsReport({
          format,
          rangeDays,
          withAi,
          mode: analysisMode,
          userNote,
        });
        downloadBlobFile(filename, blob);
        setExportOpen(false);
      } catch (e: unknown) {
        setExportError(e instanceof Error ? e.message : "导出失败");
      } finally {
        setExporting(null);
      }
    },
    [rangeDays, withAi, analysisMode, userNote],
  );

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (status?.configured) {
      void loadStats();
    }
  }, [status?.configured, loadStats]);

  const summary = stats?.summary;
  const webBase = stats?.web_base || status?.web_base || "https://www.tapd.cn";
  const workspaceId = stats?.workspace_id || status?.workspace_id || "";

  const rangeLabel = useMemo(() => {
    if (stats?.range?.created_start || stats?.range?.created_end) {
      return `${stats.range.created_start || "…"} ~ ${stats.range.created_end || "…"}`;
    }
    if (rangeDays === 0) return "全部时间";
    return `近 ${rangeDays} 天`;
  }, [stats?.range, rangeDays]);

  if (status && !status.configured) {
    return (
      <div className={`${CONTENT_CLASS} px-4 py-8 sm:px-6 lg:px-8`}>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
          <p className="font-semibold">TAPD 未配置</p>
          <p className="mt-2 text-amber-800/90">
            请在 backend/.env 中配置 TAPD_WORKSPACE_ID 与 TAPD_ACCESS_TOKEN（或 Basic Auth），然后重启后端。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`${CONTENT_CLASS} flex min-h-0 flex-1 flex-col`}>
      <div className="shrink-0 border-b border-slate-200/80 bg-white px-4 py-4 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">TAPD 缺陷统计</h2>
            <p className="mt-1 text-sm text-slate-500">
              工作区 {workspaceId || "—"} · {rangeLabel}
              {summary ? ` · 范围内 ${summary.total_in_range} 条` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
              {RANGE_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  disabled={loading || !!exporting}
                  onClick={() => setRangeId(preset.id)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    rangeId === preset.id
                      ? "bg-white text-indigo-700 shadow-sm"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={loading || !!exporting}
              onClick={() => void loadStats()}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {loading ? "刷新中…" : "刷新"}
            </button>
            <button
              type="button"
              disabled={loading || !!exporting || !stats}
              onClick={() => {
                setExportError("");
                setExportOpen((v) => !v);
              }}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              导出报告
            </button>
            {workspaceId ? (
              <a
                href={`${webBase}/${workspaceId}/bugtrace/bugs/view`}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
              >
                打开 TAPD
              </a>
            ) : null}
          </div>
        </div>

        {exportOpen ? (
          <div className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50/40 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">导出统计报告</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  当前范围：{rangeLabel} · AI 整理后导出为可读报告
                </p>
              </div>
              <button
                type="button"
                onClick={() => setExportOpen(false)}
                className="text-xs text-slate-500 hover:text-slate-800"
              >
                收起
              </button>
            </div>

            <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={withAi}
                onChange={(e) => setWithAi(e.target.checked)}
                className="rounded border-slate-300"
              />
              导出前 AI 整理报告（推荐，PDF/PPT 为可读排版）
            </label>

            {withAi ? (
              <p className="mt-1 text-xs text-slate-500">
                AI 将统计数据整理为执行摘要、洞察与建议，而非原始表格 dump
              </p>
            ) : (
              <p className="mt-1 text-xs text-amber-600">
                关闭后将使用模板摘要；Excel 仍含明细数据表
              </p>
            )}

            {withAi ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {(
                  [
                    { id: "summary" as const, label: "简明总结" },
                    { id: "deep" as const, label: "深度分析" },
                  ] as const
                ).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setAnalysisMode(m.id)}
                    className={`rounded-md px-3 py-1 text-xs font-medium ${
                      analysisMode === m.id
                        ? "bg-white text-indigo-700 ring-1 ring-indigo-200"
                        : "bg-white/60 text-slate-600 hover:bg-white"
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            ) : null}

            <textarea
              value={userNote}
              onChange={(e) => setUserNote(e.target.value)}
              placeholder="导出说明或分析侧重点（可选）"
              rows={2}
              className="mt-3 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            />

            <div className="mt-3 flex flex-wrap gap-2">
              {EXPORT_FORMATS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  disabled={!!exporting}
                  onClick={() => void handleExport(f.id)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:border-indigo-300 hover:text-indigo-700 disabled:opacity-50"
                >
                  {exporting === f.id ? "生成中…" : f.label}
                  <span className="text-slate-400">{f.hint}</span>
                </button>
              ))}
            </div>

            {exportError ? (
              <p className="mt-2 text-sm text-red-600">{exportError}</p>
            ) : null}
            {exporting ? (
              <p className="mt-2 text-xs text-indigo-600">
                {withAi ? "正在拉取统计并生成 AI 分析，请稍候…" : "正在生成报告…"}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 lg:px-8">
        {error ? (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        ) : null}

        {loading && !stats ? (
          <div className="flex items-center justify-center py-20 text-sm text-slate-500">
            正在加载统计数据…
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:gap-4">
              <StatCard
                label="范围内缺陷"
                value={summary?.total_in_range ?? "—"}
                hint={`工作区总计 ${summary?.total_all ?? "—"} 条`}
              />
              <StatCard
                label="未关闭"
                value={summary?.open ?? "—"}
                accent="text-amber-700"
                hint={summary ? `占比 ${summary.open_rate}%` : undefined}
              />
              <StatCard
                label="已关闭"
                value={summary?.closed ?? "—"}
                accent="text-emerald-700"
              />
              <StatCard
                label="关闭率"
                value={
                  summary && summary.total_in_range
                    ? `${Math.round((summary.closed / summary.total_in_range) * 100)}%`
                    : "—"
                }
                hint="范围内已关闭 / 总量"
              />
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <DistributionTable title="按状态" rows={stats?.by_status ?? []} />
              <DistributionTable title="按优先级" rows={stats?.by_priority ?? []} />
              <DistributionTable
                title="按处理人（Top）"
                rows={(stats?.by_owner ?? []).slice(0, 10)}
              />
              <DistributionTable
                title="按报告人（Top）"
                rows={(stats?.by_reporter ?? []).slice(0, 10)}
              />
            </div>

            <BugListPanel
              rangeDays={rangeDays}
              webBase={webBase}
              statusOptions={stats?.by_status ?? []}
              priorityOptions={stats?.by_priority ?? []}
            />
          </>
        )}
      </div>
    </div>
  );
}
