"use client";

import { useChatSession } from "@/contexts/ChatSessionContext";
import { useClaudeCodeSession } from "@/contexts/ClaudeCodeSessionContext";
import { getToken } from "@/lib/auth";
import { Loader2, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const POLL_INTERVAL_MS = 3000;

type TaskItem = {
  id: string;
  type: string;
  status: string;
  progress: number;
  message?: string | null;
  metadata?: Record<string, unknown>;
  updated_at?: number;
};

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function fetchRunningTasks(): Promise<TaskItem[]> {
  const res = await fetch("/api/backend/tasks?status=running&limit=100", {
    headers: authHeaders(),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { tasks?: TaskItem[] };
  return data.tasks ?? [];
}

async function cancelTask(taskId: string): Promise<void> {
  await fetch(`/api/backend/tasks/${taskId}/cancel`, {
    method: "POST",
    headers: authHeaders(),
  });
}

function formatTaskTitle(task: TaskItem): string {
  const meta = task.metadata ?? {};
  const goal =
    typeof meta.goal === "string"
      ? meta.goal
      : typeof meta.title === "string"
        ? meta.title
        : null;
  if (goal) return goal;
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

function useOutsideClick<T extends HTMLElement>(
  ref: React.RefObject<T | null>,
  onOutside: () => void,
) {
  useEffect(() => {
    function handle(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onOutside();
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [ref, onOutside]);
}

export function TaskRunningIndicator() {
  const [open, setOpen] = useState(false);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const { isLoading: chatLoading, stopGeneration: stopChat } = useChatSession();
  const {
    state: { running: claudeCodeRunning },
    cancel: cancelClaudeCode,
  } = useClaudeCodeSession();

  const backendCount = tasks.length;
  const extraCount = (chatLoading ? 1 : 0) + (claudeCodeRunning ? 1 : 0);
  const totalCount = backendCount + extraCount;

  useOutsideClick(containerRef, () => setOpen(false));

  // Poll backend task list continuously so the badge always reflects reality.
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const list = await fetchRunningTasks();
        if (mounted) setTasks(list);
      } catch {
        // ignore
      }
    };
    load();
    const timer = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);

  const handleCancel = async (taskId: string) => {
    setLoading(true);
    try {
      await cancelTask(taskId);
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
    } finally {
      setLoading(false);
    }
  };

  const hasActivity = totalCount > 0;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        onMouseDown={(e) => e.stopPropagation()}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2 rounded-full border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] px-3 py-1.5 text-xs font-medium text-[color:var(--foreground)] shadow-sm transition-colors hover:bg-[var(--nav-active-fill)]"
      >
        <span className="relative flex h-2 w-2">
          {hasActivity && (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
          )}
          <span
            className={`relative inline-flex h-2 w-2 rounded-full ${hasActivity ? "bg-green-500" : "bg-gray-400"}`}
          />
        </span>
        <span>
          {totalCount} task{totalCount === 1 ? "" : "s"} running
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] shadow-xl"
        >
          <div className="flex items-center justify-between border-b border-[color:var(--separator-subtle)] px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-[color:var(--foreground)]">
              <span className="h-2 w-2 rounded-full bg-green-500" />
              Active Tasks
            </div>
            <span className="rounded-full bg-[var(--chrome-rail-bg)] px-2 py-0.5 text-xs font-medium text-[color:var(--label-secondary)]">
              {totalCount}
            </span>
          </div>

          <div className="max-h-[min(24rem,60vh)] overflow-y-auto py-1">
            {chatLoading && (
              <div className="flex items-center gap-3 px-4 py-3">
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-green-500" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-[color:var(--foreground)]">
                    Chat response in progress
                  </p>
                </div>
                <button
                  type="button"
                  onClick={stopChat}
                  className="shrink-0 rounded-md p-1 text-[color:var(--label-secondary)] transition-colors hover:bg-[var(--nav-active-fill)] hover:text-[color:var(--foreground)]"
                  aria-label="Stop chat"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}

            {claudeCodeRunning && (
              <div className="flex items-center gap-3 px-4 py-3">
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-green-500" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-[color:var(--foreground)]">
                    Claude Code running
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Link
                    href="/claude-code"
                    className="rounded-md px-2 py-1 text-xs font-medium text-[color:var(--accent)] hover:bg-[var(--nav-active-fill)]"
                  >
                    Open
                  </Link>
                  <button
                    type="button"
                    onClick={() => void cancelClaudeCode()}
                    className="rounded-md p-1 text-[color:var(--label-secondary)] transition-colors hover:bg-[var(--nav-active-fill)] hover:text-[color:var(--foreground)]"
                    aria-label="Cancel Claude Code"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}

            {tasks.map((task) => (
              <div
                key={task.id}
                className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-[var(--nav-active-fill)]"
              >
                <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-green-500" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-[color:var(--foreground)]">
                    {formatTaskTitle(task)}
                  </p>
                  {task.message ? (
                    <p className="truncate text-xs text-[color:var(--label-secondary)]">
                      {task.message}
                    </p>
                  ) : null}
                  {task.progress > 0 && task.progress < 100 ? (
                    <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-[var(--chrome-rail-bg)]">
                      <div
                        className="h-full rounded-full bg-green-500 transition-all"
                        style={{ width: `${task.progress}%` }}
                      />
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => void handleCancel(task.id)}
                  className="shrink-0 rounded-md p-1 text-[color:var(--label-secondary)] transition-colors hover:bg-[var(--nav-active-fill)] hover:text-[color:var(--foreground)] disabled:opacity-50"
                  aria-label="Cancel task"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}

            {totalCount === 0 && (
              <div className="px-4 py-6 text-center text-sm text-[color:var(--label-secondary)]">
                No active tasks
              </div>
            )}
          </div>

          <div className="border-t border-[color:var(--separator-subtle)] px-4 py-2.5">
            <Link
              href="/tasks"
              onClick={() => setOpen(false)}
              className="block text-center text-xs font-medium text-[color:var(--accent)] transition-colors hover:opacity-80"
            >
              查看全部任务 →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
