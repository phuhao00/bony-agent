"use client";

import {
  OpsCard,
  OpsSectionTitle,
  StatusPill,
  buildResultTone,
  formatDuration,
  useOpsToast,
} from "@/app/lark-cli/ops/ui";
import { useCallback, useEffect, useMemo, useState } from "react";

type JobParam = {
  name: string;
  default?: string;
  choices?: string[];
};

type JenkinsBuild = {
  number?: number;
  url?: string;
  result?: string | null;
  building?: boolean;
  duration?: number;
  timestamp?: number;
};

type JenkinsJob = {
  ok?: boolean;
  name?: string;
  label?: string;
  url?: string;
  error?: string;
  parameters?: JobParam[];
  last_build?: JenkinsBuild;
};

type JenkinsHealth = {
  ok?: boolean;
  error?: string;
  url?: string;
  allowed_job_count?: number;
};

function maskHost(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export default function JenkinsPipeline({
  onOpenSettings,
}: {
  onOpenSettings?: () => void;
}) {
  const { push, ToastStack } = useOpsToast();
  const [health, setHealth] = useState<JenkinsHealth | null>(null);
  const [jobs, setJobs] = useState<JenkinsJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [builds, setBuilds] = useState<JenkinsBuild[]>([]);
  const [buildsLoading, setBuildsLoading] = useState(false);
  const [activeBuild, setActiveBuild] = useState<number | null>(null);
  const [consoleText, setConsoleText] = useState("");
  const [consoleLoading, setConsoleLoading] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [triggerParams, setTriggerParams] = useState<Record<string, string>>({});
  const [triggerBusy, setTriggerBusy] = useState(false);

  const selected = useMemo(
    () => jobs.find((j) => j.name === selectedName) ?? null,
    [jobs, selectedName],
  );

  const anyBuilding = useMemo(
    () =>
      jobs.some((j) => j.last_build?.building) ||
      builds.some((b) => b.building),
    [jobs, builds],
  );

  const refreshJobs = useCallback(async (toastOnError = false) => {
    setLoading(true);
    try {
      const hRes = await fetch("/api/feishu/ops/jenkins/health", {
        cache: "no-store",
      });
      const h = await hRes.json();
      setHealth(h);

      if (!h.ok) {
        setJobs([]);
        setSelectedName(null);
        setBuilds([]);
        setActiveBuild(null);
        setConsoleText("");
        if (toastOnError) {
          push("error", h.error || "Jenkins 未连接");
        }
        return;
      }

      const jRes = await fetch("/api/feishu/ops/jenkins/jobs", {
        cache: "no-store",
      });
      const j = await jRes.json();
      const list: JenkinsJob[] = Array.isArray(j.jobs) ? j.jobs : [];
      setJobs(list);
      setSelectedName((prev) => prev ?? list[0]?.name ?? null);
      if (!j.ok && toastOnError) {
        push("error", j.error || "加载流水线失败");
      }
    } catch (e) {
      if (toastOnError) push("error", String(e));
    } finally {
      setLoading(false);
    }
  }, [push]);

  const loadBuilds = useCallback(
    async (jobName: string, silent = false) => {
      if (!silent) setBuildsLoading(true);
      try {
        const res = await fetch(
          `/api/feishu/ops/jenkins/builds?job_name=${encodeURIComponent(jobName)}&limit=12`,
          { cache: "no-store" },
        );
        const d = await res.json();
        if (d.ok) {
          setBuilds(d.builds || []);
          setActiveBuild((prev) => {
            if (prev && d.builds?.some((b: JenkinsBuild) => b.number === prev)) {
              return prev;
            }
            return d.builds?.[0]?.number ?? null;
          });
        } else if (!silent) {
          push("error", d.error || "加载构建历史失败");
        }
      } catch (e) {
        if (!silent) push("error", String(e));
      } finally {
        if (!silent) setBuildsLoading(false);
      }
    },
    [push],
  );

  const loadConsole = useCallback(
    async (jobName: string, buildNumber: number) => {
      setActiveBuild(buildNumber);
      setConsoleLoading(true);
      try {
        const res = await fetch(
          `/api/feishu/ops/jenkins/console?job_name=${encodeURIComponent(jobName)}&build_number=${buildNumber}`,
          { cache: "no-store" },
        );
        const d = await res.json();
        if (d.ok) {
          setConsoleText(d.text || "(空日志)");
        } else {
          push("error", d.error || "加载日志失败");
        }
      } catch (e) {
        push("error", String(e));
      } finally {
        setConsoleLoading(false);
      }
    },
    [push],
  );

  useEffect(() => {
    void refreshJobs(false);
    // 仅挂载时拉取一次；勿把会变的回调放进依赖，避免重复请求
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!health?.ok || !selectedName) return;
    loadBuilds(selectedName);
  }, [health?.ok, selectedName, loadBuilds]);

  useEffect(() => {
    if (!health?.ok || !selectedName || !activeBuild) return;
    loadConsole(selectedName, activeBuild);
  }, [health?.ok, selectedName, activeBuild, loadConsole]);

  useEffect(() => {
    if (!health?.ok || !anyBuilding || !selectedName) return;
    const id = setInterval(() => {
      void refreshJobs(false);
      loadBuilds(selectedName, true);
    }, 8000);
    return () => clearInterval(id);
  }, [health?.ok, anyBuilding, selectedName, refreshJobs, loadBuilds]);

  const openRunDrawer = () => {
    if (!selected) return;
    const params: Record<string, string> = {};
    for (const p of selected.parameters || []) {
      if (p.name) params[p.name] = String(p.default ?? "");
    }
    setTriggerParams(params);
    setDrawerOpen(true);
  };

  const runTrigger = async () => {
    const job = selected?.name;
    if (!job) return;
    setTriggerBusy(true);
    try {
      const res = await fetch("/api/feishu/ops/jenkins/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_name: job,
          build_params: triggerParams,
          wait_for_start: true,
        }),
      });
      const d = await res.json();
      if (d.ok) {
        push(
          "ok",
          `已触发 ${selected?.label || job}${d.build_number ? ` #${d.build_number}` : ""}`,
        );
        setDrawerOpen(false);
        await refreshJobs();
        await loadBuilds(job);
        if (d.build_number) {
          setActiveBuild(d.build_number);
        }
      } else {
        push("error", d.error || "触发失败");
      }
    } catch (e) {
      push("error", String(e));
    } finally {
      setTriggerBusy(false);
    }
  };

  if (!health?.ok && !loading) {
    return (
      <OpsCard className="py-8 px-5">
        <div className="max-w-lg mx-auto text-center">
          <StatusPill tone="error">未连接</StatusPill>
          <p
            className="text-sm font-medium mt-3"
            style={{ color: "var(--foreground)" }}
          >
            Jenkins 尚未配置或无法连接
          </p>
          {health?.error && (
            <p className="text-xs mt-2 px-3 py-2 rounded-lg bg-rose-500/10 text-rose-800 dark:text-rose-200">
              {health.error}
            </p>
          )}
          <ol
            className="text-xs mt-4 text-left space-y-2 list-decimal list-inside"
            style={{ color: "var(--label-secondary)" }}
          >
            <li>
              在 <code className="text-[11px]">backend/.env</code> 设置{" "}
              <code className="text-[11px]">JENKINS_URL</code>、{" "}
              <code className="text-[11px]">JENKINS_USER</code>、{" "}
              <code className="text-[11px]">JENKINS_API_TOKEN</code>
            </li>
            <li>
              打开上方 <strong>流水线配置</strong> 页添加白名单 Job，或编辑{" "}
              <code className="text-[11px]">storage/meal/feishu_config.json</code>
            </li>
            <li>保存后无需重启后端，点下方重试连接</li>
          </ol>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {onOpenSettings && (
              <button
                type="button"
                onClick={onOpenSettings}
                className="px-4 py-2 text-sm rounded-lg border border-[var(--accent)] text-[var(--accent)]"
              >
                去配置流水线
              </button>
            )}
            <button
              type="button"
              onClick={() => void refreshJobs(true)}
              disabled={loading}
              className="px-4 py-2 text-sm rounded-lg bg-[var(--accent)] text-white disabled:opacity-50"
            >
              {loading ? "检查中…" : "重试连接"}
            </button>
          </div>
        </div>
        <ToastStack />
      </OpsCard>
    );
  }

  return (
    <div className="flex flex-col gap-3 min-h-[420px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs" style={{ color: "var(--label-secondary)" }}>
          <StatusPill tone={health?.ok ? "ok" : "error"}>
            {health?.ok ? "已连接" : "断开"}
          </StatusPill>
          {health?.url && <span>{maskHost(health.url)}</span>}
          {health?.allowed_job_count != null && (
            <span>{health.allowed_job_count} 个流水线</span>
          )}
          {anyBuilding && (
            <StatusPill tone="running">有任务构建中 · 自动刷新</StatusPill>
          )}
        </div>
        <button
          type="button"
          onClick={() => void refreshJobs(true)}
          disabled={loading}
          className="text-xs px-3 py-1.5 rounded-lg border border-[var(--separator-subtle)] hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50"
          style={{ color: "var(--foreground)" }}
        >
          {loading ? "刷新中…" : "刷新"}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(200px,260px)_1fr] gap-3 flex-1 min-h-0">
        {/* 左侧 Job 列表 */}
        <OpsCard className="p-0 overflow-hidden flex flex-col max-h-[520px]">
          <div
            className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide border-b border-[var(--separator-subtle)]"
            style={{ color: "var(--label-secondary)" }}
          >
            流水线
          </div>
          <ul className="overflow-y-auto flex-1 divide-y divide-[var(--separator-subtle)]">
            {jobs.map((j) => {
              const active = j.name === selectedName;
              const lb = j.last_build;
              const tone = buildResultTone(lb?.building, lb?.result);
              return (
                <li key={j.name}>
                  <button
                    type="button"
                    onClick={() => j.name && setSelectedName(j.name)}
                    className={`w-full text-left px-3 py-3 transition-colors ${
                      active ? "bg-[var(--accent)]/10" : "hover:bg-black/5 dark:hover:bg-white/5"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p
                          className="text-sm font-medium truncate"
                          style={{ color: "var(--foreground)" }}
                        >
                          {j.label || j.name}
                        </p>
                        <p
                          className="text-[11px] font-mono truncate mt-0.5"
                          style={{ color: "var(--label-secondary)" }}
                        >
                          {j.name}
                        </p>
                      </div>
                      {lb?.number ? (
                        <StatusPill tone={tone}>
                          #{lb.number}
                        </StatusPill>
                      ) : (
                        <StatusPill tone="neutral">—</StatusPill>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </OpsCard>

        {/* 右侧详情 */}
        <div className="flex flex-col gap-3 min-h-0">
          {selected ? (
            <>
              <OpsCard>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h4
                      className="text-base font-semibold"
                      style={{ color: "var(--foreground)" }}
                    >
                      {selected.label || selected.name}
                    </h4>
                    {selected.error && (
                      <p className="text-xs text-rose-600 mt-1">{selected.error}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {selected.url && (
                      <a
                        href={selected.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs px-3 py-2 rounded-lg border border-[var(--separator-subtle)]"
                        style={{ color: "var(--foreground)" }}
                      >
                        在 Jenkins 打开
                      </a>
                    )}
                    <button
                      type="button"
                      disabled={!selected.ok}
                      onClick={openRunDrawer}
                      className="text-xs px-4 py-2 rounded-lg font-medium bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-40"
                    >
                      运行构建
                    </button>
                  </div>
                </div>
              </OpsCard>

              <OpsCard className="flex-1 min-h-0 flex flex-col p-0 overflow-hidden">
                <div
                  className="px-3 py-2 border-b border-[var(--separator-subtle)] flex items-center justify-between"
                  style={{ color: "var(--label-secondary)" }}
                >
                  <span className="text-[11px] font-semibold uppercase tracking-wide">
                    构建历史
                  </span>
                  {buildsLoading && (
                    <span className="text-[11px]">加载中…</span>
                  )}
                </div>
                <div className="overflow-auto flex-1 max-h-[200px]">
                  <table className="w-full text-xs">
                    <thead>
                      <tr
                        className="text-left border-b border-[var(--separator-subtle)]"
                        style={{ color: "var(--label-secondary)" }}
                      >
                        <th className="px-3 py-2 font-medium">#</th>
                        <th className="px-3 py-2 font-medium">状态</th>
                        <th className="px-3 py-2 font-medium">耗时</th>
                        <th className="px-3 py-2 font-medium w-16" />
                      </tr>
                    </thead>
                    <tbody>
                      {builds.map((b) => {
                        const rowActive = b.number === activeBuild;
                        const tone = buildResultTone(b.building, b.result);
                        return (
                          <tr
                            key={b.number}
                            className={`border-b border-[var(--separator-subtle)] cursor-pointer ${
                              rowActive ? "bg-[var(--accent)]/8" : "hover:bg-black/5 dark:hover:bg-white/5"
                            }`}
                            onClick={() =>
                              selectedName &&
                              b.number &&
                              loadConsole(selectedName, b.number)
                            }
                          >
                            <td className="px-3 py-2 font-mono" style={{ color: "var(--foreground)" }}>
                              {b.number}
                            </td>
                            <td className="px-3 py-2">
                              <StatusPill tone={tone}>
                                {b.building ? "构建中" : b.result || "—"}
                              </StatusPill>
                            </td>
                            <td className="px-3 py-2" style={{ color: "var(--label-secondary)" }}>
                              {formatDuration(b.duration)}
                            </td>
                            <td className="px-3 py-2">
                              {b.url && (
                                <a
                                  href={b.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-blue-600 hover:underline"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  ↗
                                </a>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {!builds.length && !buildsLoading && (
                        <tr>
                          <td
                            colSpan={4}
                            className="px-3 py-6 text-center"
                            style={{ color: "var(--label-secondary)" }}
                          >
                            暂无构建，点击「运行构建」开始
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </OpsCard>

              <OpsCard className="flex flex-col min-h-[180px] p-0 overflow-hidden">
                <div
                  className="px-3 py-2 border-b border-[var(--separator-subtle)] flex justify-between items-center"
                  style={{ color: "var(--label-secondary)" }}
                >
                  <span className="text-[11px] font-semibold uppercase tracking-wide">
                    控制台
                    {activeBuild != null ? ` · #${activeBuild}` : ""}
                  </span>
                  {consoleLoading && (
                    <span className="text-[11px]">加载中…</span>
                  )}
                </div>
                <pre
                  className="flex-1 text-[11px] leading-relaxed p-3 overflow-auto max-h-[220px] m-0 font-mono"
                  style={{
                    background: "var(--code-bg, #0f1419)",
                    color: "var(--code-fg, #e6edf3)",
                  }}
                >
                  {consoleText || (activeBuild ? "选择构建以查看日志" : "—")}
                </pre>
              </OpsCard>
            </>
          ) : (
            <OpsCard className="py-12 text-center text-sm text-[var(--label-secondary)]">
              请选择左侧流水线
            </OpsCard>
          )}
        </div>
      </div>

      {/* 运行构建抽屉 */}
      {drawerOpen && selected && (
        <div
          className="fixed inset-0 z-50 flex justify-end"
          role="dialog"
          aria-modal="true"
          aria-labelledby="jenkins-run-title"
        >
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label="关闭"
            onClick={() => !triggerBusy && setDrawerOpen(false)}
          />
          <div className="relative w-full max-w-md card-surface h-full shadow-2xl flex flex-col">
            <div className="px-5 py-4 border-b border-[var(--separator-subtle)]">
              <h4
                id="jenkins-run-title"
                className="text-base font-semibold"
                style={{ color: "var(--foreground)" }}
              >
                运行构建
              </h4>
              <p className="text-xs mt-1 font-mono" style={{ color: "var(--label-secondary)" }}>
                {selected.name}
              </p>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {(selected.parameters || []).length === 0 ? (
                <p className="text-sm" style={{ color: "var(--label-secondary)" }}>
                  此流水线无参数，确认后将立即入队。
                </p>
              ) : (
                (selected.parameters || []).map((p) => (
                  <div key={p.name}>
                    <label
                      className="text-xs font-medium block mb-1"
                      style={{ color: "var(--label-secondary)" }}
                    >
                      {p.name}
                    </label>
                    {p.choices && p.choices.length > 0 ? (
                      <select
                        value={triggerParams[p.name] ?? ""}
                        onChange={(e) =>
                          setTriggerParams((prev) => ({
                            ...prev,
                            [p.name]: e.target.value,
                          }))
                        }
                        className="w-full rounded-lg border border-[var(--separator-subtle)] px-3 py-2 text-sm bg-transparent"
                        style={{ color: "var(--foreground)" }}
                      >
                        {p.choices.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        value={triggerParams[p.name] ?? ""}
                        onChange={(e) =>
                          setTriggerParams((prev) => ({
                            ...prev,
                            [p.name]: e.target.value,
                          }))
                        }
                        className="w-full rounded-lg border border-[var(--separator-subtle)] px-3 py-2 text-sm bg-transparent"
                        style={{ color: "var(--foreground)" }}
                      />
                    )}
                  </div>
                ))
              )}
              <p className="text-[11px] rounded-lg px-3 py-2 bg-amber-500/10 text-amber-900 dark:text-amber-100">
                将触发真实 Jenkins 构建，请确认分支与环境参数。
              </p>
            </div>
            <div className="px-5 py-4 border-t border-[var(--separator-subtle)] flex gap-2">
              <button
                type="button"
                disabled={triggerBusy}
                onClick={() => setDrawerOpen(false)}
                className="flex-1 py-2.5 text-sm rounded-lg border border-[var(--separator-subtle)]"
                style={{ color: "var(--foreground)" }}
              >
                取消
              </button>
              <button
                type="button"
                disabled={triggerBusy}
                onClick={runTrigger}
                className="flex-1 py-2.5 text-sm rounded-lg font-medium bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {triggerBusy ? "入队中…" : "确认运行"}
              </button>
            </div>
          </div>
        </div>
      )}

      <ToastStack />
    </div>
  );
}
