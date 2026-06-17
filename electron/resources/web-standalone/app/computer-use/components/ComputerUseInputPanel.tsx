"use client";

import {
  ChevronDown,
  Loader2,
  MonitorPlay,
  MousePointer2,
  RotateCcw,
  Settings2,
  Sparkles,
  Zap,
} from "lucide-react";
import { DDG_SEARCH_HTML } from "../lib/inferStartUrl";
import { PRESETS, QUICK_MODE_LABEL } from "../lib/presets";
import type { ComputerUseProgressMeta, RunMeta } from "../lib/types";
import { ComputerUseProgress } from "./ComputerUseProgress";

export type InputPanelProps = {
  goal: string;
  setGoal: (v: string) => void;
  manualStartUrl: string;
  setManualStartUrl: (v: string) => void;
  autoEntry: boolean;
  setAutoEntry: (v: boolean) => void;
  maxRounds: number;
  setMaxRounds: (v: number) => void;
  headless: boolean;
  setHeadless: (v: boolean) => void;
  autoresearchEnabled: boolean;
  setAutoresearchEnabled: (v: boolean) => void;
  requireApproval: boolean;
  setRequireApproval: (v: boolean) => void;
  showAdvanced: boolean;
  setShowAdvanced: (v: boolean) => void;
  loading: boolean;
  elapsedSec: number;
  taskStatus?: string;
  computerUse?: ComputerUseProgressMeta;
  error: string;
  inferredUrl: string;
  inferredHint: string;
  lastRunMeta: RunMeta | null;
  hasResult: boolean;
  totalSteps?: number;
  onRun: () => void;
  onCancel: () => void;
  onReset: () => void;
  onQuickMode: () => void;
  isQuickMode: boolean;
};

