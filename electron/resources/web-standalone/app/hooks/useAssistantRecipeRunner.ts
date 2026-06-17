"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type AssistantRecipeTask = {
  id?: string;
  status?: string;
  progress?: number;
  message?: string;
  result?: {
    report?: string;
    recipe?: string;
    error?: string;
    [key: string]: unknown;
  };
  metadata?: Record<string, unknown>;
};

export type AssistantSuggestion = {
  id: string;
  title: string;
  description: string;
  recipe_id: string;
  params?: Record<string, unknown>;
  category: string;
  priority: number;
  reason: string;
};

export type AssistantEnvironment = {
  agent_id?: string;
  recipe_count?: number;
  categories?: string[];
  focus_areas?: string[];
  [key: string]: unknown;
};

type RunResponse = {
  success?: boolean;
  status?: string;
  task_id?: string;
  result?: AssistantRecipeTask["result"];
  error?: string;
  detail?: string;
};

export function useAssistantRecipeRunner(apiBase: string, pollMs = 1500) {
  const [loading, setLoading] = useState(false);
  const [initLoading, setInitLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [task, setTask] = useState<AssistantRecipeTask | null>(null);
  const [environment, setEnvironment] = useState<AssistantEnvironment | null>(null);
  const [suggestions, setSuggestions] = useState<AssistantSuggestion[]>([]);
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

  const pollTask = useCallback(
    async (taskId: string) => {
      const res = await fetch(`${apiBase}/tasks/${encodeURIComponent(taskId)}`);
      const data = (await res.json()) as AssistantRecipeTask & { detail?: string; error?: string };
      if (!res.ok) {
        throw new Error(data.detail || data.error || "任务查询失败");
      }
      setTask(data);
      return data;
    },
    [apiBase],
  );

  const loadSuggestions = useCallback(async () => {
    const res = await fetch(`${apiBase}/suggestions`);
    const data = await res.json();
    if (res.ok) {
      setSuggestions(data.suggestions || []);
      setEnvironment(data.environment || null);
    } else {
      throw new Error(data.detail || data.error || "加载推荐失败");
    }
    return data;
  }, [apiBase]);

  const runRecipe = useCallback(
    async (recipeId: string, params: Record<string, unknown> = {}) => {
      setLoading(true);
      setError(null);
      setTask(null);
      stopPolling();
      try {
        const res = await fetch(`${apiBase}/run`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recipe_id: recipeId, params }),
        });
        const data = (await res.json()) as RunResponse;
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

        const taskId = data.task_id;
        if (taskId) {
          let polled: AssistantRecipeTask | null = null;
          try {
            polled = await pollTask(taskId);
          } catch (pollErr) {
            if (data.result) {
              const fallback: AssistantRecipeTask = {
                id: taskId,
                status: data.status || "completed",
                result: data.result,
                message: data.status === "failed" ? data.error : "分析完成",
              };
              setTask(fallback);
              polled = fallback;
            } else {
              throw pollErr;
            }
          }

          if (polled?.status === "failed" || data.status === "failed") {
            const failMsg =
              (typeof polled?.result?.error === "string" ? polled.result.error : "") ||
              data.error ||
              data.result?.error ||
              polled?.message ||
              "运行失败";
            setError(failMsg);
            setLoading(false);
            return data;
          }

          if (data.status === "running" || polled?.status === "running") {
            pollRef.current = setInterval(() => {
              void pollTask(taskId)
                .then((t) => {
                  if (t.status && t.status !== "running") {
                    stopPolling();
                    setLoading(false);
                    if (t.status === "failed") {
                      const failMsg =
                        (typeof t.result?.error === "string" ? t.result.error : "") ||
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
            }, pollMs);
            return data;
          }
        }

        setLoading(false);
        return data;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "运行失败";
        setError(msg);
        setLoading(false);
        throw e;
      }
    },
    [apiBase, pollMs, pollTask, stopPolling],
  );

  useEffect(() => {
    void loadSuggestions()
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "加载推荐失败");
      })
      .finally(() => setInitLoading(false));
  }, [loadSuggestions]);

  return {
    loading,
    initLoading,
    error,
    task,
    environment,
    suggestions,
    runRecipe,
    loadSuggestions,
    setError,
    resetSession,
  };
}
