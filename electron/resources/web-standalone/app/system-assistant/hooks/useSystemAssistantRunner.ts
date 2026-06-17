"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getElectronPlatformInfo,
  isElectronSystemAvailable,
} from "@/lib/electron-system";

export type SystemTask = {
  id?: string;
  status?: string;
  progress?: number;
  message?: string;
  result?: unknown;
  metadata?: Record<string, unknown>;
};

export type EnvironmentProfile = {
  server_platform?: string;
  client_platform?: string | null;
  platform_mismatch?: boolean;
  package_managers?: Record<string, boolean>;
  install_recipe_id?: string | null;
  uninstall_recipe_id?: string | null;
  capabilities?: Record<string, boolean> & {
    media_organize?: boolean;
  };
  ui_labels?: {
    platform_name?: string;
    install_cmd?: string;
    uninstall_cmd?: string;
    package_manager?: string;
    downloads_path?: string;
    desktop_path?: string;
  };
  default_paths?: Record<string, string>;
};

export type SystemSuggestion = {
  id: string;
  title: string;
  description: string;
  recipe_id: string;
  params?: Record<string, unknown>;
  category: string;
  priority: number;
  reason: string;
};

const DIAG_CACHE_KEY = "system-assistant-diag-ts";
const DIAG_CACHE_TTL_MS = 5 * 60 * 1000;

export function useSystemAssistantRunner() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [task, setTask] = useState<SystemTask | null>(null);
  const [isElectron, setIsElectron] = useState(false);
  const [clientPlatform, setClientPlatform] = useState<string>("web");
  const [environment, setEnvironment] = useState<EnvironmentProfile | null>(null);
  const [suggestions, setSuggestions] = useState<SystemSuggestion[]>([]);
  const [diagnostics, setDiagnostics] = useState<Record<string, unknown> | null>(null);
  const [initLoading, setInitLoading] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  useEffect(() => {
    void getElectronPlatformInfo().then((info) => {
      setIsElectron(info.isElectron);
      setClientPlatform(info.platform);
    });
  }, []);

  const pollTask = useCallback(async (taskId: string) => {
    const res = await fetch(`/api/system-assistant/tasks/${encodeURIComponent(taskId)}`);
    const data = await res.json();
    setTask(data);
    return data as SystemTask;
  }, []);

  const loadEnvironment = useCallback(async (platform?: string) => {
    const cp = platform || clientPlatform;
    const q =
      cp && cp !== "web" && cp !== "unknown"
        ? `?client_platform=${encodeURIComponent(cp)}`
        : "";
    const res = await fetch(`/api/system-assistant/environment${q}`);
    const data = await res.json();
    if (res.ok) setEnvironment(data);
    return data as EnvironmentProfile;
  }, [clientPlatform]);

  const loadSuggestions = useCallback(async (platform?: string) => {
    const cp = platform || clientPlatform;
    const q =
      cp && cp !== "web" && cp !== "unknown"
        ? `?client_platform=${encodeURIComponent(cp)}`
        : "";
    const res = await fetch(`/api/system-assistant/suggestions${q}`);
    const data = await res.json();
    if (res.ok) {
      setSuggestions(data.suggestions || []);
      setDiagnostics(data.diagnostics || null);
      setEnvironment(data.environment || null);
    }
    return data;
  }, [clientPlatform]);

  const runDiagnostics = useCallback(async (force = false) => {
    const cachedTs = sessionStorage.getItem(DIAG_CACHE_KEY);
    if (!force && cachedTs && Date.now() - Number(cachedTs) < DIAG_CACHE_TTL_MS) {
      return loadSuggestions();
    }
    setLoading(true);
    setError(null);
    try {
      const data = await loadSuggestions();
      sessionStorage.setItem(DIAG_CACHE_KEY, String(Date.now()));
      setTask({ status: "completed", result: data.diagnostics });
      return data.diagnostics;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      throw e;
    } finally {
      setLoading(false);
    }
  }, [loadSuggestions]);

  const runRecipe = useCallback(
    async (recipeId: string, params: Record<string, unknown> = {}) => {
      setLoading(true);
      setError(null);
      setTask(null);
      stopPolling();
      try {
        const res = await fetch("/api/system-assistant/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recipe_id: recipeId, params }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || data.detail || "运行失败");
        }
        const taskId = data.task_id as string | undefined;
        if (taskId) {
          await pollTask(taskId);
          if (data.status === "waiting_approval") {
            setLoading(false);
            return data;
          }
          pollRef.current = setInterval(async () => {
            const t = await pollTask(taskId);
            if (t.status && !["running", "waiting_approval"].includes(t.status)) {
              stopPolling();
              setLoading(false);
            }
          }, 2000);
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

  const resumeTask = useCallback(
    async (taskId: string) => {
      setLoading(true);
      setError(null);
      stopPolling();
      try {
        const res = await fetch(
          `/api/system-assistant/tasks/${encodeURIComponent(taskId)}/resume`,
          { method: "POST" },
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || data.error || "恢复失败");
        await pollTask(taskId);
        pollRef.current = setInterval(async () => {
          const t = await pollTask(taskId);
          if (t.status && !["running", "waiting_approval"].includes(t.status)) {
            stopPolling();
            setLoading(false);
          }
        }, 2000);
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
            auto_resume_system_assistant: true,
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
        await loadEnvironment(clientPlatform);
        await runDiagnostics(false);
      } finally {
        setInitLoading(false);
      }
    })();
  }, [clientPlatform, loadEnvironment, runDiagnostics]);

  return {
    loading,
    initLoading,
    error,
    task,
    isElectron,
    isElectronAvailable: isElectronSystemAvailable(),
    clientPlatform,
    environment,
    suggestions,
    diagnostics,
    runRecipe,
    runDiagnostics,
    resumeTask,
    approveAndResume,
    pollTask,
    loadEnvironment,
    loadSuggestions,
    setError,
  };
}
