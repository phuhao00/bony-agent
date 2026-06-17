import type { DesktopTask } from "../hooks/useDesktopOperatorRunner";

function taskMetadata(task: DesktopTask | null | undefined) {
  return (task?.metadata || {}) as Record<string, unknown>;
}

export function isTaskApprovedPendingResume(task: DesktopTask | null | undefined): boolean {
  const md = taskMetadata(task);
  const last = md.last_approval_id;
  const approved = md.approved_approval_id;
  if (!last || !approved || last !== approved) return false;
  const status = task?.status;
  return status === "pending" || status === "running";
}

export function isTaskAwaitingApproval(
  task: DesktopTask | null | undefined,
  actionResult?: unknown,
): boolean {
  if (isTaskApprovedPendingResume(task)) return false;

  const terminal = new Set(["completed", "failed", "cancelled", "expired"]);
  if (task?.status && terminal.has(task.status)) return false;

  const payload = (actionResult ?? null) as Record<string, unknown> | null;
  if (task?.status === "waiting_approval") return true;
  if (payload?.status === "waiting_approval" || payload?.requires_approval === true) {
    return true;
  }
  const md = taskMetadata(task);
  if (md.last_approval_id && !md.approved_approval_id) return true;
  if (payload?.approval && typeof payload.approval === "object") return true;
  const message = String(task?.message || payload?.message || "");
  return message.includes("等待审批");
}

export function shouldPollTaskStatus(status?: string): boolean {
  return status === "running";
}

export function normalizeApprovalTask(
  task: DesktopTask,
  actionResult?: unknown,
): DesktopTask {
  const payload = (actionResult ?? null) as Record<string, unknown> | null;
  const approval = payload?.approval as { id?: string } | undefined;
  const metadata = { ...(task.metadata || {}) };
  if (approval?.id && !metadata.last_approval_id) {
    metadata.last_approval_id = approval.id;
  }
  const normalized: DesktopTask = {
    ...task,
    metadata,
    result: task.result ?? payload ?? undefined,
  };
  if (isTaskApprovedPendingResume(normalized)) return normalized;
  if (normalized.status === "waiting_approval") return normalized;
  if (!isTaskAwaitingApproval(normalized, actionResult)) return normalized;
  return { ...normalized, status: "waiting_approval" };
}
