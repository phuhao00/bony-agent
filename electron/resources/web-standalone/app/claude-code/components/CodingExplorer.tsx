"use client";

import type { WorkspaceProjectRow } from "@/lib/electron-workspace";
import {
  ChevronRight,
  FileCode2,
  Folder,
  FolderOpen,
  Layers,
  Loader2,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fileScope,
  folderScope,
  SCOPE_META,
  scopeRequiresTarget,
  type CodingScope,
  type CodingScopeType,
  workspaceScope,
} from "../lib/scope";

type FileEntry = { name: string; kind: "dir" | "file"; relPath: string };

type TreeResponse = {
  error?: string;
  rootAbs?: string;
  rootLabel?: string;
  path?: string;
  entries?: FileEntry[];
};

const scopeTabClass = (active: boolean) =>
  [
    "rounded-md px-2.5 py-1 text-[11px] font-semibold transition",
    active
      ? "bg-[color:var(--accent)] text-white"
      : "text-[color:var(--label-secondary)] hover:bg-[var(--nav-active-fill)] hover:text-[color:var(--foreground)]",
  ].join(" ");

type CodingExplorerProps = {
  scopeType: CodingScopeType;
  scope: CodingScope;
  browseRoot: string | null;
  projects: WorkspaceProjectRow[];
  isElectron: boolean;
  onScopeTypeChange: (t: CodingScopeType) => void;
  onScopeChange: (s: CodingScope) => void;
  onOpenFolder: () => void | Promise<void>;
  onSelectProjectScope: (p: WorkspaceProjectRow) => void;
};

