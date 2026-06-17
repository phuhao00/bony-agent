"use client";

import Link from "next/link";
import {
  AlertTriangle,
  FolderOpen,
  Monitor,
  ShieldCheck,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AssistantRecipeShell } from "@/app/components/AssistantRecipeShell";
import { DesktopOperatorActionPanel } from "./components/DesktopOperatorActionPanel";
import { DesktopOperatorComposer } from "./components/DesktopOperatorComposer";
import { DesktopOperatorResultPanel } from "./components/DesktopOperatorResultPanel";
import { useDesktopOperatorRunner } from "./hooks/useDesktopOperatorRunner";
import { validateDesktopPlanBody, type DesktopPreset } from "./lib/presets";

export default function DesktopOperatorPage() {
  const {
    loading,
    initLoading,
    error,
    task,
    environment,
    apps,
    lastPlan,
    isElectron,
    clientPlatform,
    loadEnvironment,
    ensureSidecar,
    sidecarChecking,
    loadApps,
    planAutomation,
    runAutomation,
    launchApp,
    runNativeUse,
    approveAndResume,
    resumeApprovedTask,
    setError,
  } = useDesktopOperatorRunner();

  const [category, setCategory] = useState<string>("recommended");
  const [workingDir, setWorkingDir] = useState("");
  const [lastResult, setLastResult] = useState<unknown>(null);
  const [streamText, setStreamText] = useState("");

  useEffect(() => {
    const root = environment?.allowed_roots?.[0];
    if (root && !workingDir) setWorkingDir(root);
  }, [environment, workingDir]);

  const envBadge = useMemo(() => {
    const platform = environment?.platform || "—";
    const sidecar = environment?.sidecar_available
      ? `Sidecar ✓${environment.sidecar_port ? `:${environment.sidecar_port}` : ""}`
      : "Sidecar —";
    const electron = isElectron ? ` · ${clientPlatform}` : "";
    return `${platform} · ${sidecar}${electron}`;
  }, [environment, isElectron, clientPlatform]);

  const handleLaunchApp = useCallback(
    async (appId: string) => {
      if (!appId) {
        setError("请选择应用");
        return;
      }
      const data = await launchApp(appId);
      setLastResult(data);
    },
    [launchApp, setError],
  );

  const handlePlanAndRun = useCallback(
    async (body: Record<string, unknown>) => {
      const wd = workingDir.trim() || environment?.allowed_roots?.[0] || "";
      if (!wd) {
        setError("请设置工作目录，或在 My Computer 登记根路径");
        return;
      }
      const validationError = validateDesktopPlanBody(body);
      if (validationError) {
        setError(validationError);
        return;
      }
      const planResult = await planAutomation(body);
      const plan = planResult.plan as Record<string, unknown> | undefined;
      if (!plan) {
        setError("规划未返回可执行 plan");
        return;
      }
      if (plan.action === "native_use") {
        const goal = String(body.user_goal || `在 ${body.app_id} 中完成自动化`);
        const data = await runNativeUse(goal, String(body.app_id || ""));
        setLastResult(data);
        return;
      }
      if (plan.action === "launch_app") {
        await handleLaunchApp(String(body.app_id || ""));
        return;
      }
      if (!plan.shell_suggestion && !plan.argv_template) {
        setError("当前策略无可 CLI 执行的命令，请改用 GUI 自动化或 Agent 对话");
        return;
      }
      const data = await runAutomation(plan, wd);
      setLastResult(data);
    },
    [workingDir, environment, planAutomation, runAutomation, runNativeUse, handleLaunchApp, setError],
  );

  const handleRunGui = useCallback(
    async (goal: string, appHint: string) => {
      const data = await runNativeUse(goal, appHint);
      setLastResult(data);
    },
    [runNativeUse],
  );

  const handlePreset = useCallback((preset: DesktopPreset) => {
    if (preset.category === "launch") {
      setCategory("launch");
      return;
    }
    if (preset.category === "gui") {
      setCategory("gui");
      return;
    }
    if (preset.category === "dcc") {
      setCategory("dcc");
    }
  }, []);

  const handleApprove = useCallback(async () => {
    const payload = lastResult as Record<string, unknown> | null;
    const approvalId =
      (payload?.approval as { id?: string } | undefined)?.id ||
      (task?.metadata?.last_approval_id as string | undefined);
    const taskId = (payload?.task_id as string | undefined) || task?.id;
    if (!approvalId || !taskId) {
      setError("缺少审批或任务信息");
      return;
    }
    await approveAndResume(approvalId, taskId, task?.type);
  }, [task, lastResult, approveAndResume, setError]);

  const handleDeny = useCallback(async () => {
    const approvalId =
      (task?.metadata?.last_approval_id as string | undefined) ||
      ((lastResult as Record<string, unknown>)?.approval as { id?: string } | undefined)?.id;
    if (!approvalId) return;
    await fetch(`/api/approvals/${approvalId}/deny`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ denied_by: "local_user", reason: "用户拒绝" }),
    });
  }, [task, lastResult]);

  const handleResume = useCallback(async () => {
    const taskId = task?.id;
    if (!taskId) {
      setError("缺少任务信息");
      return;
    }
    await resumeApprovedTask(taskId, task?.type);
  }, [task, resumeApprovedTask, setError]);

  return (
    <AssistantRecipeShell
      icon={Monitor}
      title="桌面操作员"
      subtitle="Blender / PS / Unity · 启动任意应用 · GUI 视觉自动化"
      badge={envBadge}
      backHref="/labs"
      panelTitle="自动化任务"
      initLoading={initLoading}
      initLoadingLabel="正在加载本机环境…"
      error={error}
      controlsWidthClass="lg:w-[min(100%,500px)] xl:w-[540px]"
      pinFooter
      controls={
        <DesktopOperatorActionPanel
          category={category}
          onCategoryChange={setCategory}
          apps={apps}
          environment={environment}
          loading={loading || initLoading}
          workingDir={workingDir}
          onWorkingDirChange={setWorkingDir}
          onSearchApps={(q) => void loadApps(q)}
          onRunPreset={(p) => void handlePreset(p)}
          onPlanAndRun={(body) => void handlePlanAndRun(body)}
          onLaunchApp={(id) => void handleLaunchApp(id)}
          onRunGui={(goal, hint) => void handleRunGui(goal, hint)}
          sidecarChecking={sidecarChecking}
          onEnsureSidecar={() => void ensureSidecar()}
        />
      }
      footer={
        <DesktopOperatorComposer
          loading={loading}
          onStreamText={setStreamText}
          onError={setError}
        />
      }
      results={
        <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
          {!environment?.allowed_roots?.length && !initLoading && (
            <div className="flex items-start gap-2 rounded-xl border border-[color:var(--status-warning-border)] bg-[var(--status-warning-bg)] px-4 py-3 text-xs leading-relaxed text-[color:var(--status-warning-text)]">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                尚未登记 My Computer 根目录。CLI 执行需要工作目录在允许列表内，请先在{" "}
                <Link href="/settings/my-computer" className="underline">
                  My Computer
                </Link>{" "}
                添加路径。
              </span>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--nav-active-fill)]/50 px-4 py-2.5 text-xs text-[color:var(--label-secondary)]">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-[color:var(--accent)]" />
              高风险桌面操作需审批
            </span>
            <span className="hidden h-3 w-px bg-[var(--border-subtle)] sm:inline-block" />
            <Link
              href="/settings/capabilities?tab=approvals"
              className="inline-flex items-center gap-1 hover:text-[color:var(--accent)] hover:underline"
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              审批中心
            </Link>
            <Link
              href="/settings/my-computer"
              className="inline-flex items-center gap-1 hover:text-[color:var(--accent)] hover:underline"
            >
              <FolderOpen className="h-3.5 w-3.5" />
              My Computer
            </Link>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            <DesktopOperatorResultPanel
            task={task}
            lastPlan={lastPlan}
            lastResult={lastResult}
            loading={loading}
            streamText={streamText}
            onApprove={handleApprove}
            onDeny={handleDeny}
            onResume={handleResume}
          />
          </div>
        </div>
      }
    />
  );
}
