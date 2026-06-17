import type { GitProgressFn } from "../hooks/useGitActions";
import type { ClaudeCodeRunState } from "./types";
import type { CodingScope } from "./scope";
import { formatSlashHelp, type SlashCommandDef } from "./slash-commands";

export type LocalSlashContext = {
  commandText: string;
  commandName: string;
  args: string;
  slashCommands: SlashCommandDef[];
  state: ClaudeCodeRunState;
  health: {
    ready?: boolean;
    sdk_available?: boolean;
    not_ready_reason?: string;
    coding?: { provider_name?: string; model?: string };
    claude_bin?: string;
    version?: string;
  } | null;
  scope: CodingScope;
  workspaceRoot: string | null;
  gitSummary: {
    branch?: string | null;
    dirtyCount?: number;
    gitAvailable?: boolean;
    error?: string;
  } | null;
  reloadSlashCommands: () => void;
  refreshGit: () => void | Promise<void>;
  onProgress?: GitProgressFn;
  gitCommit: (
    message: string,
    opts?: { asHint?: boolean; onProgress?: GitProgressFn },
  ) => Promise<{ ok: boolean; message: string }>;
  gitPush: (
    remote?: string,
    onProgress?: GitProgressFn,
  ) => Promise<{ ok: boolean; message: string }>;
  gitCommitAndPush: (
    message: string,
    opts?: { asHint?: boolean; onProgress?: GitProgressFn },
  ) => Promise<{ ok: boolean; message: string }>;
  openConfig: () => void;
  resetConversation: () => void;
  cancelRun: () => void;
};

function lastAssistantContent(state: ClaudeCodeRunState): string {
  for (let i = state.messages.length - 1; i >= 0; i -= 1) {
    const m = state.messages[i];
    if (m?.role === "assistant" && m.content.trim()) return m.content;
  }
  return state.finalResponse.trim();
}

function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function formatTranscript(state: ClaudeCodeRunState): string {
  const lines: string[] = [];
  for (const m of state.messages) {
    const role = m.role === "user" ? "User" : "Assistant";
    lines.push(`## ${role}`, "", m.content, "");
  }
  return lines.join("\n").trim();
}

function formatHealth(ctx: LocalSlashContext, detailed: boolean): string {
  const h = ctx.health;
  if (!h) return "无法获取健康状态，请稍后重试。";
  const lines = [
    detailed ? "## Claude Code 诊断" : "## 状态",
    "",
    `- **就绪**: ${h.ready ? "是" : "否"}`,
    `- **SDK**: ${h.sdk_available === false ? "未安装" : "可用"}`,
  ];
  if (h.not_ready_reason) lines.push(`- **原因**: ${h.not_ready_reason}`);
  if (h.coding?.provider_name) lines.push(`- **供应商**: ${h.coding.provider_name}`);
  if (h.coding?.model) lines.push(`- **模型**: ${h.coding.model}`);
  if (detailed && h.claude_bin) lines.push(`- **CLI**: \`${h.claude_bin}\``);
  if (detailed && h.version) lines.push(`- **SDK 版本**: ${h.version}`);
  return lines.join("\n");
}