export function ComputerUseInputPanel(props: InputPanelProps) {
  const {
    goal,
    setGoal,
    manualStartUrl,
    setManualStartUrl,
    autoEntry,
    setAutoEntry,
    maxRounds,
    setMaxRounds,
    headless,
    setHeadless,
    autoresearchEnabled,
    setAutoresearchEnabled,
    requireApproval,
    setRequireApproval,
    showAdvanced,
    setShowAdvanced,
    loading,
    elapsedSec,
    taskStatus,
    computerUse,
    error,
    inferredUrl,
    inferredHint,
    lastRunMeta,
    hasResult,
    totalSteps,
    onRun,
    onCancel,
    onReset,
    onQuickMode,
    isQuickMode,
  } = props;

  return (
    <section className="card-surface flex min-h-0 flex-col overflow-hidden rounded-2xl lg:min-h-[calc(100vh-12rem)]">
      <div className="flex items-center justify-between gap-2 border-b border-[color:var(--separator-subtle)] px-4 pb-2 pt-4 sm:px-5">
        <span className="text-xs font-semibold uppercase tracking-wider text-[color:var(--label-secondary)]">
          想做什么？
        </span>
        {hasResult && (
          <button
            type="button"
            onClick={onReset}
            className="flex items-center gap-1 text-xs font-medium text-[color:var(--accent)] hover:underline"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            新任务
          </button>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex-1 space-y-3 overflow-y-auto p-4 sm:p-5">
          {lastRunMeta && hasResult && !loading && (
            <div className="rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] px-3 py-2 text-xs text-[color:var(--label-secondary)]">
              <span className="font-medium text-[color:var(--foreground)]">
                任务摘要
              </span>
              <p className="mt-1 break-all font-mono text-[color:var(--foreground)]">
                {lastRunMeta.startUrl}
              </p>
              <p className="mt-0.5 opacity-80">{lastRunMeta.hint}</p>
              {typeof totalSteps === "number" && (
                <p className="mt-1">
                  共约{" "}
                  <strong className="text-[color:var(--foreground)]">
                    {totalSteps}
                  </strong>{" "}
                  个原子操作
                </p>
              )}
            </div>
          )}

          <textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            disabled={loading}
            rows={5}
            placeholder="例如：帮我查一下深圳明天会不会下雨，把搜索结果截个图"
            className="min-h-[130px] w-full resize-none rounded-2xl border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] px-4 py-3.5 text-[15px] leading-relaxed text-[color:var(--foreground)] outline-none placeholder:text-[color:var(--label-secondary)] transition-colors focus:border-[color:var(--accent)] focus:ring-2 focus:ring-[color:color-mix(in_srgb,var(--accent)_35%,transparent)]"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                if (!loading && goal.trim()) onRun();
              }
            }}
          />

          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium ${
                requireApproval
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-700"
                  : "border-emerald-500/35 bg-emerald-500/10 text-emerald-700"
              }`}
            >
              {requireApproval ? "逐步审批已开启" : "全自动运行"}
            </span>
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] px-3 py-1.5 text-xs text-[color:var(--foreground)]">
              <input
                type="checkbox"
                checked={requireApproval}
                onChange={(e) => setRequireApproval(e.target.checked)}
                disabled={loading}
                className="rounded accent-[var(--accent)]"
              />
              步骤需审批
            </label>
            <button
              type="button"
              disabled={loading}
              onClick={onQuickMode}
              className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                isQuickMode
                  ? "border-[color:var(--accent)] bg-[var(--nav-active-fill)] text-[color:var(--accent)]"
                  : "border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] text-[color:var(--foreground)] hover:border-[color:color-mix(in_srgb,var(--accent)_40%,transparent)] hover:bg-[var(--nav-active-fill)]"
              }`}
            >
              <Zap className="h-3.5 w-3.5" />
              {QUICK_MODE_LABEL}
            </button>
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                disabled={loading}
                onClick={() => {
                  setGoal(p.goal);
                  setAutoEntry(true);
                }}
                className="rounded-full border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] px-3 py-1.5 text-xs font-medium text-[color:var(--foreground)] transition-colors hover:border-[color:color-mix(in_srgb,var(--accent)_40%,transparent)] hover:bg-[var(--nav-active-fill)] disabled:opacity-50"
              >
                {p.label}
              </button>
            ))}
          </div>

          {autoEntry && goal.trim() && (
            <p className="flex items-start gap-1.5 rounded-xl border border-[color:color-mix(in_srgb,var(--accent)_20%,transparent)] bg-[var(--nav-active-fill)] px-3 py-2 text-xs text-[color:var(--label-secondary)]">
              <MousePointer2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[color:var(--accent)]" />
              <span>
                将打开{" "}
                <span className="break-all font-mono text-[color:var(--foreground)]">
                  {inferredUrl}
                </span>
                <span className="opacity-80"> · {inferredHint}</span>
              </span>
            </p>
          )}

          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1.5 text-xs text-[color:var(--label-secondary)] hover:text-[color:var(--foreground)]"
          >
            <Settings2 className="h-3.5 w-3.5" />
            {showAdvanced
              ? "收起高级选项"
              : "高级选项（起始 URL、轮数、有头模式）"}
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${showAdvanced ? "rotate-180" : ""}`}
            />
          </button>

          {showAdvanced && (
            <div className="space-y-4 rounded-2xl border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] p-4 text-sm">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={autoEntry}
                  onChange={(e) => setAutoEntry(e.target.checked)}
                  className="rounded border-[color:var(--separator-subtle)] accent-[var(--accent)]"
                />
                <span className="text-[color:var(--foreground)]">
                  自动根据任务选择起始页（推荐）
                </span>
              </label>
              {!autoEntry && (
                <div>
                  <label className="text-xs font-medium text-[color:var(--label-secondary)]">
                    起始 URL
                  </label>
                  <input
                    type="url"
                    value={manualStartUrl}
                    onChange={(e) => setManualStartUrl(e.target.value)}
                    placeholder={DDG_SEARCH_HTML}
                    className="mt-1 w-full rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-3 py-2 font-mono text-sm text-[color:var(--foreground)] outline-none focus:border-[color:var(--accent)]"
                  />
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-[color:var(--label-secondary)]">
                    最大规划轮数
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={8}
                    value={maxRounds}
                    onChange={(e) => setMaxRounds(Number(e.target.value) || 4)}
                    className="mt-1 w-full rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-3 py-2 text-sm text-[color:var(--foreground)] outline-none focus:border-[color:var(--accent)]"
                  />
                </div>
                <label className="flex cursor-pointer items-end gap-2 pb-2">
                  <input
                    type="checkbox"
                    checked={!headless}
                    onChange={(e) => setHeadless(!e.target.checked)}
                    className="rounded border-[color:var(--separator-subtle)] accent-[var(--accent)]"
                  />
                  <span className="flex items-center gap-1 text-[color:var(--foreground)]">
                    <MonitorPlay className="h-4 w-4 text-[color:var(--label-secondary)]" />
                    有界面 Chromium
                  </span>
                </label>
              </div>
              <label className="flex cursor-pointer items-start gap-2">
                <input
                  type="checkbox"
                  checked={autoresearchEnabled}
                  onChange={(e) => setAutoresearchEnabled(e.target.checked)}
                  className="mt-0.5 rounded border-[color:var(--separator-subtle)] accent-[var(--accent)]"
                />
                <span>
                  <span className="font-medium text-[color:var(--foreground)]">
                    自动生成研究报告（AutoResearch）
                  </span>
                  <span className="mt-0.5 block text-xs text-[color:var(--label-secondary)]">
                    任务结束后用大模型阅读最终页面正文摘录，输出结论与后续检索建议。
                  </span>
                </span>
              </label>
            </div>
          )}

          {loading && (
            <ComputerUseProgress
              elapsedSec={elapsedSec}
              taskStatus={taskStatus}
              computerUse={computerUse}
            />
          )}

          {error && (
            <div className="rounded-2xl border border-red-500/35 bg-red-500/10 px-4 py-3 text-sm text-red-600">
              {error}
            </div>
          )}
        </div>

        <div className="sticky bottom-0 border-t border-[color:var(--separator-subtle)] bg-[var(--card-bg)] p-4 sm:p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={onRun}
              disabled={loading || !goal.trim()}
              className="inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-2xl bg-[var(--accent)] px-6 py-3.5 text-sm font-semibold text-white shadow-md shadow-black/10 transition-all hover:opacity-95 active:scale-[0.99] disabled:pointer-events-none disabled:opacity-45"
            >
              {loading ? (
                <>
                  <Loader2 className="h-5 w-5 shrink-0 animate-spin" />
                  <span className="truncate">执行中… {elapsedSec}s</span>
                </>
              ) : (
                <>
                  <Sparkles className="h-5 w-5 shrink-0" />
                  运行（⌘/Ctrl + Enter）
                </>
              )}
            </button>
            {loading && (
              <button
                type="button"
                onClick={onCancel}
                className="inline-flex min-h-[48px] items-center justify-center rounded-2xl border border-[color:var(--separator-subtle)] px-5 py-3.5 text-sm font-medium text-[color:var(--foreground)] hover:bg-[var(--nav-active-fill)]"
              >
                取消
              </button>
            )}
          </div>
          {!loading && (
            <p className="mt-2 text-[11px] leading-snug text-[color:var(--label-secondary)]">
              仅自动化后端浏览器。首次冷启动 Chromium 常见 15–45s；多轮 LLM
              可能再需数分钟。
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
