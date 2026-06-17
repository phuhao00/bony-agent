"use client";

import type { WorkspaceProjectRow } from "@/lib/electron-workspace";
import { readWorkspaceSelectedId } from "@/lib/workspace-selection-sync";

export const LS_PROJECTS_V1 = "chat.workspace.projects.v1";
export const LS_PROJECTS_V2 = "chat.workspace.projects.v2";

export function readWorkspaceProjects(fallbackLabel = "workspace"): WorkspaceProjectRow[] {
  if (typeof window === "undefined") {
    return [{ id: "default", label: fallbackLabel }];
  }
  try {
    const rawV2 = localStorage.getItem(LS_PROJECTS_V2);
    if (rawV2) {
      const arr = JSON.parse(rawV2) as WorkspaceProjectRow[];
      if (Array.isArray(arr) && arr.length > 0) return arr;
    }
    const rawV1 = localStorage.getItem(LS_PROJECTS_V1);
    if (rawV1) {
      const arr = JSON.parse(rawV1) as { id: string; label: string }[];
      if (Array.isArray(arr) && arr.length > 0) {
        return arr.map((p) => ({ id: p.id, label: p.label }));
      }
    }
  } catch {
    /* ignore */
  }
  return [{ id: "default", label: fallbackLabel }];
}

export function writeWorkspaceProjects(rows: WorkspaceProjectRow[]) {
  try {
    localStorage.setItem(LS_PROJECTS_V2, JSON.stringify(rows));
    localStorage.setItem(
      LS_PROJECTS_V1,
      JSON.stringify(rows.map(({ id, label }) => ({ id, label }))),
    );
  } catch {
    /* ignore */
  }
}

export function readSelectedWorkspaceProject(
  fallbackLabel = "workspace",
): WorkspaceProjectRow | null {
  const selectedId = readWorkspaceSelectedId();
  if (selectedId === "__none__") return null;
  const projects = readWorkspaceProjects(fallbackLabel);
  return projects.find((p) => p.id === selectedId) || projects[0] || null;
}

export function readSelectedWorkspaceRoot(fallbackLabel = "workspace"): string | null {
  const project = readSelectedWorkspaceProject(fallbackLabel);
  const path = project?.path?.trim();
  return path || null;
}
