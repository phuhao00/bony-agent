/** Cross-tab navigation within My Context settings. */

export type ContextTab = "graph" | "memory" | "memgraph" | "dreams" | "codegraph" | "sessions";
export type MemoryLayout = "list" | "browser";

export interface ContextNavTarget {
  tab: ContextTab;
  memoryId?: string;
  memoryLayout?: MemoryLayout;
  memGraphMode?: string;
}

const STORAGE_KEY = "context.nav.v1";
export const CONTEXT_NAV_EVENT = "context:navigate";

export function persistContextNav(target: ContextNavTarget): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(target));
  } catch {
    /* ignore */
  }
}

export function readContextNav(): ContextNavTarget | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ContextNavTarget;
  } catch {
    return null;
  }
}

export function navigateContext(target: ContextNavTarget): void {
  persistContextNav(target);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(CONTEXT_NAV_EVENT, { detail: target }));
  }
}

export function navigateToMemory(memoryId: string, layout: MemoryLayout = "browser"): void {
  navigateContext({ tab: "memory", memoryId, memoryLayout: layout });
}

export function navigateToMemGraph(memoryId?: string, mode = "memories"): void {
  navigateContext({ tab: "memgraph", memoryId, memGraphMode: mode });
}
