/** Claude Code 风格斜杠命令：本地 UI 操作 vs 透传 SDK */

export type SlashCommandScope = "local" | "sdk";

export type SlashCommandCategory =
  | "local"
  | "session"
  | "context"
  | "config"
  | "review"
  | "workflow"
  | "diagnostic"
  | "skill"
  | "custom";

export type SlashCommandDef = {
  name: string;
  description: string;
  scope: SlashCommandScope;
  category?: SlashCommandCategory;
  argumentHint?: string;
  aliases?: string[];
};

export const SLASH_CATEGORY_LABELS: Record<SlashCommandCategory, string> = {
  local: "本页快捷",
  session: "会话管理",
  context: "上下文与记忆",
  config: "配置与工具",
  review: "审查与差异",
  workflow: "计划与工作流",
  diagnostic: "诊断与用量",
  skill: "项目 Skill",
  custom: "自定义命令",
};

function cmd(
  name: string,
  description: string,
  opts: Partial<Omit<SlashCommandDef, "name" | "description">> = {},
): SlashCommandDef {
  return {
    name,
    description,
    scope: opts.scope ?? "sdk",
    category: opts.category ?? "custom",
    argumentHint: opts.argumentHint,
    aliases: opts.aliases,
  };
}

/** 内置命令（对齐 Claude Code CLI 常用集；Web 可本地处理的标为 local） */
export const BUILTIN_SLASH_COMMANDS: SlashCommandDef[] = [
  // 本页快捷
  cmd("help", "显示可用斜杠命令与快捷键", { scope: "local", category: "local" }),
  cmd("clear", "清空对话并开始新会话", {
    scope: "local",
    category: "local",
    aliases: ["new", "reset"],
  }),
  cmd("stop", "停止当前回复", { scope: "local", category: "local", aliases: ["cancel"] }),
  cmd("config", "打开 Coding 配置面板", {
    scope: "local",
    category: "local",
    aliases: ["settings"],
  }),
  cmd("status", "查看 Claude Code 就绪状态与模型", { scope: "local", category: "local" }),
  cmd("doctor", "诊断 SDK / CLI / API 密钥环境", { scope: "local", category: "local" }),
  cmd("export", "导出当前对话为文本", {
    scope: "local",
    category: "local",
    argumentHint: "[filename]",
  }),
  cmd("context", "查看当前会话上下文摘要", {
    scope: "local",
    category: "local",
    argumentHint: "[all]",
  }),
  cmd("copy", "复制上一条助手回复", { scope: "local", category: "local", argumentHint: "[N]" }),
  cmd("skills", "列出项目可用 Agent Skills", { scope: "local", category: "local" }),
  cmd("reload-skills", "重新扫描 Skill 与自定义命令", {
    scope: "local",
    category: "local",
    aliases: ["reload"],
  }),
  cmd("diff", "查看工作区 Git 变更摘要", { scope: "local", category: "local" }),
  cmd("commit", "分析变更并自动提交（可选手动说明）", {
    scope: "local",
    category: "local",
    argumentHint: "[hint]",
  }),
  cmd("push", "推送到远程仓库", {
    scope: "local",
    category: "local",
    argumentHint: "[remote]",
  }),
  cmd("commit-push", "分析变更、自动提交并推送", {
    scope: "local",
    category: "local",
    argumentHint: "[hint]",
    aliases: ["ship"],
  }),
  cmd("usage", "查看本会话消息与事件统计", {
    scope: "local",
    category: "local",
    aliases: ["cost", "stats"],
  }),

  // 会话管理
  cmd("compact", "压缩对话上下文以节省 token", {
    category: "session",
    argumentHint: "[instructions]",
  }),
  cmd("resume", "恢复历史会话", { category: "session", aliases: ["continue"] }),
  cmd("rewind", "回退对话或代码检查点", {
    category: "session",
    aliases: ["checkpoint", "undo"],
  }),
  cmd("branch", "从当前对话分叉出新分支", { category: "session", argumentHint: "[name]" }),
  cmd("fork", "后台分叉子任务并继承上下文", { category: "session" }),
  cmd("btw", "旁路提问，不写入主对话历史", { category: "session" }),
  cmd("rename", "为当前会话命名", { category: "session", argumentHint: "[name]" }),
  cmd("recap", "生成当前会话一行摘要", { category: "session" }),

  // 上下文与记忆
  cmd("memory", "编辑 CLAUDE.md 项目记忆", { category: "context" }),
  cmd("init", "扫描项目并生成 CLAUDE.md", { category: "context" }),
  cmd("add-dir", "添加可访问的工作目录", { category: "context", argumentHint: "<path>" }),
  cmd("cd", "将会话切换到新工作目录", { category: "context", argumentHint: "<path>" }),

  // 配置与工具
  cmd("model", "查看或切换模型", { category: "config", argumentHint: "[model]" }),
  cmd("effort", "调整推理强度", {
    category: "config",
    argumentHint: "[low|medium|high|xhigh]",
  }),
  cmd("fast", "开关快速模式", { category: "config", argumentHint: "[on|off]" }),
  cmd("permissions", "管理工具权限规则", {
    category: "config",
    aliases: ["allowed-tools"],
  }),
  cmd("mcp", "管理 MCP 服务器连接", {
    category: "config",
    argumentHint: "[reconnect|enable|disable]",
  }),
  cmd("agents", "管理子 Agent 配置", { category: "config" }),
  cmd("hooks", "查看 Hook 配置", { category: "config" }),
  cmd("plugin", "管理 Claude Code 插件", { category: "config", argumentHint: "[subcommand]" }),
  cmd("ide", "管理 IDE 集成状态", { category: "config" }),
  cmd("terminal-setup", "配置终端快捷键（Shift+Enter 等）", { category: "config" }),
  cmd("theme", "切换配色主题", { category: "config", argumentHint: "[theme]" }),
  cmd("keybindings", "打开快捷键配置", { category: "config" }),

  // 审查与差异
  cmd("review", "审查 Pull Request 或变更", { category: "review", argumentHint: "[PR]" }),
  cmd("code-review", "审查当前 diff 的正确性与简化点", {
    category: "review",
    argumentHint: "[--fix] [target]",
  }),
  cmd("security-review", "安全漏洞审查（注入、鉴权等）", { category: "review" }),
  cmd("simplify", "简化与清理已改动代码", { category: "review", argumentHint: "[target]" }),

  // 计划与工作流
  cmd("plan", "进入计划模式并拆解任务", { category: "workflow", argumentHint: "[description]" }),
  cmd("batch", "大规模并行改动编排", { category: "workflow" }),
  cmd("verify", "构建并验证应用行为", { category: "workflow" }),
  cmd("run", "启动并驱动运行中的应用", { category: "workflow" }),
  cmd("loop", "按间隔重复执行提示", { category: "workflow", argumentHint: "[interval] [prompt]" }),
  cmd("tasks", "查看后台任务", { category: "workflow", aliases: ["bashes"] }),
  cmd("background", "将会话转为后台 Agent", {
    category: "workflow",
    aliases: ["bg"],
    argumentHint: "[prompt]",
  }),
  cmd("deep-research", "多源检索并生成引用报告", { category: "workflow" }),

  // 诊断
  cmd("debug", "开启调试日志并排查问题", { category: "diagnostic", argumentHint: "[description]" }),
  cmd("release-notes", "查看 Claude Code 版本更新说明", { category: "diagnostic" }),
  cmd("insights", "分析历史会话模式与摩擦点", { category: "diagnostic" }),
];