function formatContext(ctx: LocalSlashContext): string {
  const { state, scope, workspaceRoot } = ctx;
  const userCount = state.messages.filter((m) => m.role === "user").length;
  const assistantCount = state.messages.filter((m) => m.role === "assistant").length;
  return [
    "## 会话上下文",
    "",
    `- **工作区**: ${workspaceRoot || "未绑定"}`,
    `- **范围**: ${scope.type}${scope.relPath ? ` · \`${scope.relPath}\`` : ""}`,
    `- **会话 ID**: ${state.sessionId || "（新会话）"}`,
    `- **CWD**: ${state.cwd || "—"}`,
    `- **消息**: 用户 ${userCount} · 助手 ${assistantCount}`,
    `- **时间线事件**: ${state.timeline.length}`,
    `- **执行中**: ${state.running ? "是" : "否"}`,
  ].join("\n");
}

function formatUsage(ctx: LocalSlashContext): string {
  const { state } = ctx;
  return [
    "## 会话统计",
    "",
    `- **用户消息**: ${state.messages.filter((m) => m.role === "user").length}`,
    `- **助手回复**: ${state.messages.filter((m) => m.role === "assistant").length}`,
    `- **时间线事件**: ${state.timeline.length}`,
    `- **会话 ID**: ${state.sessionId || "—"}`,
    "",
    "完整 token 用量请使用 `/cost`（透传 Claude Code）或由 CLI 会话统计。",
  ].join("\n");
}

function formatGitSummary(ctx: LocalSlashContext): string {
  const g = ctx.gitSummary;
  if (!g) return "无法获取 Git 摘要，请确认工作区已绑定。";
  if (!g.gitAvailable) {
    return `当前目录不是 Git 仓库${g.error ? `（${g.error}）` : ""}。`;
  }
  return [
    "## Git 变更摘要",
    "",
    `- **分支**: ${g.branch || "—"}`,
    `- **未提交变更**: ${g.dirtyCount ?? 0} 个文件`,
  ].join("\n");
}

async function formatSkillsList(): Promise<string> {
  try {
    const res = await fetch("/api/skills");
    const data = (await res.json()) as {
      skills?: Array<{ name?: string; description?: string; enabled?: boolean }>;
    };
    const skills = data.skills || [];
    if (!skills.length) return "未找到项目 Skill。";
    const lines = ["## 项目 Skills", "", `共 ${skills.length} 个：`, ""];
    for (const s of skills.slice(0, 40)) {
      const status = s.enabled === false ? "（已禁用）" : "";
      lines.push(`- **${s.name || "skill"}**${status}${s.description ? ` — ${s.description}` : ""}`);
    }
    if (skills.length > 40) lines.push("", `… 另有 ${skills.length - 40} 个`);
    lines.push("", "在对话中输入 `/skill-name` 可透传给 Claude Code 执行对应 Skill。");
    return lines.join("\n");
  } catch {
    return "拉取 Skill 列表失败。";
  }
}

export async function executeLocalSlashCommand(
  ctx: LocalSlashContext,
): Promise<string | null> {
  const name = ctx.commandName.toLowerCase();

  switch (name) {
    case "help":
      return formatSlashHelp(ctx.slashCommands);
    case "clear":
    case "new":
    case "reset":
      ctx.resetConversation();
      return null;
    case "stop":
    case "cancel":
      if (ctx.state.running) {
        ctx.cancelRun();
        return "已停止当前回复。";
      }
      return "当前没有进行中的回复。";
    case "config":
    case "settings":
      ctx.openConfig();
      return "已打开 Coding 配置面板，可在页面顶部编辑模型与权限。";
    case "status":
      return formatHealth(ctx, false);
    case "doctor":
      return formatHealth(ctx, true);
    case "context":
      return formatContext(ctx);
    case "usage":
    case "cost":
    case "stats":
      return formatUsage(ctx);
    case "diff":
      return formatGitSummary(ctx);
    case "export": {
      const transcript = formatTranscript(ctx.state);
      if (!transcript) return "当前对话为空，无可导出内容。";
      const filename =
        ctx.args.trim() ||
        `claude-code-chat-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.md`;
      downloadText(filename.endsWith(".md") ? filename : `${filename}.md`, transcript);
      return `已导出 ${ctx.state.messages.length} 条消息到 \`${filename}\`。`;
    }
    case "copy": {
      const text = lastAssistantContent(ctx.state);
      if (!text) return "没有可复制的助手回复。";
      try {
        await navigator.clipboard.writeText(text);
        return "已复制上一条助手回复到剪贴板。";
      } catch {
        return `复制失败，请手动复制：\n\n${text.slice(0, 500)}…`;
      }
    }
    case "skills":
      return formatSkillsList();
    case "reload-skills":
    case "reload":
      ctx.reloadSlashCommands();
      return "已重新扫描 `.claude/commands`、`.cursor/commands` 与项目 Skills。";
    case "commit": {
      const hint = ctx.args.trim();
      const res = await ctx.gitCommit(hint, {
        asHint: !!hint,
        onProgress: ctx.onProgress,
      });
      return res.message;
    }
    case "push": {
      const remote = ctx.args.trim() || undefined;
      const res = await ctx.gitPush(remote, ctx.onProgress);
      return res.message;
    }
    case "commit-push":
    case "ship": {
      const hint = ctx.args.trim();
      const res = await ctx.gitCommitAndPush(hint, {
        asHint: !!hint,
        onProgress: ctx.onProgress,
      });
      return res.message;
    }
    default:
      return null;
  }
}
