"use client";

import {
    CheckCircle2,
    Clock3,
    Loader2,
    PlayCircle,
    RefreshCw,
    RotateCcw,
    ShieldCheck,
    StopCircle,
    XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

type ApprovalStatus = "pending" | "approved" | "denied" | "expired";
type TaskStatus =
  | "pending"
  | "waiting_approval"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "expired";

interface Capability {
  id: string;
  name: string;
  description: string;
  risk_level: string;
  requires_approval: boolean;
  can_run_unattended: boolean;
  tool_ids: string[];
}

interface Approval {
  id: string;
  task_id?: string | null;
  trace_id?: string | null;
  capability_id: string;
  risk_level: string;
  proposed_action: string;
  args_preview: Record<string, unknown>;
  status: ApprovalStatus;
  created_at: string;
  expires_at: string;
  approved_by?: string | null;
  metadata?: Record<string, unknown>;
}

interface TaskRecord {
  id: string;
  type: string;
  status: TaskStatus;
  progress: number;
  message?: string | null;
  error?: string | null;
  updated_at: number;
  metadata?: Record<string, unknown>;
}

interface LocalActionEvent {
  id: string;
  created_at: number;
  action: string;
  capability_id: string;
  status: string;
  result_status?: string;
  task_id?: string | null;
  approval_id?: string | null;
}

interface PlatformActionProfile {
  id: string;
  name: string;
  capability_id: string;
  risk_level: string;
  requires_approval: boolean;
  supported: boolean;
}

interface PlatformProfile {
  id: string;
  name: string;
  category: string;
  connection_methods: string[];
  recommended_method: string;
  status: string;
  maturity: string;
  connector_status: string;
  connected: boolean;
  has_credentials: boolean;
  actions: PlatformActionProfile[];
}

const riskTone: Record<string, string> = {
  low: "border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] text-[color:var(--label-secondary)]",
  medium:
    "border-[color:rgba(255,149,0,0.35)] bg-[color:rgba(255,149,0,0.08)] text-[color:var(--foreground)]",
  high: "border-[color:rgba(255,59,48,0.35)] bg-[color:rgba(255,59,48,0.08)] text-[color:var(--foreground)]",
  critical:
    "border-[color:rgba(255,59,48,0.55)] bg-[color:rgba(255,59,48,0.14)] text-[color:var(--foreground)]",
};

function StatusBadge({ status }: { status: ApprovalStatus | TaskStatus }) {
  const tone =
    status === "completed" || status === "approved"
      ? "bg-[var(--nav-active-fill)] text-[color:var(--accent)]"
      : status === "running"
        ? "bg-[color:rgba(0,122,255,0.1)] text-[color:var(--foreground)]"
        : status === "waiting_approval" || status === "pending"
          ? "bg-[color:rgba(255,149,0,0.1)] text-[color:var(--foreground)]"
          : "bg-[color:rgba(255,59,48,0.1)] text-[color:var(--foreground)]";
  return (
    <span className={`rounded-md px-2 py-1 text-[11px] font-medium ${tone}`}>
      {status}
    </span>
  );
}

function formatTime(value?: string | number | null) {
  if (!value) return "-";
  const date =
    typeof value === "number" ? new Date(value * 1000) : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("zh-CN", { hour12: false });
}

/** 列表中展示 id：过长时截断首尾，避免撑爆布局 */
function shortId(id: string | null | undefined, head = 8, tail = 4): string {
  const s = String(id ?? "").trim();
  if (!s) return "-";
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

function formatApprovalArgsPreview(value: unknown, maxLen = 8000): string {
  try {
    const s = JSON.stringify(value, null, 2);
    if (s.length <= maxLen) return s;
    return `${s.slice(0, maxLen)}\n… （已截断，共 ${s.length} 字符）`;
  } catch {
    return String(value);
  }
}

function canResumeTask(task: TaskRecord) {
  const metadata = task.metadata;
  if (task.status !== "pending" || !metadata?.approved_approval_id)
    return false;
  if (
    task.type === "computer_use" &&
    typeof metadata.computer_use_resume === "object" &&
    metadata.computer_use_resume !== null
  ) {
    return true;
  }
  return (
    (task.type === "local_computer_action" &&
      typeof metadata.local_computer_resume === "object" &&
      metadata.local_computer_resume !== null) ||
    (task.type === "platform_action" &&
      typeof metadata.platform_action_resume === "object" &&
      metadata.platform_action_resume !== null)
  );
}

function resumeEndpoint(task: TaskRecord) {
  if (task.type === "platform_action") {
    return `/api/connectors/platform-actions/${task.id}/resume`;
  }
  if (task.type === "local_computer_action") {
    return `/api/computer/actions/${task.id}/resume`;
  }
  return `/api/tasks/${task.id}/resume`;
}

function canRollbackTask(task: TaskRecord) {
  const metadata = task.metadata;
  return (
    task.type === "local_computer_action" &&
    task.status === "completed" &&
    typeof metadata?.rollback === "object" &&
    metadata.rollback !== null &&
    !metadata.rollback_applied_at
  );
}

export default function CapabilitiesApprovalsTab() {
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [localActionEvents, setLocalActionEvents] = useState<
    LocalActionEvent[]
  >([]);
  const [platformProfiles, setPlatformProfiles] = useState<PlatformProfile[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoResumeAfterApprove, setAutoResumeAfterApprove] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [capRes, approvalsRes, tasksRes, auditRes, matrixRes] =
        await Promise.all([
          fetch("/api/capabilities"),
          fetch("/api/approvals?limit=50"),
          fetch("/api/tasks?limit=50"),
          fetch("/api/computer/actions/audit?limit=20"),
          fetch("/api/connectors/capability-matrix"),
        ]);
      const [capData, approvalsData, tasksData, auditData, matrixData] =
        await Promise.all([
          capRes.json(),
          approvalsRes.json(),
          tasksRes.json(),
          auditRes.json(),
          matrixRes.json(),
        ]);
      setCapabilities(
        Array.isArray(capData.capabilities) ? capData.capabilities : [],
      );
      setApprovals(
        Array.isArray(approvalsData.approvals) ? approvalsData.approvals : [],
      );
      setTasks(Array.isArray(tasksData.tasks) ? tasksData.tasks : []);
      setLocalActionEvents(
        Array.isArray(auditData.events) ? auditData.events : [],
      );
      setPlatformProfiles(
        Array.isArray(matrixData.platforms) ? matrixData.platforms : [],
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "加载失败");
      setCapabilities([]);
      setApprovals([]);
      setTasks([]);
      setLocalActionEvents([]);
      setPlatformProfiles([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const pendingApprovals = useMemo(
    () => approvals.filter((approval) => approval.status === "pending"),
    [approvals],
  );

  const resolveApproval = async (
    approvalId: string,
    action: "approve" | "deny",
    opts?: {
      autoResumeAfterApprove?: boolean;
      approvalSource?: string;
    },
  ) => {
    setBusyId(approvalId);
    try {
      const ar = Boolean(opts?.autoResumeAfterApprove);
      const src = opts?.approvalSource ?? "";
      const body =
        action === "approve"
          ? {
              approved_by: "local_user",
              auto_resume_computer_use: ar && src === "computer_use",
              auto_resume_platform_action: ar && src === "platform_actions",
              auto_resume_local_computer: ar && src === "local_computer",
            }
          : { approved_by: "local_user" };
      await fetch(`/api/approvals/${approvalId}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const cancelTask = async (taskId: string) => {
    setBusyId(taskId);
    try {
      await fetch(`/api/tasks/${taskId}/cancel`, { method: "POST" });
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const resumeTask = async (task: TaskRecord) => {
    setBusyId(task.id);
    setError(null);
    try {
      const response = await fetch(resumeEndpoint(task), { method: "POST" });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.detail || data.error || "恢复任务失败");
      }
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "恢复任务失败");
    } finally {
      setBusyId(null);
    }
  };

  const rollbackTask = async (task: TaskRecord) => {
    setBusyId(task.id);
    setError(null);
    try {
      const response = await fetch(
        `/api/computer/actions/${task.id}/rollback`,
        {
          method: "POST",
        },
      );
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.detail || data.error || "回滚任务失败");
      }
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "回滚任务失败");
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2
          className="h-8 w-8 animate-spin text-[color:var(--accent)]"
          strokeWidth={1.8}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--nav-active-fill)] text-[color:var(--accent)] ring-1 ring-[color:var(--separator-subtle)]">
            <ShieldCheck className="h-5 w-5" strokeWidth={1.8} />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-[color:var(--foreground)]">
              审批与任务
            </h2>
            <p className="mt-0.5 text-xs text-[color:var(--label-secondary)]">
              {pendingApprovals.length} pending · {tasks.length} tasks ·{" "}
              {capabilities.length} capabilities
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={load}
          className="inline-flex items-center gap-2 rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-3 py-2 text-xs font-medium text-[color:var(--foreground)] hover:bg-[var(--chrome-rail-bg)]"
        >
          <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.8} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-[color:rgba(255,59,48,0.35)] bg-[color:rgba(255,59,48,0.08)] px-4 py-3 text-sm text-[color:var(--foreground)]">
          {error}
        </div>
      )}

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Clock3
            className="h-4 w-4 text-[color:var(--label-secondary)]"
            strokeWidth={1.8}
          />
          <h3 className="text-sm font-semibold text-[color:var(--foreground)]">
            Pending Approvals
          </h3>
        </div>
        {pendingApprovals.length === 0 ? (
          <div className="rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-4 py-6 text-center text-sm text-[color:var(--label-secondary)]">
            No pending approvals
          </div>
        ) : (
          <div className="space-y-3">
            <label className="flex cursor-pointer items-center gap-2 text-xs text-[color:var(--label-secondary)]">
              <input
                type="checkbox"
                checked={autoResumeAfterApprove}
                onChange={(e) => setAutoResumeAfterApprove(e.target.checked)}
                className="rounded border-[color:var(--separator-subtle)]"
              />
              批准后后台自动继续：Computer Use、平台动作（飞书/Discord
              等）或本地电脑写入/Shell（无需再点 Resume）
            </label>
            <div className="space-y-2">
            {pendingApprovals.map((approval) => (
              <div
                key={approval.id}
                className="rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-[color:var(--foreground)]">
                        {approval.proposed_action}
                      </span>
                      <StatusBadge status={approval.status} />
                      <span
                        className={`rounded-md border px-2 py-1 text-[11px] ${riskTone[approval.risk_level] || riskTone.medium}`}
                      >
                        {approval.risk_level}
                      </span>
                    </div>
                    <div className="mt-2 grid gap-1 text-xs text-[color:var(--label-secondary)] md:grid-cols-2">
                      <span>Capability: {approval.capability_id}</span>
                      <span>Approval: {shortId(approval.id)}</span>
                      <span>
                        Task:{" "}
                        {approval.task_id ? shortId(approval.task_id) : "-"}
                      </span>
                      <span>Expires: {formatTime(approval.expires_at)}</span>
                    </div>
                    <details className="mt-3 rounded-md border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] px-3 py-2">
                      <summary className="cursor-pointer select-none text-xs font-medium text-[color:var(--foreground)]">
                        参数预览（args_preview）
                      </summary>
                      <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-all rounded bg-[var(--card-bg)] p-2 font-mono text-[11px] text-[color:var(--foreground)] ring-1 ring-[color:var(--separator-subtle)]">
                        {formatApprovalArgsPreview(approval.args_preview)}
                      </pre>
                    </details>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      disabled={busyId === approval.id}
                      onClick={() =>
                        resolveApproval(approval.id, "approve", {
                          autoResumeAfterApprove,
                          approvalSource: String(
                            approval.metadata?.source ?? "",
                          ),
                        })
                      }
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[color:var(--accent)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} />
                      Approve
                    </button>
                    <button
                      type="button"
                      disabled={busyId === approval.id}
                      onClick={() => resolveApproval(approval.id, "deny")}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[color:rgba(255,59,48,0.35)] bg-[color:rgba(255,59,48,0.08)] px-3 py-2 text-xs font-semibold text-[color:var(--foreground)] disabled:opacity-50"
                    >
                      <XCircle className="h-3.5 w-3.5" strokeWidth={2} />
                      Deny
                    </button>
                  </div>
                </div>
              </div>
            ))}
            </div>
          </div>
        )}
      </section>

      <section className="grid gap-6 lg:grid-cols-[1fr_0.9fr]">
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-[color:var(--foreground)]">
            Recent Tasks
          </h3>
          <div className="space-y-2">
            {tasks.slice(0, 10).map((task) => (
              <div
                key={task.id}
                className="rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-[color:var(--foreground)]">
                        {task.type}
                      </span>
                      <StatusBadge status={task.status} />
                      <span className="text-xs text-[color:var(--label-secondary)]">
                        {shortId(task.id)}
                      </span>
                    </div>
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--chrome-rail-bg)]">
                      <div
                        className="h-full bg-[color:var(--accent)]"
                        style={{
                          width: `${Math.max(0, Math.min(task.progress || 0, 100))}%`,
                        }}
                      />
                    </div>
                    <p className="mt-2 text-xs text-[color:var(--label-secondary)]">
                      {task.error ||
                        task.message ||
                        formatTime(task.updated_at)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-2">
                    {canResumeTask(task) && (
                      <button
                        type="button"
                        disabled={busyId === task.id}
                        onClick={() => resumeTask(task)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[color:var(--accent)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                      >
                        <PlayCircle className="h-3.5 w-3.5" strokeWidth={2} />
                        Resume
                      </button>
                    )}
                    {canRollbackTask(task) && (
                      <button
                        type="button"
                        disabled={busyId === task.id}
                        onClick={() => rollbackTask(task)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-3 py-2 text-xs font-semibold text-[color:var(--foreground)] hover:bg-[var(--chrome-rail-bg)] disabled:opacity-50"
                      >
                        <RotateCcw className="h-3.5 w-3.5" strokeWidth={2} />
                        Rollback
                      </button>
                    )}
                    {(task.status === "pending" ||
                      task.status === "running" ||
                      task.status === "waiting_approval") && (
                      <button
                        type="button"
                        disabled={busyId === task.id}
                        onClick={() => cancelTask(task.id)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--separator-subtle)] px-3 py-2 text-xs font-medium text-[color:var(--foreground)] hover:bg-[var(--chrome-rail-bg)] disabled:opacity-50"
                      >
                        <StopCircle className="h-3.5 w-3.5" strokeWidth={1.8} />
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {tasks.length === 0 && (
              <div className="rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-4 py-6 text-center text-sm text-[color:var(--label-secondary)]">
                No tasks yet
              </div>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-[color:var(--foreground)]">
            Capability Matrix
          </h3>
          <div className="space-y-2">
            {capabilities.map((capability) => (
              <div
                key={capability.id}
                className="rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[color:var(--foreground)]">
                      {capability.name}
                    </p>
                    <p className="mt-1 line-clamp-2 text-xs text-[color:var(--label-secondary)]">
                      {capability.description}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-md border px-2 py-1 text-[11px] ${riskTone[capability.risk_level] || riskTone.medium}`}
                  >
                    {capability.risk_level}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <span className="rounded-md bg-[var(--chrome-rail-bg)] px-2 py-1 text-[10px] text-[color:var(--label-secondary)]">
                    {capability.requires_approval ? "approval" : "direct"}
                  </span>
                  <span className="rounded-md bg-[var(--chrome-rail-bg)] px-2 py-1 text-[10px] text-[color:var(--label-secondary)]">
                    {capability.can_run_unattended ? "unattended" : "attended"}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-3 pt-3">
            <h3 className="text-sm font-semibold text-[color:var(--foreground)]">
              Platform Matrix
            </h3>
            <div className="space-y-2">
              {platformProfiles.map((platform) => (
                <div
                  key={platform.id}
                  className="rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-[color:var(--foreground)]">
                        {platform.name}
                      </p>
                      <p className="mt-1 text-xs text-[color:var(--label-secondary)]">
                        {platform.recommended_method} · {platform.maturity}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-md bg-[var(--chrome-rail-bg)] px-2 py-1 text-[10px] text-[color:var(--label-secondary)]">
                      {platform.connected
                        ? "connected"
                        : platform.connector_status}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {platform.connection_methods.slice(0, 4).map((method) => (
                      <span
                        key={method}
                        className="rounded-md bg-[var(--chrome-rail-bg)] px-2 py-1 text-[10px] text-[color:var(--label-secondary)]"
                      >
                        {method}
                      </span>
                    ))}
                  </div>
                  <div className="mt-3 grid gap-1.5">
                    {platform.actions.slice(0, 5).map((action) => (
                      <div
                        key={action.id}
                        className="flex items-center justify-between gap-2 text-xs"
                      >
                        <span className="min-w-0 truncate text-[color:var(--foreground)]">
                          {action.name}
                        </span>
                        <span
                          className={`shrink-0 rounded-md border px-2 py-0.5 text-[10px] ${riskTone[action.risk_level] || riskTone.medium}`}
                        >
                          {action.requires_approval ? "approval" : "direct"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {platformProfiles.length === 0 && (
                <div className="rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-4 py-5 text-center text-sm text-[color:var(--label-secondary)]">
                  No platform profiles
                </div>
              )}
            </div>
          </div>

          <div className="space-y-3 pt-3">
            <h3 className="text-sm font-semibold text-[color:var(--foreground)]">
              Recent Local Actions
            </h3>
            <div className="space-y-2">
              {localActionEvents.slice(0, 8).map((event) => (
                <div
                  key={event.id}
                  className="rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-[color:var(--foreground)]">
                        {event.action}
                      </p>
                      <p className="mt-1 text-xs text-[color:var(--label-secondary)]">
                        {event.capability_id} · {formatTime(event.created_at)}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-md bg-[var(--chrome-rail-bg)] px-2 py-1 text-[10px] text-[color:var(--label-secondary)]">
                      {event.status}
                    </span>
                  </div>
                </div>
              ))}
              {localActionEvents.length === 0 && (
                <div className="rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-4 py-5 text-center text-sm text-[color:var(--label-secondary)]">
                  No local action events
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
