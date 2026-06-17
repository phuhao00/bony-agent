"use client";

import {
  getElectronWorkspaceApi,
  isElectronWorkspaceAvailable,
} from "@/lib/electron-workspace";
import type { WorkspaceProjectRow } from "@/lib/electron-workspace";
import {
  readWorkspaceProjects,
  writeWorkspaceProjects,
} from "@/lib/workspace-projects";
import {
  broadcastWorkspaceSelectionChanged,
  subscribeWorkspaceSelection,
  WORKSPACE_NONE_ID,
} from "@/lib/workspace-selection-sync";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const LS_SELECTED = "chat.workspace.selectedProject.v1";
const LOCAL_REPO_ID = "local-repo";

type GitSummary = {
  gitAvailable: boolean;
  projectLabel: string;
  branch: string | null;
  dirtyCount: number;
  rootPath?: string;
  error?: string;
};

function readSelected(): string {
  if (typeof window === "undefined") return LOCAL_REPO_ID;
  try {
    return localStorage.getItem(LS_SELECTED) || LOCAL_REPO_ID;
  } catch {
    return LOCAL_REPO_ID;
  }
}

function writeSelected(id: string) {
  try {
    localStorage.setItem(LS_SELECTED, id);
  } catch {
    /* ignore */
  }
}

export function useCodingWorkspace() {
  const [projects, setProjects] = useState<WorkspaceProjectRow[]>([]);
  const [selectedId, setSelectedId] = useState(LOCAL_REPO_ID);
  const [serverRoot, setServerRoot] = useState<string | null>(null);
  const [serverLabel, setServerLabel] = useState("仓库");
  const [gitSummary, setGitSummary] = useState<GitSummary | null>(null);
  const [loadingGit, setLoadingGit] = useState(false);
  const [tick, setTick] = useState(0);
  const adoptedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    void fetch("/api/workspace/root")
      .then((r) => r.json())
      .then((d: { root?: string; label?: string }) => {
        if (d.root) {
          setServerRoot(d.root);
          setServerLabel(d.label || "仓库");
        }
      })
      .catch(() => {});
  }, []);

  const persistProjects = useCallback(async (next: WorkspaceProjectRow[]) => {
    writeWorkspaceProjects(next);
    const electron = getElectronWorkspaceApi();
    if (electron?.saveWorkspaceProjects) {
      try {
        await electron.saveWorkspaceProjects(next);
      } catch {
        /* ignore */
      }
    }
  }, []);

  const selectProject = useCallback((id: string) => {
    setSelectedId((prev) => {
      if (prev === id) return prev;
      writeSelected(id);
      broadcastWorkspaceSelectionChanged();
      return id;
    });
  }, []);

  const reloadFromStorage = useCallback(async () => {
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
    let nextId = list[0]?.id || LOCAL_REPO_ID;
    if (sel === WORKSPACE_NONE_ID) nextId = WORKSPACE_NONE_ID;
    else if (list.some((p) => p.id === sel)) nextId = sel;
    setProjects(list);
    setSelectedId(nextId);
    setTick((n) => n + 1);
  }, []);

  useEffect(() => {
    void reloadFromStorage();
    return subscribeWorkspaceSelection(() => {
      void reloadFromStorage();
    });
  }, [reloadFromStorage]);

  const adoptTreeRoot = useCallback(
    async (root: string, label: string) => {
      const trimmed = root.trim();
      if (!trimmed || adoptedRef.current.has(trimmed)) return;
      adoptedRef.current.add(trimmed);

      setProjects((prev) => {
        const hit = prev.find((p) => p.path === trimmed);
        if (hit) {
          setSelectedId((current) => {
            if (current === WORKSPACE_NONE_ID) {
              writeSelected(hit.id);
              broadcastWorkspaceSelectionChanged();
              return hit.id;
            }
            return current;
          });
          return prev;
        }
        const row: WorkspaceProjectRow = {
          id: LOCAL_REPO_ID,
          label,
          path: trimmed,
        };
        const next = [row, ...prev.filter((p) => p.id !== LOCAL_REPO_ID)];
        void persistProjects(next);
        setSelectedId((current) => {
          if (current === LOCAL_REPO_ID) return current;
          writeSelected(LOCAL_REPO_ID);
          broadcastWorkspaceSelectionChanged();
          return LOCAL_REPO_ID;
        });
        return next;
      });
    },
    [persistProjects],
  );

  useEffect(() => {
    if (serverRoot) {
      void adoptTreeRoot(serverRoot, serverLabel);
    }
  }, [serverRoot, serverLabel, adoptTreeRoot]);

  const selectedProject = useMemo(() => {
    if (selectedId === WORKSPACE_NONE_ID) return null;
    return projects.find((p) => p.id === selectedId) || projects[0] || null;
  }, [projects, selectedId]);

  const workspaceRoot = useMemo(() => {
    const p = selectedProject?.path?.trim();
    return p || null;
  }, [selectedProject]);

  const effectiveRoot = workspaceRoot || serverRoot;

  const refreshGit = useCallback(async () => {
    const root = effectiveRoot;
    if (!root) {
      setGitSummary(null);
      return;
    }
    setLoadingGit(true);
    try {
      const q = new URLSearchParams({ root });
      const r = await fetch(`/api/workspace/git/summary?${q.toString()}`);
      const data = (await r.json()) as GitSummary;
      setGitSummary(data);
    } catch {
      setGitSummary({
        gitAvailable: false,
        projectLabel: selectedProject?.label || serverLabel,
        branch: null,
        dirtyCount: 0,
        error: "fetch_failed",
      });
    } finally {
      setLoadingGit(false);
    }
  }, [effectiveRoot, selectedProject?.label, serverLabel]);

  useEffect(() => {
    void refreshGit();
  }, [refreshGit, tick]);

  const pickFolderAsWorkspace = useCallback(async () => {
    const electron = getElectronWorkspaceApi();
    if (!electron?.pickWorkspaceFolder) return null;
    const res = await electron.pickWorkspaceFolder();
    if (!res?.ok || res.canceled || !res.path) return null;
    const id = `proj-${Date.now()}`;
    const row: WorkspaceProjectRow = {
      id,
      label: res.label || res.path.split(/[/\\]/).pop() || "workspace",
      path: res.path,
    };
    const next = [...projects.filter((p) => p.path !== res.path), row];
    setProjects(next);
    await persistProjects(next);
    selectProject(id);
    return row;
  }, [persistProjects, projects, selectProject]);

  const removeProject = useCallback(
    async (projectId: string) => {
      if (projectId === LOCAL_REPO_ID) return;
      const next = projects.filter((p) => p.id !== projectId);
      setProjects(next);
      await persistProjects(next);
      if (selectedId === projectId) {
        selectProject(next[0]?.id || LOCAL_REPO_ID);
      } else {
        broadcastWorkspaceSelectionChanged();
      }
    },
    [persistProjects, projects, selectProject, selectedId],
  );

  return {
    projects,
    selectedId,
    selectedProject,
    workspaceRoot,
    serverRoot,
    serverLabel,
    effectiveRoot,
    gitSummary,
    loadingGit,
    isElectron: isElectronWorkspaceAvailable(),
    selectProject,
    pickFolderAsWorkspace,
    adoptTreeRoot,
    removeProject,
    refreshGit,
    reloadFromStorage,
  };
}
