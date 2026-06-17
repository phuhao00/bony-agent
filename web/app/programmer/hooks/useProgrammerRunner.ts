"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getElectronPlatformInfo } from "@/lib/electron-system";

export type ProgrammerTask = {
  id?: string;
  status?: string;
  progress?: number;
  message?: string;
  result?: unknown;
  metadata?: Record<string, unknown>;
};

export type ProgrammerEnvironment = {
  platform?: string;
  git?: {
    workspace_root?: string;
    is_git_repo?: boolean;
    branch?: string;
    remotes?: string;
    user_name?: string;
    user_email?: string;
  };
  ssh?: {
    public_keys?: Array<{ path?: string; type?: string }>;
    config?: { hosts?: Array<Record<string, string>> };
  };
  infra_summary?: {
    total?: number;
    installed_count?: number;
    running_count?: number;
  };
  components_catalog?: Array<{ id: string; name: string; default_port: number }>;
  dev_tools?: Array<{ command?: string; success?: boolean; stdout?: string }>;
};

export type ProgrammerSuggestion = {
  id: string;
  title: string;
  description: string;
  recipe_id: string;
  params?: Record<string, unknown>;
  category: string;
  priority: number;
  reason: string;
};

export function useProgrammerRunner() {
  const [loading, setLoading] = useState(false);
  const [initLoading, setInitLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [task, setTask] = useState<ProgrammerTask | null>(null);
  const [environment, setEnvironment] = useState<ProgrammerEnvironment | null>(null);
  const [suggestions, setSuggestions] = useState<ProgrammerSuggestion[]>([]);
  const [clientPlatform, setClientPlatform] = useState("web");
  const [isElectron, setIsElectron] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const resetSession = useCallback(() => {
    stopPolling();
    setLoading(false);
    setError(null);
    setTask(null);
  }, [stopPolling]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  useEffect(() => {
    void getElectronPlatformInfo().then((info) => {
      setIsElectron(info.isElectron);
      setClientPlatform(info.platform);
    });
  }, []);

  const pollTask = useCallback(async (taskId: string) => {
    const res = await fetch(`/api/programmer/tasks/${encodeURIComponent(taskId)}`);
    const data = (await res.json()) as ProgrammerTask & { detail?: string; error?: string };
    if (!res.ok) {
      throw new Error(data.detail || data.error || "任务查询失败");
    }
    setTask(data);
    return data;
  }, []);

  const loadEnvironment = useCallback(async () => {
    const res = await fetch("/api/programmer/environment");
    const data = await res.json();
    if (res.ok) setEnvironment(data);
    return data as ProgrammerEnvironment;
  }, []);

  const loadSuggestions = useCallback(async () => {
    const res = await fetch("/api/programmer/suggestions");
    const data = await res.json();
    if (res.ok) {
      setSuggestions(data.suggestions || []);
      setEnvironment(data.environment || null);
    }
    return data;
  }, []);

  const runRecipe = useCallback(
    async (recipeId: string, params: Record<string, unknown> = {}) => {
      setLoading(true);
      setError(null);
      setTask(null);
      stopPolling();
      try {
        const res = await fetch("/api/programmer/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recipe_id: recipeId, params }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || data.detail || "运行失败");
        }

        if (data.success === false || data.status === "failed") {
          const failMsg = data.error || data.result?.error || "运行失败";
          setError(failMsg);
          if (data.task_id) {
            try {
              await pollTask(data.task_id);
            } catch {
              setTask({
                id: data.task_id,
                status: "failed",
                message: failMsg,
                result: data.result ?? { error: failMsg },
              });
            }
          }
          setLoading(false);
          return data;
        }

        const taskId = data.task_id as string | undefined;
        if (taskId) {
          let polled: ProgrammerTask | null = null;
          try {
            polled = await pollTask(taskId);
          } catch (pollErr) {
            if (data.result) {
              const fallback: ProgrammerTask = {
                id: taskId,
                status: data.status || "completed",
                result: data.result,
                message: data.status === "failed" ? data.error : "执行完成",
              };
              setTask(fallback);
              polled = fallback;
            } else {
              throw pollErr;
            }
          }

          if (polled?.status === "failed") {
            const failMsg =
              (typeof polled.result === "object" &&
              polled.result &&
              "error" in polled.result &&
              typeof (polled.result as { error?: string }).error === "string"
                ? (polled.result as { error: string }).error
                : "") ||
              polled.message ||
              "运行失败";
            setError(failMsg);
            setLoading(false);
            return data;
          }

          if (data.status === "waiting_approval") {
            setLoading(false);
            return data;
          }
          if (data.status === "running" || polled?.status === "running") {
            pollRef.current = setInterval(() => {
              void pollTask(taskId)
                .then((t) => {
                  if (t.status && !["running", "waiting_approval"].includes(t.status)) {
                    stopPolling();
                    setLoading(false);
                    if (t.status === "failed") {
                      const failMsg =
                        (typeof t.result === "object" &&
                        t.result &&
                        "error" in t.result &&
                        typeof (t.result as { error?: string }).error === "string"
                          ? (t.result as { error: string }).error
                          : "") ||
                        t.message ||
                        "运行失败";
                      setError(failMsg);
                    }
                  }
                })
                .catch((err: unknown) => {
                  stopPolling();
                  setLoading(false);
                  setError(err instanceof Error ? err.message : "任务轮询失败");
                });
            }, 2000);
          } else {
            setLoading(false);
          }
        } else {
          setLoading(false);
        }
        return data;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        setLoading(false);
        throw e;
      }
    },
    [pollTask, stopPolling],
  );

  const approveAndResume = useCallback(
    async (approvalId: string, taskId: string) => {
      setLoading(true);
      setError(null);
      stopPolling();
      try {
        const approveRes = await fetch(`/api/approvals/${approvalId}/approve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            approved_by: "local_user",
            auto_resume_programmer_agent: true,
          }),
        });
        if (!approveRes.ok) {
          const data = await approveRes.json().catch(() => ({}));
          throw new Error(data.error || data.detail || "批准失败");
        }
        await pollTask(taskId);
        pollRef.current = setInterval(async () => {
          const t = await pollTask(taskId);
          if (t.status && !["running", "waiting_approval", "pending"].includes(t.status)) {
            stopPolling();
            setLoading(false);
          }
        }, 2000);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        setLoading(false);
      }
    },
    [pollTask, stopPolling],
  );

  useEffect(() => {
    void (async () => {
      setInitLoading(true);
      try {
        await loadEnvironment();
        await loadSuggestions();
      } finally {
        setInitLoading(false);
      }
    })();
  }, [loadEnvironment, loadSuggestions]);

  return {
    loading,
    initLoading,
    error,
    task,
    isElectron,
    clientPlatform,
    environment,
    suggestions,
    runRecipe,
    loadEnvironment,
    loadSuggestions,
    approveAndResume,
    setError,
    resetSession,
  };
}
