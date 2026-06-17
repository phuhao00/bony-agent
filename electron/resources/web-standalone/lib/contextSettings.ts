import type { MemoryLayout } from "./contextNavigation";

export interface ContextSettings {
  defaultMemoryLayout: MemoryLayout;
  graphAutoRefreshSec: number;
}

const KEY = "context.settings.v1";

const DEFAULTS: ContextSettings = {
  defaultMemoryLayout: "list",
  graphAutoRefreshSec: 0,
};

export function loadContextSettings(): ContextSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveContextSettings(next: Partial<ContextSettings>): ContextSettings {
  const merged = { ...loadContextSettings(), ...next };
  try {
    localStorage.setItem(KEY, JSON.stringify(merged));
  } catch {
    /* ignore */
  }
  return merged;
}