function CodingExplorerInner({
  scopeType,
  scope,
  browseRoot,
  projects,
  isElectron,
  onScopeTypeChange,
  onScopeChange,
  onOpenFolder,
  onSelectProjectScope,
}: CodingExplorerProps) {
  const [browsePath, setBrowsePath] = useState("");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [treeRoot, setTreeRoot] = useState("");
  const [treeLabel, setTreeLabel] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const loadKeyRef = useRef("");

  const loadTree = useCallback(async () => {
    const key = `${browseRoot || ""}|${browsePath}`;
    const isNewTarget = loadKeyRef.current !== key;
    loadKeyRef.current = key;

    if (isNewTarget || entries.length === 0) {
      setLoading(true);
    }
    setError("");

    const q = new URLSearchParams();
    q.set("path", browsePath);
    if (browseRoot) q.set("root", browseRoot);
    try {
      const r = await fetch(`/api/workspace/files?${q.toString()}`);
      const data = (await r.json()) as TreeResponse;
      if (!r.ok) throw new Error(data.error || `${r.status}`);
      if (data.rootAbs) {
        setTreeRoot(data.rootAbs);
        setTreeLabel(data.rootLabel || data.rootAbs);
      }
      setEntries(Array.isArray(data.entries) ? data.entries : []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "加载失败");
      if (isNewTarget) setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [browsePath, browseRoot]);

  useEffect(() => {
    void loadTree();
  }, [loadTree]);

  const crumbs = useMemo(() => {
    if (!browsePath) return [];
    return browsePath.split("/").filter(Boolean);
  }, [browsePath]);

  const navigateTo = (rel: string) => setBrowsePath(rel.replace(/^\/+/, ""));

  const onTab = (t: CodingScopeType) => {
    onScopeTypeChange(t);
    if (t === "workspace") onScopeChange(workspaceScope());
    else if (t === "project") {
      const p = projects.find((row) => row.path?.trim());
      if (p?.path) onSelectProjectScope(p);
    }
  };

  const onFilePick = (e: FileEntry) => {
    onScopeTypeChange("file");
    onScopeChange(fileScope(e.relPath, e.name));
  };

  const onFolderPick = (e: FileEntry) => {
    onScopeTypeChange("folder");
    onScopeChange(folderScope(e.relPath, e.name));
  };

  const onFolderPrimary = (e: FileEntry) => {
    if (scopeType === "folder") {
      onFolderPick(e);
      return;
    }
    navigateTo(e.relPath);
  };

  const isSelected = (relPath: string) => scope.relPath === relPath;

  const hint =
    scopeType === "workspace"
      ? "单击文件夹进入 · 单击文件选中为单文件任务"
      : scopeType === "folder"
        ? "单击文件夹设为范围 · 右侧箭头进入子目录"
        : scopeType === "file"
          ? "单击文件设为 Coding 目标"
          : SCOPE_META[scopeType].hint;

  const showSpinner = loading && entries.length === 0;

  return (
    <aside className="flex min-h-0 flex-col border-r border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)]">
      <div className="shrink-0 space-y-2 border-b border-[color:var(--separator-subtle)] p-2.5">
        <div className="flex flex-wrap items-center gap-1">
          {(Object.keys(SCOPE_META) as CodingScopeType[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => onTab(t)}
              className={scopeTabClass(scopeType === t)}
            >
              {SCOPE_META[t].label}
            </button>
          ))}
          {isElectron ? (
            <button
              type="button"
              onClick={() => void onOpenFolder()}
              title="打开其他文件夹"
              className="ml-auto rounded-md p-1.5 text-[color:var(--accent)] hover:bg-[var(--nav-active-fill)]"
            >
              <FolderOpen className="h-4 w-4" strokeWidth={2} />
            </button>
          ) : null}
        </div>
        <p className="text-[10px] leading-snug text-[color:var(--label-secondary)]">{hint}</p>

        {scopeType === "project" ? (
          <div className="flex flex-wrap gap-1">
            {projects
              .filter((p) => p.path?.trim())
              .map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onSelectProjectScope(p)}
                  className={[
                    "rounded-md px-2 py-1 text-[10px] font-semibold",
                    scope.type === "project" && scope.relPath === p.path
                      ? "bg-[var(--nav-active-fill)] ring-1 ring-[color:color-mix(in_srgb,var(--accent)_30%,transparent)]"
                      : "border border-[color:var(--separator-subtle)] hover:bg-[var(--nav-active-fill)]",
                  ].join(" ")}
                >
                  {p.label}
                </button>
              ))}
          </div>
        ) : null}

        {(scopeRequiresTarget(scopeType) || scopeType === "file") && scope.relPath ? (
          <div className="truncate rounded-md bg-[var(--shell-bg)] px-2 py-1 font-mono text-[10px] text-[color:var(--foreground)]">
            @{scope.relPath}
          </div>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 border-b border-[color:var(--separator-subtle)] px-2.5 py-2">
          <div className="flex flex-wrap items-center gap-0.5 text-[10px]">
            <button
              type="button"
              onClick={() => navigateTo("")}
              className="inline-flex max-w-[8rem] items-center gap-1 truncate rounded px-1 py-0.5 font-semibold text-[color:var(--accent)] hover:bg-[var(--nav-active-fill)]"
              title={treeRoot || browseRoot || ""}
            >
              <Layers className="h-3 w-3 shrink-0" />
              {treeLabel || "根目录"}
            </button>
            {crumbs.map((part, i) => {
              const rel = crumbs.slice(0, i + 1).join("/");
              return (
                <span key={rel} className="inline-flex items-center gap-0.5">
                  <ChevronRight className="h-3 w-3 opacity-40" />
                  <button
                    type="button"
                    onClick={() => navigateTo(rel)}
                    className="max-w-[5rem] truncate rounded px-1 py-0.5 hover:bg-[var(--nav-active-fill)]"
                  >
                    {part}
                  </button>
                </span>
              );
            })}
            {loading && entries.length > 0 ? (
              <Loader2 className="ml-1 h-3 w-3 animate-spin opacity-50" />
            ) : null}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {showSpinner ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-[color:var(--label-secondary)]" />
            </div>
          ) : error ? (
            <p className="px-3 py-4 text-xs text-red-600">{error}</p>
          ) : entries.length === 0 ? (
            <p className="px-3 py-8 text-center text-xs text-[color:var(--label-secondary)]">
              空目录
            </p>
          ) : (
            <ul>
              {entries.map((e) => {
                if (e.kind === "dir") {
                  const selected = isSelected(e.relPath);
                  return (
                    <li key={e.relPath} className="group px-1">
                      <div
                        className={[
                          "flex items-center rounded-md",
                          selected ? "bg-[var(--nav-active-fill)] ring-1 ring-[color:color-mix(in_srgb,var(--accent)_28%,transparent)]" : "",
                        ].join(" ")}
                      >
                        <button
                          type="button"
                          onClick={() => onFolderPrimary(e)}
                          className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-[var(--nav-active-fill)]"
                        >
                          <Folder className="h-4 w-4 shrink-0 text-[color:var(--accent)]" strokeWidth={2} />
                          <span className="truncate font-mono text-[11px]">{e.name}</span>
                        </button>
                        <button
                          type="button"
                          title="进入文件夹"
                          onClick={() => navigateTo(e.relPath)}
                          className="shrink-0 rounded p-1.5 opacity-50 transition hover:bg-[var(--nav-active-fill)] hover:opacity-100 group-hover:opacity-100"
                        >
                          <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </li>
                  );
                }

                const selected = isSelected(e.relPath);
                return (
                  <li key={e.relPath} className="px-1">
                    <button
                      type="button"
                      onClick={() => onFilePick(e)}
                      className={[
                        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs",
                        selected
                          ? "bg-[var(--nav-active-fill)] ring-1 ring-[color:color-mix(in_srgb,var(--accent)_28%,transparent)]"
                          : "hover:bg-[var(--nav-active-fill)]",
                      ].join(" ")}
                    >
                      <FileCode2 className="h-4 w-4 shrink-0 text-[color:var(--label-secondary)]" strokeWidth={2} />
                      <span className="truncate font-mono text-[11px]">{e.name}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </aside>
  );
}

export const CodingExplorer = memo(CodingExplorerInner);
