"use client";

export const WORKSPACE_SELECTED_LS_KEY = "chat.workspace.selectedProject.v1";

export const WORKSPACE_NONE_ID = "__none__";

export const WORKSPACE_SELECTION_EVENT =
  "agent:workspace-selection-changed" as const;

export function readWorkspaceSelectedId(): string {
  if (typeof window === "undefined") return WORKSPACE_NONE_ID;
  try {
    return (
      window.localStorage.getItem(WORKSPACE_SELECTED_LS_KEY) || "default"
    );
  } catch {
    return "default";
  }
}

/** 供输入条选择项目后与顶栏等资源同步同一 tab（storage 事件仅跨标签页）。 */
export function broadcastWorkspaceSelectionChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(WORKSPACE_SELECTION_EVENT));
}

function subscribe(listener: () => void): () => void {
  window.addEventListener(WORKSPACE_SELECTION_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(WORKSPACE_SELECTION_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

export function subscribeWorkspaceSelection(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  return subscribe(listener);
}
