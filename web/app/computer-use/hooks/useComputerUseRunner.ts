"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ComputerUseResult, TaskPollState } from "../lib/types";

const POLL_INTERVAL_MS = 2000;
const SUBMIT_TIMEOUT_MS = 15_000;

function taskToResult(task: TaskPollState): ComputerUseResult {
  const meta = task.metadata || {};
  const cu = meta.computer_use || {};
  const stored = (task.result || {}) as ComputerUseResult;
  const preview =
    cu.preview_screenshot_base64 ||
    meta.preview_screenshot_base64 ||
    stored.preview_screenshot_base64 ||
    stored.final_screenshot_base64;

  if (task.status === "waiting_approval") {
    const approvalId = meta.last_approval_id;
    return {
      ...stored,
      success: false,
      status: "waiting_approval",
      requires_approval: true,
      task_id: task.id,
      preview_screenshot_base64: preview,
      approval: {
        id: approvalId,
        capability_id: stored.approval?.capability_id,
        proposed_action: cu.last_plan || stored.approval?.proposed_action,
        risk_level: stored.approval?.risk_level,
      },
      computer_use: cu,
    };
  }

  if (task.status === "completed" && stored) {
    return {
      ...stored,
      success: stored.success ?? true,
      status: "completed",
      task_id: task.id,
      preview_screenshot_base64: preview || stored.final_screenshot_base64,
      computer_use: cu,
    };
  }

  if (task.status === "failed") {
    return {
      ...stored,
      success: false,
      status: "failed",
      error: task.error || stored.error || "执行失败",
      task_id: task.id,
      preview_screenshot_base64: preview,
      computer_use: cu,
    };
  }

  if (task.status === "cancelled") {
    return {
      ...stored,
      success: false,
      status: "cancelled",
      error: "任务已取消",
      task_id: task.id,
      preview_screenshot_base64: preview,
      computer_use: cu,
    };
  }

  return {
    success: undefined,
    status: task.status,
    task_id: task.id,
    message: task.message,
    preview_screenshot_base64: preview,
    computer_use: cu,
  };
}

export function useComputerUseRunner() {
  const [loading, setLoading] = useState(false);
  const [polling, setPolling] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ComputerUseResult | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setPolling(false);
  }, []);

  const pollTask = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/tasks/${id}`, { cache: "no-store" });
        const task: TaskPollState = await res.json();
        if (!res.ok) {
          throw new Error(task.error || `HTTP ${res.status}`);
        }
        const mapped = taskToResult(task);
        setResult(mapped);

        const terminal = ["completed", "failed", "cancelled"].includes(
          task.status || "",
        );
        const waiting = task.status === "waiting_approval";

        if (terminal || waiting) {
          stopPolling();
          setLoading(false);
        }
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "轮询失败");
        stopPolling();
        setLoading(false);
      }
    },
    [stopPolling],
  );

  const startPolling = useCallback(
    (id: string) => {
      stopPolling();
      setTaskId(id);
      setPolling(true);
      void pollTask(id);
      pollRef.current = setInterval(() => void pollTask(id), POLL_INTERVAL_MS);
    },
    [pollTask, stopPolling],
  );

  useEffect(() => () => stopPolling(), [stopPolling]);

  const submitRun = useCallback(
    async (body: Record<string, unknown>) => {
      setError("");
      setResult(null);
      setLoading(true);
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      const timeoutId = window.setTimeout(() => ac.abort(), SUBMIT_TIMEOUT_MS);

      try {
        const res = await fetch("/api/computer-use", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: ac.signal,
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || data.detail || "提交失败");
        }
        const id = data.task_id as string | undefined;
        if (!id) {
          throw new Error("后端未返回 task_id");
        }
        setResult({ status: "pending", task_id: id, success: undefined });
        startPolling(id);
      } catch (e: unknown) {
        const aborted =
          e instanceof Error && e.name === "AbortError";
        setError(
          aborted
            ? "提交超时，请确认后端在运行"
            : e instanceof Error
              ? e.message
              : "提交失败",
        );
        setLoading(false);
      } finally {
        window.clearTimeout(timeoutId);
      }
    },
    [startPolling],
  );

  const cancelRun = useCallback(async () => {
    stopPolling();
    abortRef.current?.abort();
    if (taskId) {
      try {
        await fetch(`/api/tasks/${taskId}/cancel`, { method: "POST" });
      } catch {
        /* ignore */
      }
    }
    setLoading(false);
    setError("任务已请求取消");
  }, [stopPolling, taskId]);

  const resumeAfterApproval = useCallback(
    async (approvalId: string, resumeTaskId: string) => {
      setError("");
      setLoading(true);
      try {
        const approveRes = await fetch(`/api/approvals/${approvalId}/approve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            approved_by: "local_user",
            auto_resume_computer_use: false,
          }),
        });
        if (!approveRes.ok) {
          const data = await approveRes.json().catch(() => ({}));
          throw new Error(data.error || data.detail || "批准失败");
        }

        const resumeRes = await fetch(`/api/tasks/${resumeTaskId}/resume`, {
          method: "POST",
        });
        const data = await resumeRes.json();
        if (!resumeRes.ok) {
          throw new Error(data.error || data.detail || "恢复任务失败");
        }
        startPolling(resumeTaskId);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "批准/恢复失败");
        setLoading(false);
      }
    },
    [startPolling],
  );

  return {
    loading,
    polling,
    error,
    setError,
    result,
    setResult,
    taskId,
    submitRun,
    cancelRun,
    resumeAfterApproval,
  };
}
