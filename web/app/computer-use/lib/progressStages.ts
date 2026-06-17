import type { ComputerUseProgressMeta } from "./types";

const ACTION_LABELS: Record<string, string> = {
  goto: "打开页面",
  wait: "等待",
  click: "点击",
  fill: "输入文字",
  type: "输入文字",
  scroll: "滚动",
  press: "按键",
  screenshot: "截图",
  done: "完成",
  fail: "失败",
  limit: "达到步数上限",
  cancelled: "已取消",
  click_submit_fallback: "点击搜索（兜底）",
};

/** 将步骤 action 代码转为可读中文标签（时间线展示用）。 */
export function actionLabel(action: string): string {
  return ACTION_LABELS[action] || action;
}

export type ProgressStage = {
  id: string;
  label: string;
  status: "pending" | "running" | "done";
};

/** 从任务 metadata.computer_use 构建真实进度（替代按秒数猜测）。 */
export function buildProgressFromMetadata(
  cu: ComputerUseProgressMeta | undefined,
  taskStatus?: string,
): ProgressStage[] {
  const stages = cu?.stages || [];
  const current = cu?.current_step ?? 0;
  const max = cu?.max_steps ?? 15;
  const lastPlan = cu?.last_plan || "";

  if (stages.length === 0 && taskStatus === "pending") {
    return [
      { id: "submit", label: "任务已提交", status: "running" },
      { id: "launch", label: "启动浏览器", status: "pending" },
    ];
  }

  const out: ProgressStage[] = [
    { id: "submit", label: "任务已提交", status: "done" },
    { id: "launch", label: "启动 Chromium", status: current > 0 ? "done" : "running" },
  ];

  const recent = stages.slice(-6);
  for (const s of recent) {
    const label = s.plan
      ? `第 ${s.step ?? "?"} 步 · ${s.plan}`
      : `第 ${s.step ?? "?"} 步 · ${s.stage || "执行"}`;
    out.push({
      id: `step-${s.step}-${s.at}`,
      label,
      status: s.step === current ? "running" : "done",
    });
  }

  if (lastPlan && !recent.some((s) => s.plan === lastPlan)) {
    out.push({
      id: "current",
      label: `第 ${current} 步 · ${lastPlan}`,
      status: "running",
    });
  }

  if (taskStatus === "completed") {
    out.push({ id: "done", label: "任务完成", status: "done" });
  } else if (taskStatus === "waiting_approval") {
    out.push({ id: "approval", label: "等待审批", status: "running" });
  } else if (current >= max) {
    out.push({ id: "limit", label: `已达最大步数 (${max})`, status: "running" });
  }

  return out;
}
