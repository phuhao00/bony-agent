"use client";

import { Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ComputerUseInputPanel } from "./components/ComputerUseInputPanel";
import { ComputerUsePreviewPanel } from "./components/ComputerUsePreviewPanel";
import { useComputerUseRunner } from "./hooks/useComputerUseRunner";
import { DDG_SEARCH_HTML, inferStartUrl } from "./lib/inferStartUrl";
import type { RunMeta } from "./lib/types";

export default function ComputerUsePage() {
  const router = useRouter();
  const {
    loading,
    error,
    setError,
    result,
    setResult,
    submitRun,
    cancelRun,
    resumeAfterApproval,
  } = useComputerUseRunner();

  const [goal, setGoal] = useState("");
  const [manualStartUrl, setManualStartUrl] = useState(DDG_SEARCH_HTML);
  const [autoEntry, setAutoEntry] = useState(true);
  const [maxRounds, setMaxRounds] = useState(4);
  const [headless, setHeadless] = useState(true);
  const [autoresearchEnabled, setAutoresearchEnabled] = useState(true);
  const [requireApproval, setRequireApproval] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [lastRunMeta, setLastRunMeta] = useState<RunMeta | null>(null);

  const inferred = useMemo(() => inferStartUrl(goal), [goal]);
  const effectiveStartUrl = autoEntry ? inferred.url : manualStartUrl.trim();
  const isQuickMode =
    !requireApproval && autoEntry && maxRounds === 3 && headless;

  useEffect(() => {
    try {
      const saved = localStorage.getItem("computer_use_require_approval");
      if (saved === "1") setRequireApproval(true);
      if (saved === "0") setRequireApproval(false);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(
        "computer_use_require_approval",
        requireApproval ? "1" : "0",
      );
    } catch {
      /* ignore */
    }
  }, [requireApproval]);

  useEffect(() => {
    if (!loading) return;
    setElapsedSec(0);
    const t = setInterval(() => setElapsedSec((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [loading]);

  const run = useCallback(async () => {
    setResult(null);
    const g = goal.trim();
    if (!g) return;

    let startUrl = effectiveStartUrl;
    if (!autoEntry) {
      try {
        const u = new URL(manualStartUrl.trim());
        if (u.protocol !== "http:" && u.protocol !== "https:") {
          setError("起始地址必须是 http(s) 链接");
          return;
        }
        startUrl = u.href;
      } catch {
        setError(
          "起始地址格式不对，请检查 URL（例如 https://html.duckduckgo.com/html/）",
        );
        return;
      }
    }

    setLastRunMeta({
      startUrl,
      hint: autoEntry ? inferred.hint : "手动指定的起始页",
    });

    await submitRun({
      goal: g,
      start_url: startUrl,
      max_rounds: maxRounds,
      headless,
      autoresearch: autoresearchEnabled,
      require_approval: requireApproval,
    });
  }, [
    goal,
    effectiveStartUrl,
    autoEntry,
    manualStartUrl,
    maxRounds,
    headless,
    autoresearchEnabled,
    requireApproval,
    inferred.hint,
    submitRun,
    setResult,
    setError,
  ]);

  const handleApprove = useCallback(async () => {
    const approvalId = result?.approval?.id;
    const taskId = result?.task_id;
    if (!approvalId || !taskId) return;
    await resumeAfterApproval(approvalId, taskId);
  }, [result, resumeAfterApproval]);

  const handleDeny = useCallback(async () => {
    const approvalId = result?.approval?.id;
    if (!approvalId) return;

    try {
      const res = await fetch(`/api/approvals/${approvalId}/deny`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approved_by: "local_user" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || data.detail || "拒绝失败");
      }
      setResult(null);
      setError("已拒绝该步骤，任务已取消。");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "拒绝失败");
    }
  }, [result, setResult, setError]);

  const resetSession = () => {
    setResult(null);
    setError("");
    setLastRunMeta(null);
  };

  const applyQuickMode = () => {
    setRequireApproval(false);
    setAutoEntry(true);
    setMaxRounds(3);
    setHeadless(true);
  };

  return (
    <div className="page-canvas flex min-h-[calc(100vh-4rem)] flex-col bg-[var(--shell-bg)]">
      <header className="shrink-0 border-b border-[color:var(--separator-subtle)] px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-7xl items-center gap-3">
          <button
            onClick={() => router.back()}
            className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-xl text-[color:var(--label-secondary)] transition-colors hover:bg-[var(--nav-active-fill)] hover:text-[color:var(--foreground)] sm:flex"
            aria-label="返回"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--accent)] text-white shadow-sm">
            <Sparkles className="h-5 w-5" strokeWidth={2} />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold text-[color:var(--foreground)]">
              Computer Use
            </h1>
            <p className="text-sm text-[color:var(--label-secondary)]">
              默认全自动执行；每 2 秒同步截图与步骤进度
            </p>
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:flex-row lg:gap-8">
        <div className="w-full lg:w-[38%] lg:min-w-[320px] lg:max-w-[420px] lg:shrink-0">
          <ComputerUseInputPanel
            goal={goal}
            setGoal={setGoal}
            manualStartUrl={manualStartUrl}
            setManualStartUrl={setManualStartUrl}
            autoEntry={autoEntry}
            setAutoEntry={setAutoEntry}
            maxRounds={maxRounds}
            setMaxRounds={setMaxRounds}
            headless={headless}
            setHeadless={setHeadless}
            autoresearchEnabled={autoresearchEnabled}
            setAutoresearchEnabled={setAutoresearchEnabled}
            requireApproval={requireApproval}
            setRequireApproval={setRequireApproval}
            showAdvanced={showAdvanced}
            setShowAdvanced={setShowAdvanced}
            loading={loading}
            elapsedSec={elapsedSec}
            taskStatus={result?.status}
            computerUse={result?.computer_use}
            error={error}
            inferredUrl={inferred.url}
            inferredHint={inferred.hint}
            lastRunMeta={lastRunMeta}
            hasResult={Boolean(result)}
            totalSteps={result?.total_steps_executed}
            onRun={() => void run()}
            onCancel={() => void cancelRun()}
            onReset={resetSession}
            onQuickMode={applyQuickMode}
            isQuickMode={isQuickMode}
          />
        </div>

        <div className="min-w-0 flex-1">
          <ComputerUsePreviewPanel
            loading={loading}
            result={result}
            onApprove={handleApprove}
            onDeny={handleDeny}
          />
        </div>
      </div>
    </div>
  );
}