const CATEGORY_SORT: Record<SlashCommandCategory, number> = {
  local: 0,
  session: 1,
  context: 2,
  config: 3,
  review: 4,
  workflow: 5,
  diagnostic: 6,
  skill: 7,
  custom: 8,
};

export type ParsedSlashInput = {
  isSlash: boolean;
  isShell: boolean;
  commandQuery: string;
  fullCommand: string;
};

export function parseSlashInput(raw: string): ParsedSlashInput {
  const text = raw.trimStart();
  const isShell = text.startsWith("!");
  const isSlash = text.startsWith("/") && !isShell;
  if (!isSlash) {
    return { isSlash: false, isShell, commandQuery: "", fullCommand: "" };
  }
  const body = text.slice(1);
  const firstSpace = body.search(/\s/);
  const commandQuery = (firstSpace === -1 ? body : body.slice(0, firstSpace)).toLowerCase();
  const fullCommand =
    firstSpace === -1
      ? body.toLowerCase()
      : `${body.slice(0, firstSpace).toLowerCase()}${body.slice(firstSpace)}`;
  return { isSlash: true, isShell, commandQuery, fullCommand };
}

export function mergeSlashCommands(
  builtin: SlashCommandDef[],
  custom: SlashCommandDef[],
): SlashCommandDef[] {
  const seen = new Set<string>();
  const out: SlashCommandDef[] = [];
  for (const cmd of [...builtin, ...custom]) {
    const key = cmd.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cmd);
  }
  return out;
}

