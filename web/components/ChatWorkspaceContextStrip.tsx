"use client";

import { useTranslation } from "@/hooks/useTranslation";
import {
  getElectronWorkspaceApi,
  type WorkspaceProjectRow,
} from "@/lib/electron-workspace";
import {
  readWorkspaceProjects,
  writeWorkspaceProjects,
} from "@/lib/workspace-projects";
import { broadcastWorkspaceSelectionChanged } from "@/lib/workspace-selection-sync";
import {
  Check,
  ChevronDown,
  ChevronUp,
  FolderGit2,
  FolderX,
  GitBranch,
  Laptop,
  Plus,
  Search,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

const LS_SELECTED = "chat.workspace.selectedProject.v1";
const LS_MODE = "chat.workspace.runMode.v1";
const NONE_ID = "__none__";

type GitSummary = {
  gitAvailable: boolean;
  projectLabel: string;
  branch: string | null;
  dirtyCount: number;
  rootPath?: string;
  error?: string;
};

type ProjectRow = WorkspaceProjectRow;

function readSelected(): string {
  if (typeof window === "undefined") return "default";
  try {
    return localStorage.getItem(LS_SELECTED) || "default";
  } catch {
    return "default";
  }
}

function writeSelected(id: string) {
  try {
    localStorage.setItem(LS_SELECTED, id);
  } catch {
    /* ignore */
  }
}

type RunMode = "local" | "cloud";

function readMode(): RunMode {
  if (typeof window === "undefined") return "local";
  const m = localStorage.getItem(LS_MODE);
  return m === "cloud" ? "cloud" : "local";
}

function writeMode(m: RunMode) {
  try {
    localStorage.setItem(LS_MODE, m);
  } catch {
    /* ignore */
  }
}

const pillBtn =
  "inline-flex max-w-[10.5rem] items-center gap-1.5 rounded-full border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] px-2.5 py-1 text-left text-[11px] font-semibold text-[color:var(--foreground)] shadow-sm transition hover:bg-[var(--nav-active-fill)] focus-visible:outline focus-visible:ring-2 focus-visible:ring-[color:rgba(255,149,0,0.35)] sm:max-w-[13rem]";

const menuSurface =
  "popover-surface absolute left-0 top-full z-50 mt-1 w-[min(18rem,calc(100vw-2.5rem))] overflow-hidden rounded-xl border border-[color:var(--separator-subtle)] py-1 shadow-lg";

type ChatWorkspaceContextStripProps = {
  className?: string;
};

export function ChatWorkspaceContextStrip({
  className = "",
}: ChatWorkspaceContextStripProps) {
  const { t } = useTranslation();
  const menuId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [summary, setSummary] = useState<GitSummary | null>(null);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [selectedId, setSelectedId] = useState<string>("default");
  const [runMode, setRunMode] = useState<RunMode>("local");
  const [open, setOpen] = useState<"project" | "mode" | "branch" | null>(null);
  const [projectQ, setProjectQ] = useState("");
  const [branchQ, setBranchQ] = useState("");
  const [branches, setBranches] = useState<string[]>([]);
  const [branchLoading, setBranchLoading] = useState(false);
  const [checkoutBusy, setCheckoutBusy] = useState(false);

  const selectedRoot = useMemo(() => {
    if (selectedId === NONE_ID) return "";
    const p = projects.find((row) => row.id === selectedId);
    return p?.path?.trim() || "";
  }, [projects, selectedId]);

  const workspaceQuery = useCallback(
    (base: string) => {
      if (!selectedRoot) return base;
      const sep = base.includes("?") ? "&" : "?";
      return `${base}${sep}root=${encodeURIComponent(selectedRoot)}`;
    },
    [selectedRoot],
  );

  const refreshSummary = useCallback(async () => {
    try {
      const r = await fetch(workspaceQuery("/api/workspace/git/summary"));
      const data = (await r.json()) as GitSummary;
      setSummary(data);
      return data;
    } catch {
      setSummary({
        gitAvailable: false,
        projectLabel: "",
        branch: null,
        dirtyCount: 0,
        error: "fetch_failed",
      });
      return null;
    }
  }, [workspaceQuery]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const boot = async () => {
      let list = readWorkspaceProjects("workspace");
      const electron = getElectronWorkspaceApi();
      if (electron?.getWorkspaceProjects) {
        try {
          const res = await electron.getWorkspaceProjects();
          if (res?.projects?.length) {
            list = res.projects;
            writeWorkspaceProjects(list);
          }
        } catch {
          /* ignore */
        }
      }
      const sel = readSelected();
      let nextId = list[0]?.id || "default";
      if (sel === NONE_ID) nextId = NONE_ID;
      else if (list.some((p) => p.id === sel)) nextId = sel;
      const picked = list.find((p) => p.id === nextId);
      const root = picked?.path?.trim() || "";
      setProjects(list);
      setSelectedId(nextId);
      setRunMode(readMode());
      try {
        const url = root
          ? `/api/workspace/git/summary?root=${encodeURIComponent(root)}`
          : "/api/workspace/git/summary";
        const r = await fetch(url);
        const data = (await r.json()) as GitSummary;
        setSummary(data);
      } catch {
        setSummary({
          gitAvailable: false,
          projectLabel: picked?.label || "",
          branch: null,
          dirtyCount: 0,
          error: "fetch_failed",
        });
      }
      broadcastWorkspaceSelectionChanged();
    };
    void boot();
  }, []);

  useEffect(() => {
    if (selectedId === NONE_ID && open === "branch") setOpen(null);
  }, [selectedId, open]);

  useEffect(() => {
    void refreshSummary();
  }, [selectedRoot, refreshSummary]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const loadBranches = useCallback(async (q: string) => {
    setBranchLoading(true);
    try {
      const base = q
        ? `/api/workspace/git/branches?q=${encodeURIComponent(q)}`
        : "/api/workspace/git/branches";
      const r = await fetch(workspaceQuery(base));
      const data = (await r.json()) as { branches?: string[] };
      setBranches(data.branches || []);
    } catch {
      setBranches([]);
    } finally {
      setBranchLoading(false);
    }
  }, [workspaceQuery]);

  useEffect(() => {
    if (open !== "branch") return;
    const timer = setTimeout(
      () => void loadBranches(branchQ),
      branchQ ? 200 : 0,
    );
    return () => clearTimeout(timer);
  }, [open, branchQ, loadBranches]);

  const selectedProject = useMemo(() => {
    if (selectedId === NONE_ID)
      return { id: NONE_ID, label: t("chat.workspace.noProject") };
    return projects.find((p) => p.id === selectedId) || projects[0];
  }, [projects, selectedId, t]);

  const filteredProjects = useMemo(() => {
    const q = projectQ.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => p.label.toLowerCase().includes(q));
  }, [projects, projectQ]);

  const onPickProject = (id: string) => {
    setSelectedId(id);
    writeSelected(id);
    broadcastWorkspaceSelectionChanged();
    setOpen(null);
    setProjectQ("");
  };

  const persistProjects = async (next: ProjectRow[]) => {
    writeWorkspaceProjects(next);
    const electron = getElectronWorkspaceApi();
    if (electron?.saveWorkspaceProjects) {
      try {
        await electron.saveWorkspaceProjects(next);
      } catch {
        /* ignore */
      }
    }
  };

  const onAddProject = async () => {
    let label = "";
    let folderPath = "";

    const electron = getElectronWorkspaceApi();
    if (electron?.pickWorkspaceFolder) {
      try {
        const picked = await electron.pickWorkspaceFolder();
        if (picked?.canceled) return;
        if (picked?.ok && picked.path) {
          folderPath = picked.path.trim();
          label = picked.label?.trim() || folderPath.split(/[/\\]/).pop() || "";
        }
      } catch {
        /* fallback below */
      }
    }

    if (!label) {
      const showDirectoryPicker = (
        globalThis as typeof globalThis & {
          showDirectoryPicker?: (options?: {
            id?: string;
            mode?: "read" | "readwrite";
          }) => Promise<FileSystemDirectoryHandle>;
        }
      ).showDirectoryPicker;

      if (typeof showDirectoryPicker === "function") {
        try {
          const handle = await showDirectoryPicker({ mode: "read" });
          label = handle.name?.trim() || "";
        } catch (e) {
          if (e instanceof DOMException && e.name === "AbortError") return;
        }
      }
    }

    if (!label) {
      label =
        window
          .prompt(
            electron
              ? t("chat.workspace.addProjectPromptFallback")
              : t("chat.workspace.addProjectPrompt"),
          )
          ?.trim() || "";
    }

    if (!label) return;

    if (projects.some((p) => p.label.toLowerCase() === label.toLowerCase())) {
      window.alert(t("chat.workspace.duplicateProjectName"));
      return;
    }

    const id = globalThis.crypto?.randomUUID?.() || `p-${Date.now()}`;
    const row: ProjectRow = folderPath
      ? { id, label, path: folderPath }
      : { id, label };
    const next = [...projects, row];
    setProjects(next);
    await persistProjects(next);
    onPickProject(id);
  };

  const onPickMode = (m: RunMode) => {
    if (m === "cloud") return;
    setRunMode(m);
    writeMode(m);
    setOpen(null);
  };

  const onCheckout = async (branch: string, create?: boolean) => {
    setCheckoutBusy(true);
    try {
      const r = await fetch("/api/workspace/git/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branch,
          create: !!create,
          root: selectedRoot || undefined,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        window.alert(
          `${t("chat.workspace.checkoutError")}: ${(data as { error?: string }).error || r.status}`,
        );
        return;
      }
      setOpen(null);
      setBranchQ("");
      await refreshSummary();
      await loadBranches("");
    } finally {
      setCheckoutBusy(false);
    }
  };

  const onCreateBranch = () => {
    const name = window.prompt(t("chat.workspace.createBranchPrompt"));
    if (!name?.trim()) return;
    void onCheckout(name.trim(), true);
  };

  const projectActive = selectedId !== NONE_ID;
  const branchName = projectActive
    ? summary?.branch || "—"
    : t("chat.workspace.branchPlaceholderNoProject");
  const gitOk =
    projectActive && !!summary?.gitAvailable && !!summary.branch;

  return (
    <div
      ref={wrapRef}
      className={`flex flex-wrap items-center gap-2 border-t border-[color:var(--separator-subtle)] px-3 py-2 sm:px-4 ${className}`}
    >
      <div className="relative">
        <button
          type="button"
          className={pillBtn}
          aria-expanded={open === "project"}
          aria-haspopup="listbox"
          aria-controls={`${menuId}-project`}
          onClick={() =>
            setOpen((v) => (v === "project" ? null : "project"))
          }
        >
          <FolderGit2
            className="h-3.5 w-3.5 shrink-0 text-[color:var(--accent)]"
            strokeWidth={2}
            aria-hidden
          />
          <span className="min-w-0 flex-1 truncate">
            {selectedProject?.label || "—"}
          </span>
          {open === "project" ? (
            <ChevronUp className="h-3.5 w-3.5 shrink-0 opacity-70" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" />
          )}
        </button>
        {open === "project" ? (
          <div
            id={`${menuId}-project`}
            className={menuSurface}
            role="listbox"
          >
            <div className="border-b border-[color:var(--separator-subtle)] px-2 py-1.5">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[color:var(--label-secondary)]" />
                <input
                  value={projectQ}
                  onChange={(e) => setProjectQ(e.target.value)}
                  placeholder={t("chat.workspace.searchProject")}
                  className="w-full rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] py-1.5 pl-8 pr-2 text-xs text-[color:var(--foreground)] placeholder:text-[color:var(--label-secondary)]"
                />
              </div>
            </div>
            <div className="max-h-52 overflow-y-auto py-1">
              <button
                type="button"
                role="option"
                onClick={() => onPickProject(NONE_ID)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[color:var(--foreground)] hover:bg-[var(--nav-active-fill)]"
              >
                <FolderX
                  className="h-4 w-4 shrink-0 text-[color:var(--label-secondary)]"
                  strokeWidth={2}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate">
                  {t("chat.workspace.noProject")}
                </span>
                {selectedId === NONE_ID ? (
                  <Check
                    className="h-4 w-4 shrink-0 text-[color:var(--accent)]"
                    strokeWidth={2}
                  />
                ) : null}
              </button>
              {filteredProjects.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="option"
                  onClick={() => onPickProject(p.id)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[color:var(--foreground)] hover:bg-[var(--nav-active-fill)]"
                >
                  <FolderGit2
                    className="h-4 w-4 shrink-0 text-[color:var(--accent)]"
                    strokeWidth={2}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate">{p.label}</span>
                  {selectedId === p.id ? (
                    <Check
                      className="h-4 w-4 shrink-0 text-[color:var(--accent)]"
                      strokeWidth={2}
                    />
                  ) : null}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => void onAddProject()}
              className="flex w-full items-center gap-2 border-t border-[color:var(--separator-subtle)] px-3 py-2.5 text-left text-xs font-semibold text-[color:var(--accent)] hover:bg-[var(--nav-active-fill)]"
            >
              <Plus className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
              {t("chat.workspace.addProject")}
            </button>
          </div>
        ) : null}
      </div>

      <div className="relative">
        <button
          type="button"
          className={pillBtn}
          aria-expanded={open === "mode"}
          aria-controls={`${menuId}-mode`}
          onClick={() => setOpen((v) => (v === "mode" ? null : "mode"))}
        >
          <Laptop
            className="h-3.5 w-3.5 shrink-0 text-[color:var(--label-secondary)]"
            strokeWidth={2}
            aria-hidden
          />
          <span className="min-w-0 flex-1 truncate">
            {runMode === "local"
              ? t("chat.workspace.modeLocal")
              : t("chat.workspace.modeCloud")}
          </span>
          {open === "mode" ? (
            <ChevronUp className="h-3.5 w-3.5 shrink-0 opacity-70" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" />
          )}
        </button>
        {open === "mode" ? (
          <div id={`${menuId}-mode`} className={menuSurface}>
            <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--label-secondary)]">
              {t("chat.workspace.modeSection")}
            </div>
            <button
              type="button"
              onClick={() => onPickMode("local")}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[color:var(--foreground)] hover:bg-[var(--nav-active-fill)]"
            >
              <Laptop className="h-4 w-4 shrink-0" strokeWidth={2} />
              <span className="flex-1">{t("chat.workspace.modeLocal")}</span>
              {runMode === "local" ? (
                <Check
                  className="h-4 w-4 text-[color:var(--accent)]"
                  strokeWidth={2}
                />
              ) : null}
            </button>
            <button
              type="button"
              disabled
              title={t("chat.workspace.modeCloudSoon")}
              className="flex w-full cursor-not-allowed items-center gap-2 px-3 py-2 text-left text-xs text-[color:var(--label-secondary)] opacity-50"
            >
              <span className="flex-1">{t("chat.workspace.modeCloud")}</span>
              <span className="text-[10px]">{t("chat.workspace.soon")}</span>
            </button>
          </div>
        ) : null}
      </div>

      <div className="relative">
        <button
          type="button"
          className={`${pillBtn} ${!gitOk ? "pointer-events-none opacity-45" : ""}`}
          title={
            projectActive
              ? t("chat.workspace.switchBranch")
              : t("chat.workspace.selectProjectForBranch")
          }
          disabled={!gitOk}
          aria-expanded={open === "branch"}
          aria-controls={`${menuId}-branch`}
          onClick={() => {
            if (!gitOk) return;
            setOpen((v) => (v === "branch" ? null : "branch"));
          }}
        >
          <GitBranch
            className={`h-3.5 w-3.5 shrink-0 ${projectActive ? "text-[color:var(--accent)]" : "text-[color:var(--label-secondary)]"}`}
            strokeWidth={2}
            aria-hidden
          />
          <span
            className={`min-w-0 flex-1 truncate text-[10px] ${projectActive ? "font-mono" : "font-sans text-[color:var(--label-secondary)]"}`}
          >
            {branchName}
          </span>
          {open === "branch" ? (
            <ChevronUp className="h-3.5 w-3.5 shrink-0 opacity-70" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" />
          )}
        </button>
        {open === "branch" && gitOk ? (
          <div id={`${menuId}-branch`} className={menuSurface}>
            <div className="border-b border-[color:var(--separator-subtle)] px-2 py-1.5">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[color:var(--label-secondary)]" />
                <input
                  value={branchQ}
                  onChange={(e) => setBranchQ(e.target.value)}
                  placeholder={t("chat.workspace.searchBranch")}
                  className="w-full rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] py-1.5 pl-8 pr-2 text-xs text-[color:var(--foreground)] placeholder:text-[color:var(--label-secondary)]"
                />
              </div>
            </div>
            {summary && summary.dirtyCount > 0 ? (
              <div className="border-b border-[color:var(--separator-subtle)] px-3 py-1.5 text-[10px] text-[color:var(--label-secondary)]">
                {t("chat.workspace.dirtyStatus", {
                  count: String(summary.dirtyCount),
                })}
              </div>
            ) : null}
            <div className="max-h-52 overflow-y-auto py-1">
              {branchLoading ? (
                <div className="px-3 py-4 text-center text-xs text-[color:var(--label-secondary)]">
                  …
                </div>
              ) : (
                branches.map((b) => (
                  <button
                    key={b}
                    type="button"
                    onClick={() => void onCheckout(b, false)}
                    disabled={checkoutBusy}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[color:var(--foreground)] hover:bg-[var(--nav-active-fill)] disabled:opacity-50"
                  >
                    <GitBranch
                      className="h-4 w-4 shrink-0 text-[color:var(--label-secondary)]"
                      strokeWidth={2}
                    />
                    <span className="min-w-0 flex-1 truncate font-mono">{b}</span>
                    {b === summary?.branch ? (
                      <Check
                        className="h-4 w-4 shrink-0 text-[color:var(--accent)]"
                        strokeWidth={2}
                      />
                    ) : null}
                  </button>
                ))
              )}
            </div>
            <button
              type="button"
              disabled={checkoutBusy}
              onClick={onCreateBranch}
              className="flex w-full items-center gap-2 border-t border-[color:var(--separator-subtle)] px-3 py-2.5 text-left text-xs font-semibold text-[color:var(--accent)] hover:bg-[var(--nav-active-fill)] disabled:opacity-50"
            >
              <Plus className="h-4 w-4 shrink-0" strokeWidth={2} />
              {t("chat.workspace.createBranch")}
            </button>
          </div>
        ) : null}
      </div>

      {projectActive && !summary?.gitAvailable && summary ? (
        <span className="text-[10px] text-[color:var(--label-secondary)]">
          {t("chat.workspace.gitUnavailable")}
        </span>
      ) : null}
    </div>
  );
}
