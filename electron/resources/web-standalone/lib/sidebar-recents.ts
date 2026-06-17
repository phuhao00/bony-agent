/** localStorage helpers + workflow-aware reconcile for sidebar 「最近」 */

export const RECENT_STORAGE_KEY = "sidebar.recents.v3";

export type RecentEntry = {
  href: string;
  titleKey?: string;
  /** Legacy v2 entries */
  title?: string;
  /** Present when href targets /workflows/:id (excluding /new) */
  workflowId?: string;
};

export function readRecents(): RecentEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(RECENT_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as RecentEntry[]) : [];
  } catch {
    return [];
  }
}

export function writeRecents(entries: RecentEntry[]): void {
  try {
    localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    /* ignore quota */
  }
}

export const SIDEBAR_RECENTS_CHANGED = "sidebar-recents-changed";

export function notifySidebarRecentsChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(SIDEBAR_RECENTS_CHANGED));
}

/** Returns backend workflow id for paths like /workflows/<uuid>, excluding `new`. */
export function extractWorkflowIdFromPath(pathname: string): string | null {
  if (!pathname.startsWith("/workflows/")) return null;
  const segment = pathname.slice("/workflows/".length).split("/")[0];
  if (!segment || segment === "new") return null;
  return segment;
}

export function reconcileWorkflowRecentsWithApi(
  entries: RecentEntry[],
  workflows: { id: string; name: string }[],
): RecentEntry[] {
  const idSet = new Set(workflows.map((w) => w.id));
  const nameById: Record<string, string> = {};
  for (const w of workflows) {
    if (w?.id && typeof w.name === "string" && w.name.trim()) {
      nameById[w.id] = w.name.trim();
    }
  }

  const out: RecentEntry[] = [];
  for (const entry of entries) {
    const wfId = entry.workflowId ?? extractWorkflowIdFromPath(entry.href);
    if (!wfId) {
      out.push(entry);
      continue;
    }
    if (!idSet.has(wfId)) continue;
    const name = nameById[wfId];
    out.push({
      ...entry,
      workflowId: wfId,
      ...(name ? { title: name } : {}),
      titleKey: undefined,
    });
  }
  return out;
}

export function removeWorkflowFromRecents(workflowId: string): void {
  const stored = readRecents();
  const next = stored.filter((r) => {
    const id = r.workflowId ?? extractWorkflowIdFromPath(r.href);
    return id !== workflowId;
  });
  writeRecents(next);
  notifySidebarRecentsChanged();
}

/** Updates stored titles for any recent row pointing at this workflow. */
export function applyWorkflowDisplayTitle(workflowId: string, title: string): void {
  const trimmed = title.trim();
  if (!trimmed) return;
  const stored = readRecents();
  const next = stored.map((r) => {
    const id = r.workflowId ?? extractWorkflowIdFromPath(r.href);
    if (id !== workflowId) return r;
    return {
      ...r,
      workflowId,
      title: trimmed,
      titleKey: undefined,
    };
  });
  writeRecents(next);
  notifySidebarRecentsChanged();
}
