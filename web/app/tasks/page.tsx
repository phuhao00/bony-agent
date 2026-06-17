"use client";

import { getToken } from "@/lib/auth";
import { CheckCircle2, Circle, Clock, Loader2, RefreshCw, X, XCircle } from "lucide-react";
import { useEffect, useState } from "react";

const POLL_INTERVAL_MS = 3000;

const STATUS_FILTERS = [
  { key: "all", label: "全部" },
  { key: "running", label: "运行中" },
  { key: "pending", label: "等待中" },
  { key: "waiting_approval", label: "待审批" },
  { key: "completed", label: "已完成" },
  { key: "failed", label: "失败" },
  { key: "cancelled", label: "已取消" },
] as const;

type TaskStatus =
  | "pending"
  | "waiting_approval"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "expired";

type TaskItem = {
  id: string;
  type: string;
  status: TaskStatus;
  progress: number;
  message?: string | null;
  error?: string | null;
  result?: unknown;
  metadata?: Record<string, unknown>;
  created_at: number;
  updated_at: number;
};

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function fetchTasks(status?: TaskStatus | "all"): Promise<TaskItem[]> {
  const qs = status && status !== "all" ? `?status=${encodeURIComponent(status)}&limit=200` : "?limit=200";
  const res = await fetch(`/api/backend/tasks${qs}`, { headers: authHeaders() });
  if (!res.ok) throw new Error("Failed to fetch tasks");
  const data = (await res.json()) as { tasks?: TaskItem[] };
  return data.tasks ?? [];
}

async function cancelTask(taskId: string): Promise<void> {
  const res = await fetch(`/api/backend/tasks/${taskId}/cancel`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to cancel task");
}

function taskTitle(task: TaskItem): string {
  const meta = task.metadata ?? {};
  if (typeof meta.goal === "string") return meta.goal;
  if (typeof meta.title === "string") return meta.title;
  const labels: Record<string, string> = {
    computer_use: "Computer Use",
    system_assistant: "System Assistant",
    programmer_agent: "Programmer Agent",
    native_use: "Native Desktop",
    media_pipeline: "Media Pipeline",
    long_video: "Long Video",
    auto_video: "Auto Video",
    ad_campaign: "Ad Campaign",
    legal: "Legal Advisor",
    product_manager: "Product Manager",
    business_partnership: "Business Partnership",
    procurement: "Procurement",
    game_art: "Game Art",
    game_design: "Game Design",
    last30days: "Last 30 Days",
    platform_action: "Platform Action",
    chat: "Chat",
  };
  return labels[task.type] ?? task.type;
}

function statusConfig(status: TaskStatus) {
  switch (status) {
    case "running":
      return { label: "运行中", color: "text-green-600", bg: "bg-green-500", icon: Loader2 };
    case "pending":
      return { label: "等待中", color: "text-amber-600", bg: "bg-amber-500", icon: Clock };
    case "waiting_approval":
      return { label: "待审批", color: "text-orange-600", bg: "bg-orange-500", icon: Circle };
    case "completed":
      return { label: "已完成", color: "text-blue-600", bg: "bg-blue-500", icon: CheckCircle2 };
    case "failed":
      return { label: "失败", color: "text-red-600", bg: "bg-red-500", icon: XCircle };
    case "cancelled":
      return { label: "已取消", color: "text-gray-500", bg: "bg-gray-400", icon: X };
    default:
      return { label: status, color: "text-gray-500", bg: "bg-gray-400", icon: Circle };
  }
}

function formatTime(ts: number): string {
  try {
    return new Date(ts * 1000).toLocaleString();
  } catch {
    return "";
  }
}

export default function TasksPage() {
  const [filter, setFilter] = useState<(typeof STATUS_FILTERS)[number]["key"]>("all");
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const list = await fetchTasks(filter === "all" ? undefined : filter);
      setTasks(list);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    }
  };

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
    const timer = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [filter]);

  const handleCancel = async (taskId: string) => {
    setCancelling(taskId);
    try {
      await cancelTask(taskId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "取消失败");
    } finally {
      setCancelling(null);
    }
  };

  return (
    <div className="mx-auto w-full max-w-4xl px-5 py-8 lg:px-8">
      <div className="mb-8 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[color:var(--foreground)]">
            Tasks
          </h1>
          <p className="mt-1 text-sm text-[color:var(--label-secondary)]">
            查看并管理所有后台任务
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-2 self-start rounded-full border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] px-4 py-2 text-sm font-medium text-[color:var(--foreground)] transition-colors hover:bg-[var(--nav-active-fill)] disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          刷新
        </button>
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
              filter === f.key
                ? "bg-[color:var(--accent)] text-white"
                : "border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] text-[color:var(--foreground)] hover:bg-[var(--nav-active-fill)]"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200">
          {error}
        </div>
      ) : null}

      <div className="space-y-3">
        {tasks.length === 0 && !loading ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] py-16 text-center">
            <Circle className="mb-3 h-10 w-10 text-[color:var(--label-secondary)]" strokeWidth={1.5} />
            <p className="text-sm font-medium text-[color:var(--foreground)]">暂无任务</p>
            <p className="text-xs text-[color:var(--label-secondary)]">
              当前状态下没有任务
            </p>
          </div>
        ) : (
          tasks.map((task) => {
            const cfg = statusConfig(task.status);
            const Icon = cfg.icon;
            const canCancel = ["pending", "running", "waiting_approval"].includes(task.status);
            return (
              <div
                key={task.id}
                className="group rounded-2xl border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] p-4 shadow-sm transition-shadow hover:shadow-md"
              >
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${task.status === "running" ? "bg-green-100" : "bg-[var(--chrome-rail-bg)]"}`}>
                    <Icon
                      className={`h-3.5 w-3.5 ${cfg.color} ${task.status === "running" ? "animate-spin" : ""}`}
                      strokeWidth={2.5}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="truncate text-sm font-semibold text-[color:var(--foreground)]">
                        {taskTitle(task)}
                      </h3>
                      <span className={`shrink-0 text-xs font-medium ${cfg.color}`}>
                        {cfg.label}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-[color:var(--label-secondary)]">
                      {task.id} · {formatTime(task.updated_at)}
                    </p>
                    {task.message || task.error ? (
                      <p className="mt-2 text-sm text-[color:var(--foreground)]">
                        {task.error ?? task.message}
                      </p>
                    ) : null}
                    {task.progress > 0 && task.progress < 100 ? (
                      <div className="mt-3">
                        <div className="flex items-center justify-between text-xs text-[color:var(--label-secondary)]">
                          <span>Progress</span>
                          <span>{task.progress}%</span>
                        </div>
                        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[var(--chrome-rail-bg)]">
                          <div
                            className={`h-full rounded-full transition-all ${cfg.bg}`}
                            style={{ width: `${task.progress}%` }}
                          />
                        </div>
                      </div>
                    ) : null}
                  </div>
                  {canCancel ? (
                    <button
                      type="button"
                      disabled={cancelling === task.id}
                      onClick={() => void handleCancel(task.id)}
                      className="shrink-0 rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] px-2.5 py-1.5 text-xs font-medium text-[color:var(--foreground)] transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                    >
                      {cancelling === task.id ? "取消中…" : "取消"}
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