export function filterSlashCommands(
  commands: SlashCommandDef[],
  query: string,
): SlashCommandDef[] {
  const q = query.trim().toLowerCase();
  if (!q) return commands;
  return commands.filter((c) => {
    if (c.name.startsWith(q) || c.name.includes(q)) return true;
    if ((c.aliases || []).some((a) => a.startsWith(q) || a.includes(q))) return true;
    if (c.description.toLowerCase().includes(q)) return true;
    return false;
  });
}

export function sortSlashCommands(commands: SlashCommandDef[]): SlashCommandDef[] {
  return [...commands].sort((a, b) => {
    const ca = CATEGORY_SORT[a.category || "custom"] ?? 9;
    const cb = CATEGORY_SORT[b.category || "custom"] ?? 9;
    if (ca !== cb) return ca - cb;
    if (a.scope !== b.scope) return a.scope === "local" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export function groupSlashCommands(
  commands: SlashCommandDef[],
): Array<{ category: SlashCommandCategory; label: string; items: SlashCommandDef[] }> {
  const map = new Map<SlashCommandCategory, SlashCommandDef[]>();
  for (const c of sortSlashCommands(commands)) {
    const cat = c.category || (c.scope === "local" ? "local" : "custom");
    const list = map.get(cat) || [];
    list.push(c);
    map.set(cat, list);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => (CATEGORY_SORT[a] ?? 9) - (CATEGORY_SORT[b] ?? 9))
    .map(([category, items]) => ({
      category,
      label: SLASH_CATEGORY_LABELS[category],
      items,
    }));
}

export function resolveSlashCommand(
  commands: SlashCommandDef[],
  input: string,
): { def: SlashCommandDef; args: string } | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;
  const rest = trimmed.slice(1).trim();
  if (!rest) return null;
  const space = rest.search(/\s/);
  const name = (space === -1 ? rest : rest.slice(0, space)).toLowerCase();
  const args = space === -1 ? "" : rest.slice(space).trim();
  const def = commands.find(
    (c) =>
      c.name === name || (c.aliases || []).some((a) => a.toLowerCase() === name),
  );
  if (!def) return { def: { name, description: "自定义命令", scope: "sdk", category: "custom" }, args };
  return { def, args };
}

export function isLocalSlashCommand(def: SlashCommandDef): boolean {
  return def.scope === "local";
}

/** 输入已是可执行的完整斜杠命令（非补全中间态） */
export function isCompleteSlashInput(
  commands: SlashCommandDef[],
  input: string,
): boolean {
  const resolved = resolveSlashCommand(commands, input);
  if (!resolved) return false;
  const trimmed = input.trim();
  const names = [resolved.def.name, ...(resolved.def.aliases || [])].map((n) =>
    n.toLowerCase(),
  );
  const matched = names.some(
    (n) => trimmed === `/${n}` || trimmed.startsWith(`/${n} `),
  );
  if (!matched) return false;
  const hint = resolved.def.argumentHint?.trim() || "";
  if (hint && !hint.startsWith("[") && !resolved.args) return false;
  return true;
}

/** 本地命令在菜单中点击后可直接执行（无需再点发送） */
export function slashCommandRunsOnPick(def: SlashCommandDef): boolean {
  return def.scope === "local";
}

export function formatSlashHelp(commands: SlashCommandDef[]): string {
  const groups = groupSlashCommands(commands);
  const lines = [
    "## 斜杠命令",
    "",
    `共 **${commands.length}** 条。输入 \`/\` 唤起菜单，支持 ↑↓ 选择与 Tab 补全。`,
    "",
  ];
  for (const g of groups) {
    lines.push(`### ${g.label}`);
    for (const c of g.items) {
      const alias =
        c.aliases?.length ? `（${c.aliases.map((a) => `/${a}`).join("、")}）` : "";
      const hint = c.argumentHint ? ` ${c.argumentHint}` : "";
      const tag = c.scope === "local" ? "本地" : "Claude Code";
      lines.push(`- \`/${c.name}\`${hint}${alias} — ${c.description} · *${tag}*`);
    }
    lines.push("");
  }
  lines.push(
    "### 其他",
    "- `!command` — Shell 模式",
    "- `Enter` 发送 · `Shift+Enter` 换行",
  );
  return lines.join("\n");
}
