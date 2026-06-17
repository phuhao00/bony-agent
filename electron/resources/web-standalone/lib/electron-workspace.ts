"use client";

export type WorkspaceProjectRow = {
  id: string;
  label: string;
  path?: string;
};

type ElectronWorkspaceApi = {
  pickWorkspaceFolder?: () => Promise<{
    ok?: boolean;
    canceled?: boolean;
    path?: string;
    label?: string;
  }>;
  pickWorkspaceFile?: () => Promise<{
    ok?: boolean;
    canceled?: boolean;
    path?: string;
    label?: string;
  }>;
  getWorkspaceProjects?: () => Promise<{
    ok?: boolean;
    projects?: WorkspaceProjectRow[];
  }>;
  saveWorkspaceProjects?: (
    rows: WorkspaceProjectRow[],
  ) => Promise<{ ok?: boolean }>;
};

export function getElectronWorkspaceApi(): ElectronWorkspaceApi | null {
  if (typeof window === "undefined") return null;
  const api = (window as Window & { api?: ElectronWorkspaceApi }).api;
  if (!api?.pickWorkspaceFolder) return null;
  return api;
}

export function isElectronWorkspaceAvailable(): boolean {
  return getElectronWorkspaceApi() !== null;
}
