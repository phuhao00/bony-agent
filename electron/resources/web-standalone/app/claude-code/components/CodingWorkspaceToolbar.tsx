"use client";

import type { WorkspaceProjectRow } from "@/lib/electron-workspace";
import {
  Check,
  ChevronDown,
  FolderGit2,
  FolderOpen,
  GitBranch,
  Loader2,
  RefreshCw,
  Upload,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

type GitSummary = {
  gitAvailable: boolean;
  branch: string | null;
  dirtyCount: number;
};

type CodingWorkspaceToolbarProps = {
  projects: WorkspaceProjectRow[];
  selectedId: string;
  selectedProject: WorkspaceProjectRow | null;
  effectiveRoot: string | null;
  rootLabel: string;
  gitSummary: GitSummary | null;
  loadingGit: boolean;
  isElectron: boolean;
  gitBusy?: boolean;
  canGitCommit?: boolean;
  canGitPush?: boolean;
  onSelectProject: (id: string) => void;
  onOpenFolder: () => void | Promise<void>;
  onRefreshGit: () => void | Promise<void>;
  onGitCommit?: (message: string) => void | Promise<void>;
  onGitPush?: () => void | Promise<void>;
  onGitCommitAndPush?: (message: string) => void | Promise<void>;
};

export function CodingWorkspaceToolbar({
  projects,
  selectedId,
  selectedProject,
  effectiveRoot,
  rootLabel,
  gitSummary,
  loadingGit,
  isElectron,
  gitBusy = false,
  canGitCommit = false,
  canGitPush = false,
  onSelectProject,
  onOpenFolder,
  onRefreshGit,
  onGitCommit,
  onGitPush,
  onGitCommitAndPush,
}: CodingWorkspaceToolbarProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [commitOpen, setCommitOpen] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const withPath = useMemo(
    () => projects.filter((p) => p.path?.trim()),
    [projects],
  );

  const gitLabel =
    gitSummary?.gitAvailable && gitSummary.branch
      ? `${gitSummary.branch}${gitSummary.dirtyCount ? ` · ${gitSummary.dirtyCount} 改动` : ""}`
      : effectiveRoot
        ? "非 Git"
        : "—";

  const submitCommit = async (andPush: boolean) => {
    const msg = commitMessage.trim();
    if (andPush) await onGitCommitAndPush?.(msg);
    else await onGitCommit?.(msg);
    setCommitMessage("");
    setCommitOpen(false);
  };

  return (
    <div
      ref={wrapRef}
      className="flex shrink-0 flex-col gap-1.5 border-b border-[color:var(--separator-subtle)] bg-[var(--shell-bg)] px-3 py-1.5 sm:px-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center gap-2 rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] px-2.5 py-1.5 text-xs font-semibold hover:bg-[var(--nav-active-fill)]"
          >
            <FolderGit2 className="h-3.5 w-3.5 text-[color:var(--accent)]" strokeWidth={2} />
            <span className="max-w-[10rem] truncate sm:max-w-[16rem]">
              {selectedProject?.label || rootLabel}
            </span>
            <ChevronDown className={`h-3.5 w-3.5 opacity-50 ${open ? "rotate-180" : ""}`} />
          </button>
          {open ? (
            <div
              id={menuId}
              className="popover-surface absolute left-0 top-full z-50 mt-1 min-w-[14rem] overflow-hidden rounded-xl border border-[color:var(--separator-subtle)] py-1 shadow-lg"
            >
              {withPath.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    onSelectProject(p.id);
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-[var(--nav-active-fill)]"
                >
                  <span className="min-w-0 flex-1 truncate font-semibold">{p.label}</span>
                  {selectedId === p.id ? (
                    <Check className="h-3.5 w-3.5 text-[color:var(--accent)]" />
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {isElectron ? (
          <button
            type="button"
            onClick={() => void onOpenFolder()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--separator-subtle)] px-2.5 py-1.5 text-xs font-semibold hover:bg-[var(--nav-active-fill)]"
          >
            <FolderOpen className="h-3.5 w-3.5 text-[color:var(--accent)]" />
            打开文件夹
          </button>
        ) : null}

        <div className="flex items-center gap-1 rounded-lg border border-[color:var(--separator-subtle)] px-2.5 py-1.5 text-xs">
          <GitBranch className="h-3.5 w-3.5 text-[color:var(--label-secondary)]" />
          {loadingGit ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <span className="font-mono text-[11px]">{gitLabel}</span>
          )}
          <button
            type="button"
            onClick={() => void onRefreshGit()}
            className="rounded p-0.5 hover:bg-[var(--nav-active-fill)]"
          >
            <RefreshCw className="h-3 w-3 opacity-40" />
          </button>
        </div>

        {canGitCommit ? (
          <button
            type="button"
            disabled={gitBusy}
            onClick={() => setCommitOpen((v) => !v)}
            className="inline-flex items-center gap-1 rounded-lg border border-[color:var(--separator-subtle)] px-2.5 py-1.5 text-xs font-semibold hover:bg-[var(--nav-active-fill)] disabled:opacity-50"
          >
            {gitBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            提交
          </button>
        ) : null}

        {canGitPush ? (
          <button
            type="button"
            disabled={gitBusy}
            onClick={() => void onGitPush?.()}
            className="inline-flex items-center gap-1 rounded-lg border border-[color:var(--separator-subtle)] px-2.5 py-1.5 text-xs font-semibold hover:bg-[var(--nav-active-fill)] disabled:opacity-50"
          >
            <Upload className="h-3 w-3" />
            推送
          </button>
        ) : null}

        {effectiveRoot ? (
          <span
            className="min-w-0 flex-1 truncate font-mono text-[10px] text-[color:var(--label-secondary)]"
            title={effectiveRoot}
          >
            {effectiveRoot}
          </span>
        ) : null}
      </div>

      {commitOpen ? (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] p-2">
          <label className="min-w-[12rem] flex-1 text-[10px] text-[color:var(--label-secondary)]">
            提交说明
            <input
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void submitCommit(false);
                }
              }}
              placeholder="留空则自动分析 diff 并生成说明"
              className="mt-1 w-full rounded-md border border-[color:var(--separator-subtle)] bg-[var(--shell-bg)] px-2 py-1.5 text-xs text-[color:var(--foreground)] outline-none focus:ring-1 focus:ring-[color:var(--accent)]"
            />
          </label>
          <button
            type="button"
            disabled={gitBusy}
            onClick={() => void submitCommit(false)}
            className="rounded-lg bg-[color:var(--accent)] px-3 py-1.5 text-xs font-bold text-white disabled:opacity-45"
          >
            仅提交
          </button>
          <button
            type="button"
            disabled={gitBusy}
            onClick={() => void submitCommit(true)}
            className="rounded-lg border border-[color:var(--accent)] px-3 py-1.5 text-xs font-bold text-[color:var(--accent)] disabled:opacity-45"
          >
            提交并推送
          </button>
        </div>
      ) : null}
    </div>
  );
}
