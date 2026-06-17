"use client";

type SystemRunPayload = {
  argv: string[];
  cwd?: string;
  timeoutMs?: number;
};

type SystemRunResult = {
  ok?: boolean;
  returncode?: number | null;
  stdout?: string;
  stderr?: string;
  error?: string;
  argv?: string[];
};

type ElectronSystemApi = {
  getPlatformInfo?: () => Promise<{ platform?: string; arch?: string; isElectron?: boolean }>;
  runSystemCommand?: (payload: SystemRunPayload) => Promise<SystemRunResult>;
};

export function getElectronSystemApi(): ElectronSystemApi | null {
  if (typeof window === "undefined") return null;
  const api = (window as Window & { api?: ElectronSystemApi }).api;
  if (!api?.runSystemCommand) return null;
  return api;
}

export function isElectronSystemAvailable(): boolean {
  return getElectronSystemApi() !== null;
}

export async function runElectronSystemCommand(
  payload: SystemRunPayload,
): Promise<SystemRunResult> {
  const api = getElectronSystemApi();
  if (!api?.runSystemCommand) {
    return { ok: false, error: "Electron system bridge unavailable" };
  }
  return api.runSystemCommand(payload);
}

export async function getElectronPlatformInfo(): Promise<{
  platform: string;
  isElectron: boolean;
}> {
  const api = getElectronSystemApi();
  if (!api?.getPlatformInfo) {
    return { platform: "web", isElectron: false };
  }
  const info = await api.getPlatformInfo();
  return {
    platform: info?.platform || "unknown",
    isElectron: Boolean(info?.isElectron),
  };
}
