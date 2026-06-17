export type DevReportKind = "daily" | "weekly" | "monthly" | "custom";

export type GitCommitRecord = {
  hash: string;
  shortHash: string;
  authorName: string;
  authorEmail: string;
  date: string;
  subject: string;
  repoPath?: string;
};

const REPO_PATH_SPLIT = /[\n,;]+/;

/** 从文本解析多个仓库路径（换行、逗号、分号分隔）。 */
export function parseRepoPathsInput(input?: string | null): string[] {
  if (!input?.trim()) return [];
  const parts = input
    .split(REPO_PATH_SPLIT)
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set(parts)];
}

export function repoDisplayName(repoPath: string): string {
  const parts = repoPath.replace(/\/+$/, "").split(/[/\\]/);
  return parts[parts.length - 1] || repoPath;
}

export function formatGitApiError(code: string): string {
  switch (code) {
    case "repo_path_not_found":
      return "仓库路径不存在，请检查是否填写正确";
    case "repo_path_not_git":
      return "该路径不是有效的 Git 仓库";
    case "author_required":
      return "请填写提交者";
    default:
      return code;
  }
}

export function computeReportRange(
  kind: DevReportKind,
  customStart?: string,
  customEnd?: string,
): { since: string; until: string; label: string } {
  const now = new Date();
  const until = new Date(now);
  until.setHours(23, 59, 59, 999);

  if (kind === "custom") {
    const start = customStart
      ? new Date(`${customStart}T00:00:00`)
      : new Date(now);
    const end = customEnd
      ? new Date(`${customEnd}T23:59:59`)
      : until;
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new Error("自定义日期无效");
    }
    return {
      since: start.toISOString(),
      until: end.toISOString(),
      label: `${customStart || "…"} ~ ${customEnd || "…"}`,
    };
  }

  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  if (kind === "daily") {
    return {
      since: start.toISOString(),
      until: until.toISOString(),
      label: start.toISOString().slice(0, 10),
    };
  }

  if (kind === "weekly") {
    start.setDate(start.getDate() - 6);
    return {
      since: start.toISOString(),
      until: until.toISOString(),
      label: `近 7 天（${start.toISOString().slice(0, 10)} ~ ${until.toISOString().slice(0, 10)}）`,
    };
  }

  start.setDate(1);
  return {
    since: start.toISOString(),
    until: until.toISOString(),
    label: `${start.toISOString().slice(0, 7)} 月`,
  };
}

export function reportKindLabel(kind: DevReportKind): string {
  switch (kind) {
    case "daily":
      return "日报";
    case "weekly":
      return "周报";
    case "monthly":
      return "月报";
    default:
      return "工作报告";
  }
}

export function buildCommitsDigest(commits: GitCommitRecord[]): string {
  if (commits.length === 0) {
    return "（该时间段内无匹配提交）";
  }
  const repoPaths = [
    ...new Set(commits.map((c) => c.repoPath).filter(Boolean) as string[]),
  ];
  const multiRepo = repoPaths.length > 1;

  const byDay = new Map<string, number>();
  for (const c of commits) {
    const day = c.date.slice(0, 10);
    byDay.set(day, (byDay.get(day) || 0) + 1);
  }
  const dayStats = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, count]) => `${day}: ${count} 次提交`)
    .join("\n");

  const header = multiRepo
    ? `共 ${commits.length} 条提交（${repoPaths.length} 个仓库）`
    : `共 ${commits.length} 条提交`;

  const subjectNote =
    "（commit subject 可能为英文，请按语义归纳，不要因语言不同而跳过）";

  if (multiRepo) {
    const byRepo = new Map<string, GitCommitRecord[]>();
    for (const c of commits) {
      const key = c.repoPath || "unknown";
      if (!byRepo.has(key)) byRepo.set(key, []);
      byRepo.get(key)!.push(c);
    }
    const sections = [...byRepo.entries()].map(([repo, list]) => {
      const lines = list.map(
        (c) =>
          `- ${c.date.slice(0, 16).replace("T", " ")} | ${c.shortHash} | ${c.subject}`,
      );
      return [`### ${repoDisplayName(repo)}`, repo, "", ...lines].join("\n");
    });
    return [
      header,
      subjectNote,
      "",
      "## 按日统计",
      dayStats,
      "",
      "## 提交明细（按仓库）",
      "",
      ...sections,
    ].join("\n");
  }

  const lines = commits.map(
    (c) =>
      `- ${c.date.slice(0, 16).replace("T", " ")} | ${c.shortHash} | ${c.subject}`,
  );
  return [
    header,
    subjectNote,
    "",
    "## 按日统计",
    dayStats,
    "",
    "## 提交明细",
    ...lines,
  ].join("\n");
}

