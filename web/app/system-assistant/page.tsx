"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  computerRootPath,
  isUnderRegisteredRoot,
  MY_COMPUTER_SETUP_HINT,
  type ComputerRootEntry,
} from "@/lib/computer-roots";
import {
  AlertTriangle,
  ChevronLeft,
  Cpu,
  FolderOpen,
  HardDrive,
  Loader2,
  Monitor,
  Network,
  ShieldCheck,
  Sparkles,
  Wrench,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { SystemAssistantActionPanel } from "./components/SystemAssistantActionPanel";
import { SystemAssistantComposer } from "./components/SystemAssistantComposer";
import { SystemAssistantRecommendedPanel } from "./components/SystemAssistantRecommendedPanel";
import { SystemAssistantResultPanel } from "./components/SystemAssistantResultPanel";
import { useSystemAssistantRunner } from "./hooks/useSystemAssistantRunner";

type Recipe = {
  id: string;
  name: string;
  category: string;
  description: string;
  requires_approval?: boolean;
};

type AppEntry = {
  id: string;
  name: string;
  category: string;
  packages?: Record<string, string>;
};

type ComputerRoot = ComputerRootEntry;

const CATEGORIES = [
  { id: "recommended", label: "推荐", icon: Sparkles },
  { id: "install", label: "安装", icon: Monitor },
  { id: "uninstall", label: "卸载", icon: HardDrive },
  { id: "repair", label: "修复", icon: Wrench },
  { id: "network", label: "网络", icon: Network },
  { id: "env", label: "环境", icon: Cpu },
  { id: "organize", label: "整理", icon: FolderOpen },
] as const;

export default function SystemAssistantPage() {
  const router = useRouter();
  const {
    loading,
    initLoading,
    error,
    task,
    isElectron,
    clientPlatform,
    environment,
    suggestions,
    runRecipe,
    runDiagnostics,
    approveAndResume,
    setError,
  } = useSystemAssistantRunner();

  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [apps, setApps] = useState<AppEntry[]>([]);
  const [computerRoots, setComputerRoots] = useState<ComputerRoot[]>([]);
  const [category, setCategory] = useState<string>("recommended");
  const [selectedApp, setSelectedApp] = useState("");
  const [organizePath, setOrganizePath] = useState("");
  const [lastResult, setLastResult] = useState<unknown>(null);
  const [streamText, setStreamText] = useState("");

  useEffect(() => {
    void fetch("/api/system-assistant/recipes")
      .then((r) => r.json())
      .then((d) => setRecipes(d.recipes || []));
    void fetch("/api/system-assistant/catalog")
      .then((r) => r.json())
      .then((d) => setApps(d.apps || []));
    void fetch("/api/computer/folders")
      .then((r) => r.json())
      .then((d) => setComputerRoots(d.folders || []))
      .catch(() => setComputerRoots([]));
  }, []);

  useEffect(() => {
    if (computerRoots.length === 0) return;
    const firstPath = computerRootPath(computerRoots[0]);
    if (firstPath && !organizePath) {
      setOrganizePath(firstPath);
    }
  }, [computerRoots, organizePath]);

  const filteredRecipes = useMemo(
    () => recipes.filter((r) => r.category === category),
    [recipes, category],
  );

  const envBadge = useMemo(() => {
    const name = environment?.ui_labels?.platform_name || environment?.server_platform || "—";
    const pm = environment?.ui_labels?.package_manager || "";
    return pm ? `${name} · ${pm}` : name;
  }, [environment]);

  const handleInstall = useCallback(async () => {
    if (!selectedApp) {
      setError("请选择应用");
      return;
    }
    const recipeId = environment?.install_recipe_id;
    if (!recipeId) {
      setError("当前环境不支持安装");
      return;
    }
    const data = await runRecipe(recipeId, { app_id: selectedApp });
    setLastResult(data);
  }, [selectedApp, environment, runRecipe, setError]);

  const handleUninstall = useCallback(async () => {
    if (!selectedApp) {
      setError("请选择应用");
      return;
    }
    const recipeId = environment?.uninstall_recipe_id;
    if (!recipeId) {
      setError("当前环境不支持卸载");
      return;
    }
    const data = await runRecipe(recipeId, { app_id: selectedApp });
    setLastResult(data);
  }, [selectedApp, environment, runRecipe, setError]);

  const handleOrganizePreview = useCallback(async () => {
    if (computerRoots.length === 0) {
      setError(MY_COMPUTER_SETUP_HINT);
      return;
    }
    if (!organizePath.trim()) {
      setError("请选择 My Computer 已登记目录");
      return;
    }
    if (!isUnderRegisteredRoot(organizePath.trim(), computerRoots)) {
      setError("目标路径必须在 My Computer 已登记目录内");
      return;
    }
    const data = await runRecipe("organize.preview", { root_path: organizePath.trim() });
    setLastResult(data);
  }, [computerRoots, organizePath, runRecipe, setError]);

  const handleOrganizeAction = useCallback(
    async (recipeId: string, params: Record<string, unknown>) => {
      if (computerRoots.length === 0) {
        setError(MY_COMPUTER_SETUP_HINT);
        return;
      }
      const rootPath = String(params.root_path || organizePath.trim());
      if (!rootPath) {
        setError("请选择 My Computer 已登记目录");
        return;
      }
      if (!isUnderRegisteredRoot(rootPath, computerRoots)) {
        setError("目标路径必须在 My Computer 已登记目录内");
        return;
      }
      const merged = {
        ...params,
        root_path: rootPath,
      };
      const data = await runRecipe(recipeId, merged);
      setLastResult(data);
    },
    [computerRoots, organizePath, runRecipe, setError],
  );

  const handleApplyOrganize = useCallback(
    async (planId: string) => {
      const data = await runRecipe("organize.apply_batch", { plan_id: planId });
      setLastResult(data);
    },
    [runRecipe],
  );

  const handleRecipe = useCallback(
    async (recipeId: string, params: Record<string, unknown> = {}) => {
      const merged = selectedApp && !params.app_id ? { app_id: selectedApp, ...params } : params;
      const data = await runRecipe(recipeId, merged);
      setLastResult(data);
    },
    [runRecipe, selectedApp],
  );

  const handleSuggestion = useCallback(
    async (recipeId: string, params?: Record<string, unknown>) => {
      if (params?.app_id) setSelectedApp(String(params.app_id));
      if (params?.root_path) setOrganizePath(String(params.root_path));
      const cat = suggestions.find((s) => s.recipe_id === recipeId)?.category;
      if (cat) setCategory(cat);
      const data = await runRecipe(recipeId, params || {});
      setLastResult(data);
    },
    [runRecipe, suggestions],
  );

  const handlePreset = useCallback(
    async (recipeId: string, params?: Record<string, unknown>, cat?: string) => {
      if (cat) setCategory(cat);
      if (params?.root_path) setOrganizePath(String(params.root_path));
      const data = await runRecipe(recipeId, params || {});
      setLastResult(data);
    },
    [runRecipe],
  );

  const handleDiagnostics = useCallback(async () => {
    const data = await runDiagnostics(true);
    setLastResult(data);
  }, [runDiagnostics]);

  const handleApprove = useCallback(async () => {
    const payload = lastResult as Record<string, unknown> | null;
    const approvalId =
      (payload?.approval as { id?: string } | undefined)?.id ||
      (task?.metadata?.last_approval_id as string | undefined);
    const taskId =
      (payload?.task_id as string | undefined) || task?.id;
    if (!approvalId || !taskId) {
      setError("缺少审批或任务信息");
      return;
    }
    await approveAndResume(approvalId, taskId);
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

  return (
    <div className="page-canvas flex h-[calc(100dvh-4rem)] flex-col overflow-hidden bg-[var(--shell-bg)]">
      <header className="shrink-0 border-b border-[color:var(--separator-subtle)] px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-7xl items-center gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[color:var(--label-secondary)] transition-colors hover:bg-[var(--nav-active-fill)] hover:text-[color:var(--foreground)]"
            aria-label="返回"
          >
            <ChevronLeft className="h-5 w-5" strokeWidth={2.5} />
          </button>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--accent)] text-white shadow-sm">
            <Sparkles className="h-5 w-5" strokeWidth={2} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-semibold text-[color:var(--foreground)]">电脑助手</h1>
              <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                执行环境 · {envBadge}
              </span>
              {isElectron && (
                <span className="rounded-md border border-[var(--border-subtle)] bg-[var(--nav-active-fill)] px-2 py-0.5 text-[11px] text-[color:var(--label-secondary)]">
                  客户端 · {clientPlatform}
                </span>
              )}
            </div>
            <p className="text-sm text-[color:var(--label-secondary)]">
              安装卸载 · 网络修复 · 环境配置 · 文件与图片整理
            </p>
          </div>
          <button
            type="button"
            disabled={loading || initLoading}
            onClick={() => void handleDiagnostics()}
            className="hidden shrink-0 items-center gap-2 rounded-xl bg-[var(--nav-active-fill)] px-4 py-2 text-sm font-medium text-[color:var(--foreground)] hover:opacity-90 disabled:opacity-50 sm:inline-flex"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ShieldCheck className="h-4 w-4" />
            )}
            重新诊断
          </button>
        </div>
        {environment?.platform_mismatch && (
          <div className="mx-auto mt-3 flex max-w-7xl items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-800 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              客户端系统（{clientPlatform}）与后端执行环境（{environment.server_platform}）不一致。
              安装/卸载等命令将在后端主机上执行，而非你的本机。
            </span>
          </div>
        )}
      </header>

      <div className="mx-auto flex w-full max-w-7xl min-h-0 flex-1 flex-col gap-4 overflow-hidden px-4 py-5 sm:px-6 lg:flex-row lg:gap-6">
        <aside className="w-full shrink-0 overflow-y-auto lg:w-56 xl:w-60">
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--card-bg)] p-2">
            <button
              type="button"
              disabled={loading || initLoading}
              onClick={() => void handleDiagnostics()}
              className="mb-2 flex w-full items-center gap-2 rounded-xl bg-[color:color-mix(in_srgb,var(--accent)_14%,transparent)] px-3 py-2.5 text-sm font-medium text-[color:var(--accent)] hover:opacity-90 disabled:opacity-50 sm:hidden"
            >
              <ShieldCheck className="h-4 w-4" />
              重新诊断
            </button>
            <nav className="space-y-0.5">
              {CATEGORIES.map((c) => {
                const Icon = c.icon;
                const active = category === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setCategory(c.id)}
                    className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${
                      active
                        ? "bg-[var(--foreground)] font-medium text-[var(--background)]"
                        : "text-[color:var(--label-secondary)] hover:bg-[var(--nav-active-fill)] hover:text-[color:var(--foreground)]"
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" strokeWidth={active ? 2.2 : 2} />
                    {c.label}
                  </button>
                );
              })}
            </nav>
          </div>

          <div className="mt-3 space-y-1 rounded-2xl border border-[var(--border-subtle)] bg-[var(--card-bg)] p-2">
            <Link
              href="/settings/capabilities?tab=approvals"
              className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-[color:var(--label-secondary)] hover:bg-[var(--nav-active-fill)] hover:text-[color:var(--foreground)]"
            >
              <ShieldCheck className="h-4 w-4" />
              审批中心
            </Link>
            <Link
              href="/settings/my-computer"
              className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-[color:var(--label-secondary)] hover:bg-[var(--nav-active-fill)] hover:text-[color:var(--foreground)]"
            >
              <FolderOpen className="h-4 w-4" />
              My Computer
            </Link>
          </div>
        </aside>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden xl:flex-row xl:gap-5">
          <div className="min-w-0 flex-1 space-y-4 overflow-y-auto xl:max-w-[52%]">
            <SystemAssistantComposer
              loading={loading}
              onStreamText={setStreamText}
              onError={setError}
            />
            {error && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
                {error}
              </div>
            )}
            {category === "recommended" ? (
              <SystemAssistantRecommendedPanel
                environment={environment}
                suggestions={suggestions}
                loading={loading}
                initLoading={initLoading}
                onRunSuggestion={(id, params) => void handleSuggestion(id, params)}
                onRunPreset={(id, params, cat) => void handlePreset(id, params, cat)}
              />
            ) : (
              <SystemAssistantActionPanel
                category={category}
                apps={apps}
                recipes={filteredRecipes}
                environment={environment}
                selectedApp={selectedApp}
                onSelectApp={setSelectedApp}
                organizePath={organizePath}
                onOrganizePathChange={setOrganizePath}
                computerRoots={computerRoots}
                loading={loading}
                onInstall={() => void handleInstall()}
                onUninstall={() => void handleUninstall()}
                onOrganizePreview={() => void handleOrganizePreview()}
                onRunOrganizeAction={(id, params) => void handleOrganizeAction(id, params)}
                onRunRecipe={(id) => void handleRecipe(id)}
              />
            )}
          </div>

          <div className="min-h-0 min-w-0 flex-1 overflow-hidden xl:max-w-[48%]">
            <SystemAssistantResultPanel
              task={task}
              lastResult={lastResult}
              loading={loading}
              streamText={streamText}
              onApprove={handleApprove}
              onDeny={handleDeny}
              onApplyOrganize={(planId) => void handleApplyOrganize(planId)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
