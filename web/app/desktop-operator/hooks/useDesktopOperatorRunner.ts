"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getElectronPlatformInfo } from "@/lib/electron-system";
import {
  isTaskAwaitingApproval,
  normalizeApprovalTask,
  shouldPollTaskStatus,
} from "../lib/taskUtils";

export type DesktopTask = {
  id?: string;
  type?: string;
  status?: string;
  progress?: number;
  message?: string;
  error?: string;
  result?: unknown;
  metadata?: Record<string, unknown>;
};

export type DesktopEnvironment = {
  platform?: string;
  allowed_roots?: string[];
  creative_apps?: Record<
    string,
    { installed?: boolean; executable_path?: string | null; profile?: Record<string, unknown> }
  >;
  sidecar_available?: boolean;
  sidecar_port?: number | null;
  sidecar_reason?: string | null;
  active_bridge?: string | null;
  desktop_apps_count?: number;
};

export type DesktopApp = {
  id: string;
  name: string;
  source?: string;
  category?: string;
  executable_path?: string;
  automation_modes?: string[];
};

export type AutomationPlanResult = {
  strategy?: { strategy?: string; reason?: string; suggested_modes?: string[] };
  plan?: Record<string, unknown>;
};

const POLL_INTERVAL_MS = 2000;

export function useDesktopOperatorRunner() {
  const [loading, setLoading] = useState(false);
  const [initLoading, setInitLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [task, setTask] = useState<DesktopTask | null>(null);
  const [environment, setEnvironment] = useState<DesktopEnvironment | null>(null);
  const [apps, setApps] = useState<DesktopApp[]>([]);
  const [lastPlan, setLastPlan] = useState<AutomationPlanResult | null>(null);
  const [clientPlatform, setClientPlatform] = useState("web");
  const [isElectron, setIsElectron] = useState(false);
  const [sidecarChecking, setSidecarChecking] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollTaskIdRef = useRef<string | null>(null);

  const stopPolling = useCallback(() => {
    pollTaskIdRef.current = null;
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  useEffect(() => {
    void getElectronPlatformInfo().then((info) => {
      setIsElectron(info.isElectron);
      setClientPlatform(info.platform);
    });
  }, []);

  const pollTask = useCallback(async (taskId: string) => {
    const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`);
    const data = (await res.json()) as DesktopTask & { detail?: string; error?: string };
    if (!res.ok) {
      throw new Error(data.detail || data.error || "任务查询失败");
    }
    setTask(data);
    return data;
  }, []);

  const applyTaskSnapshot = useCallback(
    (taskId: string, polled: DesktopTask, actionResult?: Record<string, unknown>) => {
      const normalized = normalizeApprovalTask({ ...polled, id: taskId }, actionResult);
      setTask(normalized);
      return normalized;
    },
    [],
  );

  const startPolling = useCallback(
    (taskId: string, actionResult?: Record<string, unknown>) => {
      stopPolling();
      pollTaskIdRef.current = taskId;

      const tick = async () => {
        if (pollTaskIdRef.current !== taskId) return;
        try {
          const polled = await pollTask(taskId);
          const normalized = applyTaskSnapshot(taskId, polled, actionResult);
          if (isTaskAwaitingApproval(normalized, actionResult)) {
            stopPolling();
            setLoading(false);
            return;
          }
          if (shouldPollTaskStatus(normalized.status)) {
            pollRef.current = setTimeout(() => {
              void tick();
            }, POLL_INTERVAL_MS);
            return;
          }
          stopPolling();
          setLoading(false);
        } catch (pollErr) {
          stopPolling();
          setLoading(false);
          setError(pollErr instanceof Error ? pollErr.message : "任务轮询失败");
        }
      };

      pollRef.current = setTimeout(() => {
        void tick();
      }, POLL_INTERVAL_MS);
    },
    [applyTaskSnapshot, pollTask, stopPolling],
  );

  const syncTaskAfterAction = useCallback(
    async (taskId: string, actionResult: Record<string, unknown>) => {
      let polled: DesktopTask;
      try {
        polled = await pollTask(taskId);
      } catch (pollErr) {
        if (actionResult.approval || actionResult.requires_approval) {
          polled = {
            id: taskId,
            status: String(actionResult.status || "waiting_approval"),
            message: typeof actionResult.message === "string" ? actionResult.message : undefined,
            metadata:
              typeof actionResult.approval === "object" && actionResult.approval
                ? {
                    last_approval_id: (actionResult.approval as { id?: string }).id,
                  }
                : undefined,
            result: actionResult,
          };
          setTask(normalizeApprovalTask(polled, actionResult));
          setLoading(false);
          return actionResult;
        }
        throw pollErr;
      }

      const normalized = applyTaskSnapshot(taskId, polled, actionResult);
      if (isTaskAwaitingApproval(normalized, actionResult)) {
        setLoading(false);
        return actionResult;
      }
      if (shouldPollTaskStatus(normalized.status)) {
        startPolling(taskId, actionResult);
        return actionResult;
      }
      setLoading(false);
      return actionResult;
    },
    [applyTaskSnapshot, pollTask, startPolling],
  );

  const loadEnvironment = useCallback(async () => {
    try {
      const res = await fetch("/api/desktop/environment", { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as DesktopEnvironment & {
        error?: string;
        detail?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || data.detail || `环境检测失败 (${res.status})`);
      }
      setEnvironment(data);
      return data;
    } catch (e: unknown) {
      const msg =
        e instanceof TypeError && e.message === "Failed to fetch"
          ? "无法连接 Backend，请确认 start_local.sh 或 start_with_tunnel.sh 已启动"
          : e instanceof Error
            ? e.message
            : "环境检测失败";
      setError(msg);
      return null;
    }
  }, [setError]);

  const ensureSidecar = useCallback(async () => {
    setSidecarChecking(true);
    setError(null);
    try {
      const res = await fetch("/api/desktop/sidecar/ensure", { method: "POST", cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as DesktopEnvironment & {
        error?: string;
        detail?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || data.detail || "Sidecar 检测失败");
      }
      setEnvironment(data);
      return data;
    } catch (e: unknown) {
      const msg =
        e instanceof TypeError && e.message === "Failed to fetch"
          ? "无法连接 Backend，请确认服务已启动后再检测 Sidecar"
          : e instanceof Error
            ? e.message
            : "Sidecar 检测失败";
      setError(msg);
      await loadEnvironment();
      return null;
    } finally {
      setSidecarChecking(false);
    }
  }, [loadEnvironment, setError]);

  const loadApps = useCallback(async (query = "") => {
    try {
      const res = await fetch(
        `/api/desktop/apps?q=${encodeURIComponent(query)}&limit=200`,
        { cache: "no-store" },
      );
      const data = await res.json().catch(() => ({}));
      const list = (data.apps || []) as DesktopApp[];
      if (res.ok) setApps(list);
      return list;
    } catch {
      return [];
    }
  }, []);

  const planAutomation = useCallback(
    async (body: Record<string, unknown>) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/desktop/automation/plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || data.error || "规划失败");
        setLastPlan(data);
        return data as AutomationPlanResult;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const runAutomation = useCallback(
    async (plan: Record<string, unknown>, workingDir: string) => {
      setLoading(true);
      setError(null);
      setTask(null);
      stopPolling();
      try {
        const res = await fetch("/api/desktop/automation/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plan, working_dir: workingDir }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || data.error || "执行失败");
        const taskId = data.task_id as string | undefined;
        if (taskId) {
          await syncTaskAfterAction(taskId, data);
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
    [stopPolling, syncTaskAfterAction],
  );

  const resumeLocalComputerTask = useCallback(async (taskId: string) => {
    const resumeRes = await fetch(`/api/computer/actions/${encodeURIComponent(taskId)}/resume`, {
      method: "POST",
    });
    const resumeData = (await resumeRes.json().catch(() => ({}))) as Record<string, unknown>;
    if (!resumeRes.ok) {
      throw new Error(
        String(resumeData.error || resumeData.detail || "批准后执行失败"),
      );
    }
    return resumeData;
  }, []);

  const resumeNativeUseTask = useCallback(async (taskId: string) => {
    const resumeRes = await fetch(`/api/native-use/${encodeURIComponent(taskId)}/resume`, {
      method: "POST",
    });
    const resumeData = (await resumeRes.json().catch(() => ({}))) as Record<string, unknown>;
    if (!resumeRes.ok) {
      throw new Error(
        String(resumeData.error || resumeData.detail || "GUI 自动化执行失败"),
      );
    }
    return resumeData;
  }, []);

  const resolveTaskType = useCallback(
    async (taskId: string, hint?: string) => {
      if (hint) return hint;
      const polled = await pollTask(taskId);
      return typeof polled.type === "string" ? polled.type : undefined;
    },
    [pollTask],
  );

  const resumeApprovedTaskByType = useCallback(
    async (taskId: string, taskType?: string) => {
      const type = await resolveTaskType(taskId, taskType);
      if (type === "native_use") {
        return resumeNativeUseTask(taskId);
      }
      return resumeLocalComputerTask(taskId);
    },
    [resolveTaskType, resumeNativeUseTask, resumeLocalComputerTask],
  );

  const launchApp = useCallback(
    async (appId: string) => {
      setLoading(true);
      setError(null);
      setTask(null);
      stopPolling();
      try {
        const matched = apps.find((app) => app.id === appId);
        const launchName = matched?.name || appId;
        const res = await fetch("/api/computer/actions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "launch_app",
            app_id: launchName,
            metadata: { source: "desktop_operator_ui", app_id: appId },
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || data.error || "启动失败");
        const taskId = data.task_id as string | undefined;
        if (taskId) {
          await syncTaskAfterAction(taskId, data);
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
    [apps, stopPolling, syncTaskAfterAction],
  );

  const runNativeUse = useCallback(
    async (goal: string, appHint = "") => {
      setLoading(true);
      setError(null);
      setTask(null);
      stopPolling();
      try {
        const res = await fetch("/api/native-use/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ goal, app_hint: appHint, require_approval: true }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || data.error || "GUI 自动化失败");
        const taskId = data.task_id as string | undefined;
        if (taskId) {
          await syncTaskAfterAction(taskId, data);
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
    [stopPolling, syncTaskAfterAction],
  );

  const approveAndResume = useCallback(
    async (approvalId: string, taskId: string, taskType?: string) => {
      setLoading(true);
      setError(null);
      stopPolling();
      try {
        const type = await resolveTaskType(taskId, taskType);
        const approveRes = await fetch(`/api/approvals/${approvalId}/approve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ approved_by: "local_user" }),
        });
        if (!approveRes.ok) {
          const data = await approveRes.json().catch(() => ({}));
          const detail = String(data.error || data.detail || "");
          const alreadyApproved =
            approveRes.status === 409 && detail.toLowerCase().includes("already approved");
          if (!alreadyApproved) {
            throw new Error(detail || "批准失败");
          }
        }

        if (type === "native_use") {
          let resumeData: Record<string, unknown>;
          try {
            resumeData = await resumeNativeUseTask(taskId);
          } catch (resumeErr) {
            const polled = await pollTask(taskId);
            if (polled.status === "completed" || polled.status === "running") {
              const actionResult = (polled.result as Record<string, unknown>) || polled;
              await syncTaskAfterAction(taskId, actionResult);
              if (polled.status === "running") {
                startPolling(taskId, actionResult);
              }
              return;
            }
            throw resumeErr;
          }
          if (resumeData.status === "running") {
            setTask({
              id: taskId,
              type: "native_use",
              status: "running",
              message: String(resumeData.message || "原生自动化执行中"),
            });
            startPolling(taskId, resumeData);
            return;
          }
          await syncTaskAfterAction(taskId, resumeData);
          return;
        }

        const resumeData = await resumeApprovedTaskByType(taskId, type);
        await syncTaskAfterAction(taskId, resumeData);
        if (resumeData.success === false) {
          setError(String(resumeData.stderr || resumeData.error || "任务执行失败"));
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        setLoading(false);
      }
    },
    [
      resolveTaskType,
      resumeNativeUseTask,
      resumeApprovedTaskByType,
      syncTaskAfterAction,
      pollTask,
      startPolling,
      stopPolling,
    ],
  );

  const resumeApprovedTask = useCallback(
    async (taskId: string, taskType?: string) => {
      setLoading(true);
      setError(null);
      stopPolling();
      try {
        const type = await resolveTaskType(taskId, taskType);
        if (type === "native_use") {
          let resumeData: Record<string, unknown>;
          try {
            resumeData = await resumeNativeUseTask(taskId);
          } catch (resumeErr) {
            const polled = await pollTask(taskId);
            if (polled.status === "completed" || polled.status === "running") {
              await syncTaskAfterAction(taskId, (polled.result as Record<string, unknown>) || polled);
              if (polled.status === "running") {
                startPolling(taskId, (polled.result as Record<string, unknown>) || polled);
              }
              return;
            }
            throw resumeErr;
          }
          if (resumeData.status === "running") {
            setTask({
              id: taskId,
              type: "native_use",
              status: "running",
              message: String(resumeData.message || "原生自动化执行中"),
            });
            startPolling(taskId, resumeData);
            return;
          }
          await syncTaskAfterAction(taskId, resumeData);
          return;
        }
        const resumeData = await resumeApprovedTaskByType(taskId, type);
        await syncTaskAfterAction(taskId, resumeData);
        if (resumeData.success === false) {
          setError(String(resumeData.stderr || resumeData.error || "任务执行失败"));
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        setLoading(false);
      }
    },
    [
      resolveTaskType,
      resumeNativeUseTask,
      resumeApprovedTaskByType,
      syncTaskAfterAction,
      startPolling,
      stopPolling,
    ],
  );

  useEffect(() => {
    void (async () => {
      setInitLoading(true);
      try {
        await loadEnvironment();
        await loadApps("");
      } finally {
        setInitLoading(false);
      }
    })();
  }, [loadEnvironment, loadApps]);

  return {
    loading,
    initLoading,
    error,
    task,
    environment,
    apps,
    lastPlan,
    isElectron,
    clientPlatform,
    sidecarChecking,
    loadEnvironment,
    ensureSidecar,
    loadApps,
    planAutomation,
    runAutomation,
    launchApp,
    runNativeUse,
    approveAndResume,
    resumeApprovedTask,
    pollTask,
    setError,
    setLastPlan,
  };
}