export function buildReportSystemPrompt(kind: DevReportKind): string {
  const kindLabel = reportKindLabel(kind);
  return [
    `你是研发团队的${kindLabel}助手。`,
    "根据用户提供的 Git 提交记录，生成结构化 Markdown 报告。",
    "要求：",
    "1. 报告正文用中文，语言简洁专业；",
    "2. commit message 可能是英文或中英混合，必须正确理解后再归纳，不要忽略英文提交；",
    "3. 按「## 工作概述 / ## 主要完成事项 / ## 技术亮点或风险 / ## 后续计划」组织；",
    "4. 从 commit message 归纳业务价值，不要逐条复读 commit；",
    "5. 若无提交，说明该时段无代码贡献并给出建议；",
    "6. 只输出 Markdown 文本正文，禁止生成图片、禁止输出图片链接或「总结图」类话术；",
    "7. 至少包含 3 个二级标题章节，每章至少 2 条要点或段落，确保预览区有可读内容。",
    kind === "daily"
      ? "8. 日报侧重当日产出与明日计划。"
      : kind === "weekly"
        ? "8. 周报侧重本周成果、协作与下周重点。"
        : kind === "monthly"
          ? "8. 月报侧重月度里程碑、质量与下月目标。"
          : "8. 按给定时间跨度合理组织内容。",
  ].join("\n");
}

export function buildPolishSystemPrompt(kind: DevReportKind): string {
  const kindLabel = reportKindLabel(kind);
  return [
    `你是资深技术写作编辑，负责润色研发${kindLabel}。`,
    "在**不编造、不删除关键事实**的前提下优化文稿。",
    "要求：",
    "1. 保留原有章节结构与要点，可微调标题使更清晰；",
    "2. 语言更流畅、专业，适合发给 Leader 或团队；",
    "3. 弱化口语与重复表述，突出成果与价值；",
    "4. 英文 commit 对应的工作项可保留关键英文术语，但整体仍用中文叙述；",
    "5. 仅输出润色后的 Markdown 正文，不要解释修改过程；",
    "6. 不要添加原文没有的数据、项目名或承诺；",
    "7. 禁止图片、禁止「总结图」或占位话术。",
  ].join("\n");
}

/** Strip image/media artifacts from model output unsuitable for dev reports. */
export function sanitizeReportMarkdown(markdown: string): string {
  let text = markdown.replace(/\r\n/g, "\n").trim();
  if (!text) return text;
  text = text
    .replace(/^A2UI_MEDIA:(image|video):[^\n]*\n?/gim, "")
    .replace(/!\[[^\]]*]\([^)]+\)/g, "")
    .replace(/!\[[^\]]*]\(\s*\)/g, "")
    .replace(/^\s*为您生成了.*总结图[！!]?\s*$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text;
}

export function isWeakReportMarkdown(markdown: string): boolean {
  const text = sanitizeReportMarkdown(markdown);
  if (!text) return true;
  if (text.length < 80) return true;
  const hasSection = /^##\s+/m.test(text);
  const bulletOrParagraph = text.split("\n").filter((line) => line.trim().length > 0).length >= 4;
  if (!hasSection && !bulletOrParagraph) return true;
  if (/总结图|storage\/outputs\/.*\.(png|jpg|webp)/i.test(text) && !hasSection) return true;
  return false;
}

export async function askReportAI(
  systemPrompt: string,
  userContent: string,
): Promise<string> {
  const res = await fetch("/api/lark-cli/generate-text", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system: systemPrompt, user: userContent }),
  });
  const raw = await res.text();
  let content: string | undefined;
  let apiError: string | undefined;
  try {
    const data = JSON.parse(raw) as { content?: string; error?: string };
    content = data.content;
    apiError = data.error;
  } catch {
    content = raw.trim() || undefined;
  }
  if (!res.ok) {
    throw new Error(apiError || content || `HTTP ${res.status}`);
  }
  const sanitized = sanitizeReportMarkdown(content || "");
  if (!sanitized) {
    throw new Error("模型未返回报告正文，请检查 LLM 配置后重试。");
  }
  if (isWeakReportMarkdown(sanitized)) {
    throw new Error(
      "模型返回内容过短或仅为图片占位，未生成有效 Markdown 报告。请重试；若仍失败请检查「设置 → 模型」。",
    );
  }
  return sanitized;
}

