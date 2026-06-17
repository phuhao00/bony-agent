"use client";

import { useCallback, useEffect, useState } from "react";
import type { CanvasNode, ChatMessage } from "@/hooks/useCanvas";
import {
  addTextAsset as localAddTextAsset,
  createProject as localCreateProject,
  deleteProject as localDeleteProject,
  getProject as localGetProject,
  listProjects as localListProjects,
  renameProject as localRenameProject,
  saveProject as localSaveProject,
  uploadAsset as localUploadAsset,
  type Project,
  type ProjectAsset,
  type ProjectType,
} from "@/lib/project-store";

const API_PREFIX = "/api/backend/media-assets";

function isBrowser() {
  return typeof window !== "undefined";
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_PREFIX}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export interface UseProjectAssetsReturn {
  project: Project | null;
  projects: Project[];
  loading: boolean;
  setProject: (p: Project | null) => void;
  refresh: () => Promise<void>;
  createProject: (type: ProjectType, name: string) => Promise<Project>;
  saveProject: (p: Project) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  renameProject: (id: string, name: string) => Promise<void>;
  getProject: (id: string) => Promise<Project | null>;
  uploadAsset: (file: File) => Promise<ProjectAsset>;
  addTextAsset: (name: string, content: string) => ProjectAsset;
}

export function useProjectAssets(type: ProjectType): UseProjectAssetsReturn {
  const [project, setProject] = useState<Project | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [backendReady, setBackendReady] = useState<boolean | null>(null);

  const checkBackend = useCallback(async () => {
    if (backendReady !== null) return backendReady;
    try {
      const res = await fetch(`${API_PREFIX}/projects`, { method: "GET" });
      if (!res.ok) throw new Error(`backend returned ${res.status}`);
      setBackendReady(true);
      return true;
    } catch {
      setBackendReady(false);
      return false;
    }
  }, [backendReady]);

  const refresh = useCallback(async () => {
    if (!isBrowser()) return;
    setLoading(true);
    try {
      const ready = await checkBackend();
      if (ready) {
        const data = await api<{ projects: Project[] }>(`/projects?type=${type}`);
        setProjects(data.projects);
      } else {
        setProjects(localListProjects(type));
      }
    } finally {
      setLoading(false);
    }
  }, [checkBackend, type]);

  const createProject = useCallback(
    async (t: ProjectType, name: string) => {
      const ready = await checkBackend();
      let p: Project;
      if (ready) {
        p = await api<Project>("/projects", {
          method: "POST",
          body: JSON.stringify({ name, type: t }),
        });
      } else {
        p = localCreateProject(t, name);
      }
      setProject(p);
      await refresh();
      return p;
    },
    [checkBackend, refresh]
  );

  const saveProject = useCallback(
    async (p: Project) => {
      const ready = await checkBackend();
      if (ready) {
        await api<Project>(`/projects/${p.id}`, {
          method: "PUT",
          body: JSON.stringify({
            name: p.name,
            nodes: p.nodes,
            messages: p.messages,
            brief: p.brief,
            assets: p.assets,
          }),
        });
      } else {
        localSaveProject(p);
      }
      setProject(p);
      await refresh();
    },
    [checkBackend, refresh]
  );

  const deleteProject = useCallback(
    async (id: string) => {
      const ready = await checkBackend();
      if (ready) {
        await fetch(`${API_PREFIX}/projects/${id}`, { method: "DELETE" });
      } else {
        localDeleteProject(id);
      }
      if (project?.id === id) setProject(null);
      await refresh();
    },
    [checkBackend, project, refresh]
  );

  const renameProject = useCallback(
    async (id: string, name: string) => {
      const ready = await checkBackend();
      if (ready) {
        await api<Project>(`/projects/${id}`, {
          method: "PUT",
          body: JSON.stringify({ name }),
        });
      } else {
        localRenameProject(id, name);
      }
      if (project?.id === id) setProject((prev) => (prev ? { ...prev, name } : prev));
      await refresh();
    },
    [checkBackend, project, refresh]
  );

  const getProject = useCallback(
    async (id: string) => {
      const ready = await checkBackend();
      if (ready) {
        return api<Project>(`/projects/${id}`);
      }
      return localGetProject(id);
    },
    [checkBackend]
  );

  const uploadAsset = useCallback(async (file: File) => {
    return localUploadAsset(file);
  }, []);

  const addTextAsset = useCallback((name: string, content: string) => {
    return localAddTextAsset(name, content);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    project,
    projects,
    loading,
    setProject,
    refresh,
    createProject,
    saveProject,
    deleteProject,
    renameProject,
    getProject,
    uploadAsset,
    addTextAsset,
  };
}
