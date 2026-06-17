export function buildBugPolishSystemPrompt(): string {
  return [
    "你是资深 QA / 技术写作专家，负责把缺陷报告润色为清晰、可复现的专业描述。",
    "要求：",
    "1. 用中文，结构建议：【问题概述】【复现步骤】【实际结果】【期望结果】【补充说明】；",
    "2. 不编造未提供的环境、版本、数据；缺失项可写「待补充」；",
    "3. 步骤用有序列表，表述简洁；",
    "4. 仅输出润色后的正文（Markdown 或纯文本均可），不要解释修改过程。",
  ].join("\n");
}

export function buildBugGenerateSystemPrompt(): string {
  return [
    "你是资深 QA，根据缺陷标题和用户提供的关键信息，生成完整缺陷描述。",
    "要求：",
    "1. 用中文，包含：问题概述、复现步骤、实际结果、期望结果；",
    "2. 不编造具体版本号或数据，未知处标注「待补充」；",
    "3. 步骤清晰可执行；",
    "4. 仅输出描述正文，不要前缀说明。",
  ].join("\n");
}

export async function askTapdAI(
  systemPrompt: string,
  userContent: string,
): Promise<string> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      stream: false,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
    }),
  });
  const raw = await res.text();
  let content: string | undefined;
  let apiError: string | undefined;
  try {
    const data = JSON.parse(raw) as { content?: string; error?: string };
    content = data.content;
    apiError = data.error;
  } catch {
    content = raw;
  }
  if (res.ok) {
    const trimmed = (content ?? "").trim();
    if (!trimmed) {
      throw new Error("模型未返回正文，请检查 LLM 配置。");
    }
    return trimmed;
  }
  throw new Error(apiError ?? content ?? raw ?? `HTTP ${res.status}`);
}

export const MAX_TAPD_ATTACHMENTS = 8;
export const MAX_TAPD_ATTACHMENT_BYTES = 50 * 1024 * 1024;

export type TapdBugPriority = "urgent" | "high" | "medium" | "low";

export type TapdBugAnalysis = {
  ok: boolean;
  title?: string;
  description?: string;
  priority?: TapdBugPriority;
  confidence?: number;
  model?: string;
  error?: string;
  analyzed?: Array<{
    filename?: string;
    kind?: string;
    frames?: number;
    entries?: number;
    errors?: number;
  }>;
  partial_errors?: string[] | null;
};

export async function analyzeBugFromMedia(files: File[]): Promise<TapdBugAnalysis> {
  if (!files.length) {
    return { ok: false, error: "请先上传附件（截图/录屏/HAR）" };
  }

  const fd = new FormData();
  for (const file of files) {
    fd.append("attachments", file, file.name);
  }

  const res = await fetch("/api/tapd/bugs/analyze-media", {
    method: "POST",
    body: fd,
  });

  const raw = await res.text();
  let data: TapdBugAnalysis & { detail?: string };
  try {
    data = JSON.parse(raw) as TapdBugAnalysis & { detail?: string };
  } catch {
    throw new Error(raw || `HTTP ${res.status}`);
  }

  if (!res.ok || !data.ok) {
    throw new Error(data.error || data.detail || raw || `HTTP ${res.status}`);
  }

  return data;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function isHarAttachment(file: File): boolean {
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  return ext === "har";
}

export function isAllowedAttachment(file: File): boolean {
  const t = (file.type || "").toLowerCase();
  if (t.startsWith("image/") || t.startsWith("video/")) return true;
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  return [
    "png",
    "jpg",
    "jpeg",
    "gif",
    "webp",
    "bmp",
    "mp4",
    "mov",
    "webm",
    "avi",
    "mkv",
    "har",
  ].includes(ext);
}

export type FeishuMember = { open_id: string; name: string };

export async function fetchMergedChatMembers(
  chatIds: string[],
): Promise<FeishuMember[]> {
  const ids = [...new Set(chatIds.filter((id) => id.trim().startsWith("oc_")))];
  if (!ids.length) return [];
  const merged = new Map<string, FeishuMember>();
  await Promise.all(
    ids.map(async (id) => {
      const res = await fetch(
        `/api/meal/feishu/chat-members?chat_id=${encodeURIComponent(id.trim())}`,
        { cache: "no-store" },
      );
      const d = await res.json().catch(() => ({})) as {
        members?: FeishuMember[];
      };
      for (const m of d.members || []) {
        if (m.open_id) merged.set(m.open_id, m);
      }
    }),
  );
  return Array.from(merged.values()).sort((a, b) =>
    a.name.localeCompare(b.name, "zh-CN"),
  );
}

export function parseManualChatIds(raw: string): string[] {
  return [
    ...new Set(
      raw
        .replace(/\n/g, ",")
        .split(/[,，\s]+/)
        .map((s) => s.trim())
        .filter((s) => s.startsWith("oc_")),
    ),
  ];
}

/** lark-cli gRPC 子进程 stderr 噪音，不代表飞书发送失败 */
export function isFeishuCliNoiseError(msg: string | null | undefined): boolean {
  if (!msg?.trim()) return false;
  return /ev_poll_posix|FD from fork parent still in poll list/i.test(msg);
}

export type TapdExportFormat = "md" | "excel" | "pdf" | "ppt";

export function downloadBlobFile(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function exportTapdStatsReport(opts: {
  format: TapdExportFormat;
  rangeDays: number;
  withAi: boolean;
  mode?: "summary" | "deep";
  userNote?: string;
}): Promise<{ filename: string; blob: Blob }> {
  const res = await fetch("/api/tapd/bugs/stats/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      format: opts.format,
      range_days: opts.rangeDays,
      with_ai: opts.withAi,
      mode: opts.mode || "summary",
      user_note: opts.userNote || "",
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string; detail?: string }).error ||
        (err as { detail?: string }).detail ||
        `HTTP ${res.status}`,
    );
  }

  const blob = await res.blob();
  const filename =
    res.headers.get("X-Export-Filename") ||
    res.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ||
    `tapd-stats.${opts.format === "excel" ? "xlsx" : opts.format === "ppt" ? "pptx" : opts.format}`;

  return { filename, blob };
}