export function safeDownloadBasename(name: string): string {
  return (
    name
      .trim()
      .replace(/[/\\?*:|"<>]/g, "-")
      .replace(/\s+/g, "_")
      .slice(0, 80) || "dev-report"
  );
}

export function downloadMarkdownFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".md") ? filename : `${filename}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

export type FeishuDocCreateCliPayload = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export async function createFeishuDocViaApi(
  title: string,
  markdown: string,
  timeoutMs = 90000,
): Promise<FeishuDocCreateCliPayload> {
  const res = await fetch("/api/lark-cli", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      docsCreate: { title, markdown: prepareFeishuMarkdown(markdown) },
      timeoutMs,
    }),
  });
  const data = (await res.json()) as {
    ok?: boolean;
    error?: string;
    result?: FeishuDocCreateCliPayload & {
      command?: string;
      durationMs?: number;
    };
  };
  if (!res.ok || !data.result) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return {
    exitCode: data.result.exitCode,
    stdout: data.result.stdout,
    stderr: data.result.stderr,
  };
}

export type FeishuDocCreateResult = {
  ok: boolean;
  title: string;
  url?: string;
  documentId?: string;
  message: string;
  detail?: string;
};

const FEISHU_DOC_URL_RE =
  /https?:\/\/[^\s"'<>]+(?:feishu\.cn|larkoffice\.com|larksuite\.com)[^\s"'<>]*/gi;

function tryParseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function findFeishuUrlInValue(value: unknown, depth = 0): string | undefined {
  if (depth > 8 || value == null) return undefined;
  if (typeof value === "string") {
    const hit = value.match(FEISHU_DOC_URL_RE);
    return hit?.[0];
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFeishuUrlInValue(item, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const direct = pickString(record, [
      "url",
      "link",
      "docs_url",
      "doc_url",
      "document_url",
      "open_url",
      "share_url",
    ]);
    if (direct) {
      const hit = direct.match(FEISHU_DOC_URL_RE);
      if (hit?.[0]) return hit[0];
    }
    for (const nested of Object.values(record)) {
      const found = findFeishuUrlInValue(nested, depth + 1);
      if (found) return found;
    }
  }
  return undefined;
}

function pickDocumentId(value: unknown, depth = 0): string | undefined {
  if (depth > 8 || value == null) return undefined;
  if (typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const direct = pickString(record, [
      "document_id",
      "documentId",
      "doc_token",
      "docs_token",
      "obj_token",
      "token",
    ]);
    if (direct) return direct;
    for (const nested of Object.values(record)) {
      const found = pickDocumentId(nested, depth + 1);
      if (found) return found;
    }
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = pickDocumentId(item, depth + 1);
      if (found) return found;
    }
  }
  return undefined;
}

export function prepareFeishuMarkdown(markdown: string): string {
  let text = markdown.replace(/\r\n/g, "\n").trim();
  if (!text) return text;
  text = text.replace(/\n(#{1,6}\s)/g, "\n\n$1");
  text = text.replace(/([^\n])\n([-*]\s)/g, "$1\n\n$2");
  text = text.replace(/\n{3,}/g, "\n\n");
  return text;
}

export function parseFeishuDocCreateCliOutput(
  payload: FeishuDocCreateCliPayload,
  title: string,
): FeishuDocCreateResult {
  const stdout = (payload.stdout || "").trim();
  const stderr = (payload.stderr || "").trim();
  if (payload.exitCode !== 0) {
    return {
      ok: false,
      title,
      message: "创建飞书文档失败",
      detail: stderr || stdout || `exit=${payload.exitCode}`,
    };
  }

  let url = stdout.match(FEISHU_DOC_URL_RE)?.[0];
  const parsed = tryParseJsonObject(stdout);
  if (parsed) {
    url = url || findFeishuUrlInValue(parsed);
  }
  const documentId = parsed ? pickDocumentId(parsed) : undefined;
  if (!url && documentId) {
    url = `https://www.feishu.cn/docx/${documentId}`;
  }

  if (url) {
    return {
      ok: true,
      title,
      url,
      documentId,
      message: "飞书文档已创建，可点击下方链接打开。",
    };
  }

  return {
    ok: true,
    title,
    message: "飞书文档已创建",
    detail:
      "未能从命令输出解析跳转链接，请在飞书「云文档」中按标题搜索查看。" +
      (stdout ? `\n\n输出摘要：${stdout.slice(0, 280)}` : ""),
  };
}
