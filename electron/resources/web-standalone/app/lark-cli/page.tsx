"use client";

import { MarkdownSummaryPreview } from "@/components/MarkdownSummaryPreview";
import { exportHtmlToDocx, exportHtmlToPdf } from "@/lib/larkSummaryExport";
import DevReportPanel from "@/app/lark-cli/DevReportPanel";
import TapdBugPanel from "@/app/lark-cli/TapdBugPanel";
import TapdBugStatsPanel from "@/app/lark-cli/TapdBugStatsPanel";
import LarkVotePanel from "@/app/lark-cli/LarkVotePanel";
import OpsPanel from "@/app/lark-cli/OpsPanel";
import { MealReceiptWorkbench } from "@/components/meal/MealReceiptWorkbench";
import { parseFeishuDocCreateCliOutput } from "@/app/lark-cli/dev-report-utils";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Role = "user" | "assistant";

interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  /** 单条命令结果：用卡片展示，避免满屏 exit=0 */
  cliResult?: CliResult;
  /** 批量命令：折叠区展示全部原始输出 */
  cliBatch?: CliResult[];
  /** auth status 等：exit=0 但需用户操作时仍用警示色 */
  cliTone?: "warn";
  /** 排错用长文本，默认折叠，不当作主阅读内容 */
  debugFoldText?: string;
}

interface CliResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

interface CliResponse {
  ok: boolean;
  result?: CliResult;
  results?: CliResult[];
  error?: string;
}

// ─── Param stores ──────────────────────────────────────────────────────────────

interface DocsParams {
  docTitle: string;
  docToken: string;
}
interface SheetsParams {
  sheetTitle: string;
  sheetUrl: string;
}
interface CalendarParams {
  attendeeIds: string;
  meetingTitle: string;
}
interface SummaryParams {
  sourceText: string;
  docTitle: string;
}
/** 工作群：按 chat_id + 时间窗拉消息并总结 */
interface ChatPullParams {
  /** 从列表多选的会话 id */
  chatIds: string[];
  /** 手动 oc_ 或多个 id（逗号/换行分隔）；与 chatIds 合并去重后拉取 */
  chatId: string;
  hoursBack: string;
  /** 预设最近 N 小时，或自定义起止（本地 datetime-local） */
  timeMode: "preset" | "custom";
  customRangeStart: string;
  customRangeEnd: string;
  /** 群列表与读消息使用的身份：用户「我参与的」或机器人所在群 */
  imAs: "user" | "bot";
  /** 服务对象：发送者昵称/姓名片段或正文关键词；仅保留匹配的消息再总结 */
  focusKeyword: string;
}

/** 列表多选 + 手动填写（逗号/换行）合并去重 */
function effectiveChatPullIds(p: ChatPullParams): string[] {
  const fromList = p.chatIds.map((x) => x.trim()).filter(Boolean);
  const manual = p.chatId
    .trim()
    .split(/[,\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set([...fromList, ...manual])];
}

/** 实际拉取用 id：仅「完整功能」合并手动 oc_；简洁版只认列表勾选。 */
function resolveChatPullIdsForWorkbench(
  p: ChatPullParams,
  fullWorkbench: boolean,
): string[] {
  if (fullWorkbench) return effectiveChatPullIds(p);
  return [...new Set(p.chatIds.map((x) => x.trim()).filter(Boolean))];
}

function toDatetimeLocalValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseDatetimeLocalInput(value: string): Date | null {
  if (!value.trim()) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 与原先「最多 168 小时」一致：自定义跨度不得超过 168 小时 */
function resolveChatPullTimeWindow(p: ChatPullParams): {
  start: Date;
  end: Date;
  error?: string;
} {
  if (p.timeMode === "custom") {
    const s = parseDatetimeLocalInput(p.customRangeStart);
    const e = parseDatetimeLocalInput(p.customRangeEnd);
    if (!s || !e) {
      return {
        start: new Date(),
        end: new Date(),
        error: "请填写开始与结束时间",
      };
    }
    if (s.getTime() >= e.getTime()) {
      return { start: s, end: e, error: "结束时间须晚于开始时间" };
    }
    const spanMs = e.getTime() - s.getTime();
    const maxMs = 168 * 3600 * 1000;
    if (spanMs > maxMs) {
      return { start: s, end: e, error: "时间跨度最长 7 天（168 小时）" };
    }
    return { start: s, end: e };
  }
  const hours = Math.min(
    168,
    Math.max(1, parseInt(p.hoursBack, 10) || 24),
  );
  const end = new Date();
  return { start: new Date(end.getTime() - hours * 3600 * 1000), end };
}

/** `im chats list` 单条（群或部分会话） */
interface MyChatRow {
  chat_id: string;
  name: string;
}
interface TaskParams {
  summary: string;
  description: string;
  due: string;
  reminder: string;
}
interface ImParams {
  chatId: string;
  message: string;
}
interface MailParams {
  to: string;
  subject: string;
  body: string;
}
interface VcParams {
  query: string;
}
interface ContactParams {
  query: string;
}
interface DriveParams {
  filePath: string;
}
interface AuthParams {
  loginScope: string;
  loginDomain: string;
}
interface MeetingTodosParams {
  vcStart: string;
  vcEnd: string;
  assigneeId: string;
}
interface WeeklyReportParams {
  sendChatId: string;
  docTitle: string;
}
interface DeadlineAlertParams {
  alertChatId: string;
  hoursAhead: string;
}
interface SchedulingParams {
  attendeeNames: string;
  durationMin: string;
  windowStart: string;
  windowEnd: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function hasPlaceholder(commands: string[]) {
  return commands.some((c) => c.includes("<请填写"));
}

function quoteCliArg(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, " ")
    .trim();
}

/** 浏览器本地下载 Markdown（飞书文档仍另建） */
function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function safeDownloadBasename(name: string): string {
  return (
    name
      .trim()
      .replace(/[/\\?*:|"<>]/g, "-")
      .replace(/\s+/g, "_")
      .slice(0, 80) || "summary"
  );
}

const LS_WORKBENCH_CHAT_PULL = "lark-workbench-chat-pull-v1";

function formatChatPullHoursLabel(hoursBack: string): string {
  const n = parseInt(hoursBack, 10) || 24;
  if (n < 24) return `最近 ${n} 小时`;
  if (n === 24) return "最近 24 小时";
  if (n === 48) return "最近 2 天";
  if (n === 72) return "最近 3 天";
  if (n >= 168) return "最近 7 天";
  return `最近 ${n / 24} 天`;
}

/** 解析 lark-cli 单行 JSON 或前后带日志的 stdout */
function tryParseJsonObject(stdout: string): Record<string, unknown> | null {
  const s = stdout.trim();
  const parse = (raw: string) => {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  };
  let o = parse(s);
  if (o) return o;
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) o = parse(s.slice(start, end + 1));
  return o;
}

/** 从 +chat-messages-list --format json 的一页取出消息数组（兼容 OpenAPI：data.items + body.content） */
function imMessagesArrayFromPage(data: Record<string, unknown>): Record<string, unknown>[] {
  const nested = data.data as Record<string, unknown> | undefined;
  const raw =
    (Array.isArray(data.messages) && data.messages) ||
    (Array.isArray(data.items) && data.items) ||
    (nested && Array.isArray(nested.messages) && nested.messages) ||
    (nested && Array.isArray(nested.items) && nested.items) ||
    [];
  return raw as Record<string, unknown>[];
}

/** 分页元数据：CLI 可能放在根上或 data 下（与 OpenAPI 一致） */
function imChatMessagesListPageMeta(parsed: Record<string, unknown>): {
  hasMore: boolean;
  pageToken: string;
} {
  const nested = parsed.data as Record<string, unknown> | undefined;
  const hasMore =
    parsed.has_more === true || (nested != null && nested.has_more === true);
  const top =
    typeof parsed.page_token === "string" ? parsed.page_token.trim() : "";
  const inner =
    nested != null && typeof nested.page_token === "string"
      ? nested.page_token.trim()
      : "";
  return { hasMore, pageToken: top || inner };
}

/** 飞书 `docs +search` JSON：实体列表可能在多种路径下 */
function docsSearchItemsFromPayload(parsed: Record<string, unknown>): unknown[] {
  const data = parsed.data as Record<string, unknown> | undefined;
  const candidates: unknown[] = [
    data?.docs_entities,
    data?.docs,
    data?.items,
    data?.docs_list,
    data?.entities,
    data?.file_list,
    parsed.docs_entities,
    parsed.items,
    parsed.docs,
    parsed.results,
  ];
  for (const c of candidates) {
    if (Array.isArray(c) && c.length > 0) return c;
  }
  for (const c of candidates) {
    if (Array.isArray(c)) return c;
  }
  return [];
}

function docsSearchPageMeta(parsed: Record<string, unknown>): {
  hasMore: boolean;
  pageToken: string;
} {
  const data = parsed.data as Record<string, unknown> | undefined;
  const hasMore =
    parsed.has_more === true ||
    (data != null && data.has_more === true) ||
    (data != null && String(data.has_more) === "true");
  const top =
    typeof parsed.page_token === "string" ? parsed.page_token.trim() : "";
  const inner =
    data != null && typeof data.page_token === "string"
      ? data.page_token.trim()
      : "";
  return { hasMore: Boolean(hasMore), pageToken: top || inner };
}

interface DocHubRow {
  key: string;
  title: string;
  typeRaw: string;
  url: string;
}

function normalizeDocHubRow(
  item: Record<string, unknown>,
  index: number,
): DocHubRow | null {
  const title =
    (typeof item.title === "string" && item.title) ||
    (typeof item.name === "string" && item.name) ||
    (typeof item.docs_title === "string" && item.docs_title) ||
    (typeof item.summary === "string" && item.summary.trim().slice(0, 200)) ||
    "";
  if (!title.trim()) return null;
  const token =
    (typeof item.docs_token === "string" && item.docs_token) ||
    (typeof item.token === "string" && item.token) ||
    (typeof item.obj_token === "string" && item.obj_token) ||
    `idx-${index}`;
  const typeRaw =
    (typeof item.docs_type === "string" && item.docs_type) ||
    (typeof item.type === "string" && item.type) ||
    (typeof item.obj_type === "string" && item.obj_type) ||
    (typeof item.file_type === "string" && item.file_type) ||
    "unknown";
  const url =
    (typeof item.url === "string" && item.url) ||
    (typeof item.link === "string" && item.link) ||
    (typeof item.docs_url === "string" && item.docs_url) ||
    "";
  return {
    key: `${typeRaw}:${token}`,
    title: title.trim(),
    typeRaw,
    url: url.trim(),
  };
}

function typeLabelForDocHub(typeRaw: string): string {
  const t = typeRaw.toLowerCase();
  if (t.includes("sheet") || t.includes("spreadsheet")) return "电子表格";
  if (t.includes("bitable")) return "多维表格";
  if (t.includes("mindnote")) return "思维笔记";
  if (t.includes("folder")) return "文件夹";
  if (t.includes("wiki")) return "知识库";
  if (t.includes("docx") || t === "doc") return "云文档";
  return "其他";
}

function groupDocHubRows(rows: DocHubRow[]): { label: string; rows: DocHubRow[] }[] {
  const map = new Map<string, DocHubRow[]>();
  for (const r of rows) {
    const label = typeLabelForDocHub(r.typeRaw);
    const list = map.get(label) ?? [];
    list.push(r);
    map.set(label, list);
  }
  const order = [
    "云文档",
    "知识库",
    "电子表格",
    "多维表格",
    "思维笔记",
    "文件夹",
    "其他",
  ];
  const out: { label: string; rows: DocHubRow[] }[] = [];
  for (const label of order) {
    const list = map.get(label);
    if (list?.length) {
      list.sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
      out.push({ label, rows: list });
      map.delete(label);
    }
  }
  for (const [label, list] of map) {
    if (list.length) {
      list.sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
      out.push({ label, rows: list });
    }
  }
  return out;
}

/** 从单条消息解析正文纯文本（与展示行一致） */
function imMessageBodyPlainText(m: Record<string, unknown>): string {
  let body = "";
  const bodyWrap = m.body as Record<string, unknown> | undefined;
  const c =
    m.content ??
    (typeof bodyWrap?.content === "string" ? bodyWrap.content : undefined);
  if (typeof c === "string") {
    try {
      const j = JSON.parse(c) as { text?: string };
      body = (j.text ?? c).replace(/\s+/g, " ").trim();
    } catch {
      body = c.replace(/\s+/g, " ").trim().slice(0, 4000);
    }
  } else if (c != null) {
    body = JSON.stringify(c).slice(0, 4000);
  }
  return body;
}

/**
 * 发送者侧可检索文本（昵称、群名片、各类 id）。
 * 用于「服务对象」筛选：避免仅依赖渲染后的 `[sender]` 字符串（API 字段可能与展示名不一致）。
 */
function imSenderSearchBlob(m: Record<string, unknown>): string {
  const parts: string[] = [];
  const add = (x: unknown) => {
    if (typeof x === "string" && x.trim()) parts.push(x.trim());
  };
  const snd = m.sender as Record<string, unknown> | undefined;
  if (snd && typeof snd === "object") {
    add(snd.sender_name);
    add(snd.name);
    add(snd.nickname);
    add(snd.en_name);
    add(snd.i18n_name);
    const idv = snd.id;
    if (typeof idv === "string") add(idv);
    else if (idv && typeof idv === "object") {
      for (const v of Object.values(idv as Record<string, unknown>)) add(v);
    }
    add(snd.user_id);
    add(snd.open_id);
    add(snd.union_id);
    add(snd.unified_id);
    for (const v of Object.values(snd)) {
      if (typeof v === "string") add(v);
    }
  }
  add(m.sender_id);
  const sid = m.sender_id as Record<string, unknown> | undefined;
  if (sid && typeof sid === "object") {
    for (const v of Object.values(sid)) add(v);
  }
  add(m.user_id);
  add(m.open_id);
  add(m.union_id);
  return parts.join(" ").toLowerCase();
}

function imMessageMatchesFocusKeyword(
  m: Record<string, unknown>,
  kwLower: string,
): boolean {
  if (!kwLower) return true;
  if (imSenderSearchBlob(m).includes(kwLower)) return true;
  return imMessageBodyPlainText(m).toLowerCase().includes(kwLower);
}

function filterImMessagesArrayForFocus(
  msgs: Record<string, unknown>[],
  keyword: string,
): Record<string, unknown>[] {
  const k = keyword.trim().toLowerCase();
  if (!k) return msgs;
  return msgs.filter((m) => imMessageMatchesFocusKeyword(m, k));
}

function imMessageLine(m: Record<string, unknown>): string {
  const snd = m.sender as Record<string, unknown> | undefined;
  const sender =
    (snd?.sender_name as string | undefined) ??
    (snd?.name as string | undefined) ??
    (snd?.id as string | undefined) ??
    "unknown";
  const t = String(m.create_time ?? "");
  const body = imMessageBodyPlainText(m);
  const recalled = m.deleted === true ? "（已撤回）" : "";
  return `[${String(sender)}] ${t}${recalled}\n${body}`;
}

function linesFromImMessagesArray(msgs: Record<string, unknown>[]): string[] {
  return msgs.map(imMessageLine);
}

/** 将 +chat-messages-list --format json 的一页转成可读文本行；可选按发送者/正文做消息级筛选 */
function linesFromImMessagesJson(
  data: Record<string, unknown>,
  focusKeyword?: string,
): string[] {
  const msgs = imMessagesArrayFromPage(data);
  const filtered = filterImMessagesArrayForFocus(msgs, focusKeyword ?? "");
  return linesFromImMessagesArray(filtered);
}

const IM_PULL_DEBUG_STDOUT_HEAD = 4500;

function jsonArrayLenLabel(x: unknown): string {
  if (!Array.isArray(x)) return "非数组";
  return String(x.length);
}

/** 拉取群消息时每页一条，便于对照 CLI 真实 JSON（会话内 + console） */
function formatImChatMessagesPullDebug(
  page: number,
  parsed: Record<string, unknown> | null,
  r: CliResult,
): string {
  const parts: string[] = [];
  parts.push(`第 ${page + 1} 页 | exit=${r.exitCode} | ${r.durationMs}ms`);
  parts.push(
    `stdout=${r.stdout?.length ?? 0}B stderr=${r.stderr?.length ?? 0}B`,
  );
  if ((r.stderr || "").trim()) {
    parts.push(`stderr（末尾 600 字符）:\n${r.stderr.trim().slice(-600)}`);
  }
  if (!parsed) {
    parts.push("tryParseJsonObject → null（stdout 中未解析出 JSON 对象）");
    parts.push(
      `stdout 开头 ${IM_PULL_DEBUG_STDOUT_HEAD} 字符:\n${(r.stdout || "").slice(0, IM_PULL_DEBUG_STDOUT_HEAD)}`,
    );
    return parts.join("\n\n");
  }
  const nested = parsed.data as Record<string, unknown> | undefined;
  parts.push(`顶层键: ${Object.keys(parsed).join(", ")}`);
  if ("code" in parsed || "msg" in parsed) {
    parts.push(`code=${String(parsed.code)} msg=${String(parsed.msg)}`);
  }
  if (nested && typeof nested === "object") {
    parts.push(`data 键: ${Object.keys(nested).join(", ")}`);
  }
  parts.push(
    `数组长度 — 顶 messages=${jsonArrayLenLabel(parsed.messages)} 顶 items=${jsonArrayLenLabel(parsed.items)}`,
  );
  if (nested) {
    parts.push(
      `数组长度 — data.messages=${jsonArrayLenLabel(nested.messages)} data.items=${jsonArrayLenLabel(nested.items)}`,
    );
  }
  const arr = imMessagesArrayFromPage(parsed);
  parts.push(`imMessagesArrayFromPage → ${arr.length} 条`);
  const meta = imChatMessagesListPageMeta(parsed);
  parts.push(
    `分页 hasMore=${meta.hasMore} page_token.len=${meta.pageToken.length}`,
  );
  if (arr.length > 0) {
    const s0 = arr[0];
    parts.push(`首条键: ${Object.keys(s0).join(", ")}`);
    const bw = s0.body;
    if (bw != null && typeof bw === "object") {
      parts.push(`首条.body 键: ${Object.keys(bw as object).join(", ")}`);
    }
    if (typeof s0.content === "string") {
      parts.push(
        `首条.content 前 160 字符: ${s0.content.slice(0, 160).replace(/\s+/g, " ")}`,
      );
    } else {
      parts.push(
        `首条.content: ${s0.content === null || s0.content === undefined ? String(s0.content) : typeof s0.content}`,
      );
    }
  }
  parts.push(
    `stdout 开头 ${IM_PULL_DEBUG_STDOUT_HEAD} 字符:\n${(r.stdout || "").slice(0, IM_PULL_DEBUG_STDOUT_HEAD)}`,
  );
  return parts.join("\n\n");
}

/** 解析 `lark-cli im chats list --format json` 合并后的 items */
function parseImChatsListJson(data: Record<string, unknown>): MyChatRow[] {
  const nested = data.data as Record<string, unknown> | undefined;
  const raw =
    (Array.isArray(data.items) && data.items) ||
    (nested && Array.isArray(nested.items) && nested.items) ||
    [];
  const out: MyChatRow[] = [];
  for (const it of raw as Record<string, unknown>[]) {
    const id = typeof it.chat_id === "string" ? it.chat_id.trim() : "";
    if (!id) continue;
    const name =
      typeof it.name === "string" && it.name.trim() ? it.name.trim() : id;
    out.push({ chat_id: id, name });
  }
  return out;
}

/**
 * 与 `lark-cli auth login --help` 中 `--domain` 一致。
 * Device Flow 下勿再拼 `docs:doc:readonly` 这类旧式 scope 长串，易被服务端判为 malformed。
 */
const LARK_LOGIN_DOMAINS: readonly { id: string; label: string }[] = [
  { id: "docs", label: "云文档" },
  { id: "drive", label: "云盘" },
  { id: "contact", label: "通讯录" },
  { id: "calendar", label: "日历" },
  { id: "task", label: "任务" },
  { id: "sheets", label: "电子表格" },
  { id: "mail", label: "邮箱" },
  { id: "im", label: "即时消息" },
  { id: "vc", label: "视频会议" },
  { id: "wiki", label: "知识库" },
  { id: "event", label: "事件" },
  { id: "minutes", label: "妙记" },
  { id: "base", label: "多维表格" },
  { id: "all", label: "全部域" },
] as const;

function normalizeLoginDomains(raw: string): string {
  return raw
    .split(/[,，\s]+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .join(",");
}

function parseLoginDomainSet(loginDomain: string): Set<string> {
  const n = normalizeLoginDomains(loginDomain);
  return new Set(n ? n.split(",") : []);
}

function isLoginDomainChipSelected(loginDomain: string, id: string): boolean {
  const s = parseLoginDomainSet(loginDomain);
  if (id === "all") return s.size === 1 && s.has("all");
  return s.has(id) && !s.has("all");
}

function toggleLoginDomain(prev: AuthParams, id: string): AuthParams {
  if (id === "all") {
    const had = parseLoginDomainSet(prev.loginDomain).has("all");
    return { loginScope: "", loginDomain: had ? "" : "all" };
  }
  const parts = [...parseLoginDomainSet(prev.loginDomain)].filter((x) => x !== "all");
  const set = new Set(parts);
  if (set.has(id)) set.delete(id);
  else set.add(id);
  return { loginScope: "", loginDomain: [...set].join(",") };
}

/**
 * 优先 domain + recommend（与 CLI 帮助一致）；仅当未选域且填写了 scope 时才纯走 --scope。
 * 注意：lark-cli 校验禁止在同一命令中同时使用 --domain/--recommend 与 --scope；
 * 云文档搜索所需的 search:docs:read 须在另一条 `auth login --scope "..."` 里单独授权（见简洁版「②」串联第二步）。
 */
function buildAuthLoginCommand(p: AuthParams): string {
  const d = normalizeLoginDomains(p.loginDomain);
  const s = p.loginScope.trim().replace(/\s+/g, " ");
  if (d) {
    return `lark-cli auth login --domain "${quoteCliArg(d)}" --recommend`;
  }
  if (s) {
    return `lark-cli auth login --scope "${quoteCliArg(s)}"`;
  }
  return "";
}

/** 使用 domain+recommend 登录且含 docs/wiki/all 时，可串联第二步补 search:docs:read（与纯 --scope 互斥） */
function loginChainNeedsDocSearchSupplement(p: AuthParams): boolean {
  const d = normalizeLoginDomains(p.loginDomain);
  if (!d || p.loginScope.trim()) return false;
  const domainSet = parseLoginDomainSet(d);
  return (
    domainSet.has("all") ||
    domainSet.has("docs") ||
    domainSet.has("wiki")
  );
}

/** 简洁版主按钮默认域：文档 + 即时消息 + 通讯录（便于解析消息发送者等 recommend scope） */
const DEFAULT_SIMPLE_LOGIN_DOMAINS = "docs,im,contact";

/**
 * 读群/单聊消息时 CLI 返回的 missing_scope，hint 要求的三项（须与报错字符串一致）
 */
const LARK_AUTH_SUPPLEMENT_IM_MESSAGES_AS_USER_CMD =
  'lark-cli auth login --scope "im:message.group_msg:get_as_user im:message.p2p_msg:get_as_user contact:user.base:readonly"';

/** 仅会话列表（im chats list）不足时再补 */
const LARK_AUTH_SUPPLEMENT_IM_CHAT_LIST_CMD =
  'lark-cli auth login --scope "im:chat:read"';

/** 飞书文档搜索（docs +search / doc_wiki search）缺少的 scope，与 CLI 报错 hint 一致 */
const LARK_AUTH_SUPPLEMENT_SEARCH_DOCS_READ_CMD =
  'lark-cli auth login --scope "search:docs:read"';

function docHubSearchScopeMissing(text: string): boolean {
  const t = text.toLowerCase();
  return (
    t.includes("search:docs:read") &&
    (t.includes("missing_scope") ||
      t.includes("missing required scope") ||
      t.includes('"type": "missing_scope"') ||
      t.includes('"type":"missing_scope"'))
  );
}

function docHubSearchScopeFollowupText(): string {
  return [
    "💡 「飞书文档助手」依赖 **search:docs:read**。若开放平台里未开通该权限，仅点补充授权也不会生效。",
    "",
    "【管理员】https://open.feishu.cn/app/ → 选择 lark-cli 绑定的自建应用 → 权限管理：开通与「搜索云文档 / doc_wiki」相关的用户权限（控制台可能显示为 search:docs:read），保存后若企业要求发版请先发版。",
    "",
    "【你本人】点下方按钮会跳到「连接飞书」并执行补充授权（与报错 hint 一致）：",
    LARK_AUTH_SUPPLEMENT_SEARCH_DOCS_READ_CMD,
    "",
    "完成后点顶栏或「连接飞书」里的「我授权好了，检查一下」，再回到本页重试「拉取并分类展示」。",
  ].join("\n");
}

function imWorkbenchAuthSupplementSuggested(text: string): boolean {
  const t = text.toLowerCase();
  return (
    t.includes("99991679") ||
    t.includes("permission denied") ||
    t.includes("im:chat:read") ||
    t.includes("missing_scope") ||
    t.includes("missing required scope") ||
    t.includes("im:message.group_msg") ||
    t.includes("im:message.p2p_msg") ||
    t.includes("contact:user.base") ||
    t.includes("insufficient permissions") ||
    t.includes('"type": "permission"') ||
    t.includes('"type":"permission"')
  );
}

/** 拉消息 missing_scope 时：说明开放平台必须先开权限，再给可复制的终端命令 */
function imWorkbenchMissingScopeFollowupText(): string {
  return [
    "💡 若你已点过「补充读群/单聊消息」仍报 missing_scope，多半不是按钮无效，而是下面顺序没满足：",
    "",
    "【必须先做】飞书开放平台里，lark-cli 当前绑定的「自建应用」要开通并保存这些用户权限（名称以控制台为准，可搜索英文 scope）：",
    "  · im:message.group_msg:get_as_user（以用户身份读群消息）",
    "  · im:message.p2p_msg:get_as_user（读单聊等）",
    "  · contact:user.base:readonly（用户基础只读，用于发送者展示名）",
    "若应用里从未勾选这些，浏览器里同意一百次也不会进 token。保存后若贵司要求发版，请发布新版本后再重新授权。",
    "后台入口：https://open.feishu.cn/app/ → 选该应用 → 权限管理",
    "",
    "【再做】本页「连接飞书」里点「仅补充：读群/单聊消息」，或在终端执行（与报错 hint 一致）：",
    LARK_AUTH_SUPPLEMENT_IM_MESSAGES_AS_USER_CMD,
    "",
    "完成后点「我授权好了，检查一下」，再试「拉取群消息」。把本段转给应用管理员最有效。",
  ].join("\n");
}

/**
 * Permission denied 99991679：token 侧或应用可用范围与接口要求不一致（不等同于 missing_scope）
 */
function imWorkbenchPermissionDeniedFollowupText(): string {
  return [
    "💡 你这次是 **Permission denied [99991679]**（不是 missing_scope）：通常表示「用户 token 已拿到，但飞书判定当前应用/身份不能调这个接口」。",
    "",
    "请依次排查：",
    "1）开放平台里该自建应用已开通读消息相关权限且**已发版**，然后在本页「连接飞书」用主按钮 **再完整登录一次**（docs+im+contact），再点「仅补充：读群/单聊消息」走浏览器授权。",
    "2）确认 **应用可用范围** 包含你本人（以及目标群所在部门/租户）；范围外用户即使用户端能聊天，OpenAPI 也可能 99991679。",
    "3）若目标群为 **外部群 / 跨租户**，需管理员按飞书规则为应用开通对外部数据的访问。",
    "4）终端与网页需共用同一套 lark-cli 配置：用 `./start_local.sh` 启动网站，并在本机同一用户下执行 `lark-cli auth status` 看 identity=user 且无报错。",
    "",
    "仍不行时把本段 + 技术明细里的 JSON 发给管理员，对照开放平台「权限管理」与「应用发布版本」排查。",
  ].join("\n");
}

/** 拉消息失败后：选用哪条跟进说明 */
function imWorkbenchPullFailureFollowup(raw: string): string | null {
  const t = raw.toLowerCase();
  if (t.includes("missing_scope") || t.includes("missing required scope")) {
    return imWorkbenchMissingScopeFollowupText();
  }
  if (
    t.includes("99991679") ||
    (t.includes("permission denied") &&
      t.includes('"type"') &&
      t.includes("permission"))
  ) {
    return imWorkbenchPermissionDeniedFollowupText();
  }
  if (
    t.includes("im:chat:read") ||
    t.includes("im:message.group_msg") ||
    t.includes("im:message.p2p_msg") ||
    t.includes("contact:user.base") ||
    t.includes("insufficient permissions")
  ) {
    return imWorkbenchMissingScopeFollowupText();
  }
  return null;
}

/** 飞书 / Lark 授权相关链接，用于自动打开登录页 */
function isLikelyFeishuOAuthUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    return (
      h === "feishu.cn" ||
      h.endsWith(".feishu.cn") ||
      h === "larksuite.com" ||
      h.endsWith(".larksuite.com") ||
      h.endsWith(".feishu.net") ||
      h.endsWith(".larkoffice.com")
    );
  } catch {
    return false;
  }
}

/** 从杂字中提取第一个平衡 {...}，避免贪婪正则吞错或多段 JSON */
function extractFirstBalancedJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr: '"' | "'" | null = null;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = c;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** 解析 lark-cli auth status 的 JSON 输出（可能带前后杂字、ANSI、BOM） */
function tryParseAuthStatusJson(stdout: string): Record<string, unknown> | null {
  let t = stdout
    .replace(/^\uFEFF/, "")
    .replace(/\x1b\[[0-9;]*m/g, "")
    .trim();
  try {
    return JSON.parse(t) as Record<string, unknown>;
  } catch {
    const slice = extractFirstBalancedJsonObject(t);
    if (!slice) return null;
    try {
      return JSON.parse(slice) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

function isAuthStatusJsonShape(
  j: Record<string, unknown> | null,
): j is Record<string, unknown> {
  if (!j || typeof j !== "object") return false;
  return typeof j.appId === "string" && typeof j.brand === "string";
}

/** 与 lark-cli cmd/auth/status.go 语义对齐：仅 bot + note 表示未拿到用户态 */
function authStatusNeedsUserLoginFromJson(j: Record<string, unknown>): boolean {
  const identity = String(j.identity ?? "").toLowerCase();
  const note = String(j.note ?? "");
  const noUser =
    /no user logged in/i.test(note) ||
    /only bot/i.test(note) ||
    /run [`'"]lark-cli auth login/i.test(note) ||
    /token has expired/i.test(note) ||
    /token does not exist|re-login:/i.test(note) ||
    /未登录|没有.*用户|仅.*机器人|机器人身份/i.test(note);
  return identity === "bot" && noUser;
}

function isAuthStatusCliResult(res: CliResult): boolean {
  if (/\bauth\s+status\b/.test(res.command)) return true;
  const j = tryParseAuthStatusJson(res.stdout || "");
  return isAuthStatusJsonShape(j);
}

/** auth status 成功但仅 bot、未登录用户 → 应用警示样式 */
function authStatusNeedsUserLogin(res: CliResult): boolean {
  if (res.exitCode !== 0 || !isAuthStatusCliResult(res)) return false;
  const j = tryParseAuthStatusJson(res.stdout || "");
  if (!isAuthStatusJsonShape(j)) return false;
  return authStatusNeedsUserLoginFromJson(j);
}

/**
 * 飞书网页「配置成功」≠ 本机一定已有用户令牌；以 lark-cli JSON 为准。
 * 优先认 tokenStatus（与 internal/auth/token_store.go 一致：valid / needs_refresh）。
 */
function authPersonalReady(res: CliResult): boolean {
  if (res.exitCode !== 0 || !isAuthStatusCliResult(res)) return false;
  const j = tryParseAuthStatusJson(res.stdout || "");
  if (!isAuthStatusJsonShape(j)) return false;
  if (authStatusNeedsUserLoginFromJson(j)) return false;
  const ts = String(j.tokenStatus ?? "").toLowerCase();
  if (ts === "valid" || ts === "needs_refresh") return true;
  const id = String(j.identity ?? "").toLowerCase();
  if (id === "user" || id === "both") return true;
  const def = String(j.defaultAs ?? "").toLowerCase();
  if (def === "user") return true;
  const note = String(j.note ?? "").toLowerCase();
  if (note.includes("user logged")) return true;
  return false;
}

/** 给进阶用户 / 排错用的原始输出 */
function formatResultTechnical(res: CliResult): string {
  const head = [
    `$ ${res.command}`,
    `exit=${res.exitCode} · ${res.durationMs}ms`,
  ].join("\n");
  const out = res.stdout?.trim() ? `\n\nstdout:\n${res.stdout.trim()}` : "";
  const err = res.stderr?.trim() ? `\n\nstderr:\n${res.stderr.trim()}` : "";
  return `${head}${out}${err}`;
}

/** 成功且 stdout 为 JSON 时给出人话状态，避免把整段 JSON 铺满对话 */
function friendlySuccessFromCliOutput(
  command: string,
  stdout: string,
): string | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  const parsed = tryParseJsonObject(trimmed);
  if (!parsed) return null;
  if (
    command.includes("+chat-messages-list") ||
    command.includes("chat-messages-list")
  ) {
    const n = imMessagesArrayFromPage(parsed).length;
    const { hasMore } = imChatMessagesListPageMeta(parsed);
    if (n === 0) {
      return "✅ 请求已成功，但这段时间里没有解析到文本消息（可能群内无发言、时间范围不合适，或身份/权限与群不匹配）。\n\n可换个时间范围、检查群是否正确，或到「连接飞书」补权限后重试。";
    }
    return `✅ 已拉取 ${n} 条消息片段${hasMore ? "（本群还有更多页，拉取助手上下文时会自动继续翻页）" : ""}。`;
  }
  if (command.includes("chats list")) {
    const rows = parseImChatsListJson(parsed);
    return `✅ 已同步 ${rows.length} 个群/会话，可在上方下拉里选择。`;
  }
  if (command.includes("docs") && command.includes("+create")) {
    const parsed = parseFeishuDocCreateCliOutput(
      { exitCode: 0, stdout: trimmed, stderr: "" },
      "",
    );
    if (parsed.url) {
      return `✅ 已在飞书里新建云文档。\n\n打开链接：${parsed.url}`;
    }
    return "✅ 已在飞书里新建云文档，打开飞书在「云文档」中按标题搜索即可查看。";
  }
  return null;
}

/** 对话区主文案：口语化，不把用户当运维 */
function friendlyCliSummary(res: CliResult): string {
  const out = (res.stdout || "").trim();
  const err = (res.stderr || "").trim();
  if (res.exitCode !== 0) {
    const hint = err || out || "没有更多说明";
    return `这一步没完成。\n\n常见原因：还没在「连接飞书」里登录授权、网络不稳定、或飞书权限不足。\n\n具体说明：${hint.slice(0, 480)}${hint.length > 480 ? "…" : ""}\n\n需要给同事看时，可展开下方「仅排错时展开」复制全文。`;
  }
  if (/--version\b/.test(res.command)) {
    const ver =
      out.match(/lark-cli\s+version\s+([\d.]+)/i)?.[1] ||
      out.split("\n").filter(Boolean)[0] ||
      "未知";
    return `命令行工具工作正常 ✓\n\n当前 lark-cli 版本：${ver}\n\n可以继续点别的快捷按钮试试～`;
  }
  if (/\bdoctor\b/.test(res.command)) {
    const body = out.slice(0, 1400);
    return `环境小体检跑完啦 ✓\n\n${body}${out.length > 1400 ? "\n\n（报告较长，其余内容可在页面底部「执行命令」里重跑 lark-cli doctor 查看。）" : ""}`;
  }
  if (/\bauth\s+status\b/.test(res.command)) {
    const j = tryParseAuthStatusJson(out);
    if (j && res.exitCode === 0 && isAuthStatusJsonShape(j)) {
      const ts = String(j.tokenStatus ?? "").toLowerCase();
      if (ts === "valid" || ts === "needs_refresh") {
        return (
          "✅ 已用个人飞书账号登录，连接状态正常（令牌有效）。\n\n" +
          "可以正常使用日历、文档、任务、会议等功能了。"
        );
      }
      const identity = String(j.identity ?? "").toLowerCase();
      const note = String(j.note ?? "");
      const noUser =
        /no user logged in/i.test(note) ||
        /only bot/i.test(note) ||
        /run ['"]lark-cli auth login/i.test(note) ||
        /token has expired/i.test(note) ||
        /token does not exist|re-login:/i.test(note) ||
        /未登录|没有.*用户|仅.*机器人/i.test(note);
      if (identity === "bot" && noUser) {
        return (
          "⚠️ 还没有用你的「个人飞书账号」登录。\n\n" +
          "现在只有应用机器人身份，很多功能（看自己的日历、任务、文档等）会受限或不可用。\n\n" +
          "👉 请到本页「连接飞书」区域操作（找不到时先点左侧「连接飞书」或右上角「去连接」）：\n" +
          "· 简洁版（默认）：点「② 登录我的飞书」，在浏览器里用你的飞书账号完成授权，然后点「我授权好了，检查一下」。\n" +
          "· 完整模式（地址栏加 ?mode=full 后刷新）：选好能力域后点「🔑 开始登录」，完成后点「📄 飞书登录好了吗」；或在「高级」里点「登录状态」。\n\n" +
          "若仍只有机器人身份，请确认开放平台已为该应用开通所需用户权限，并重新走一遍登录。"
        );
      }
      if (identity === "user" || note.toLowerCase().includes("user logged")) {
        return (
          "✅ 已用个人飞书账号登录，连接状态正常。\n\n" +
          "可以正常使用日历、文档、任务、会议等功能了。"
        );
      }
    }
    return `当前登录状态如下：\n\n${out.slice(0, 1200)}${out.length > 1200 ? "…" : ""}`;
  }
  if (/\bconfig\s+show\b/.test(res.command)) {
    return `当前连接信息读出来了（勿随意截图外传）\n\n${out.slice(0, 1200)}${out.length > 1200 ? "…" : ""}`;
  }
  if (/\b--help\b/.test(res.command)) {
    const lines = out.split("\n");
    return `这是命令的帮助说明 ✓\n\n先瞄一眼前几行：\n${lines.slice(0, 10).join("\n")}${lines.length > 10 ? "\n…" : ""}`;
  }
  const jsonHit = friendlySuccessFromCliOutput(res.command, out);
  if (jsonHit) return jsonHit;
  return "✅ 这一步已完成。\n\n若与预期不符，可在页面底部「执行命令」重跑同一命令核对输出，或联系管理员协助。";
}

function friendlyBatchIntro(title: string, results: CliResult[]): string {
  const ok = results.filter((r) => r.exitCode === 0).length;
  const fail = results.length - ok;
  let vibe = "";
  if (fail === 0) vibe = "全部顺利 ✨ 想继续可以换个小任务试试。";
  else if (ok === 0)
    vibe = "这几步都没过，可展开下方「仅排错时展开」查看具体报错。";
  else vibe = `有 ${fail} 步需要留意，展开下方「仅排错时展开」对照报错即可。`;
  const lines = results.map((r, i) => {
    const mark = r.exitCode === 0 ? "✓" : "✗";
    const short = r.command.replace(/^lark-cli\s+/, "").slice(0, 44);
    return `  ${mark} 步骤 ${i + 1}：${short}${short.length >= 44 ? "…" : ""}`;
  });
  return `「${title}」跑完了：${ok}/${results.length} 步 OK。\n${vibe}\n\n${lines.join("\n")}`;
}

function getDefaultCalendarRange() {
  const start = new Date(Date.now() + 60 * 60 * 1000);
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

// ─── Nav tabs ─────────────────────────────────────────────────────────────────

type TabId =
  | "auth"
  | "meal"
  | "ops"
  | "docHub"
  | "docs"
  | "sheets"
  | "calendar"
  | "tasks"
  | "im"
  | "mail"
  | "vc"
  | "contact"
  | "drive"
  | "smart"
  | "devReport"
  | "tapdBug"
  | "tapdStats"
  | "vote";

/** 默认简洁侧栏：连接飞书、群聊助手、飞书文档助手、开发报告助手 */
const ESSENTIAL_TAB_IDS: TabId[] = [
  "auth",
  "meal",
  "ops",
  "smart",
  "docHub",
  "devReport",
  "tapdBug",
  "tapdStats",
  "vote",
];

const TABS: { id: TabId; label: string; emoji: string }[] = [
  { id: "auth", label: "连接飞书", emoji: "🔑" },
  { id: "meal", label: "餐费票据", emoji: "🧾" },
  { id: "ops", label: "运维", emoji: "🛠" },
  { id: "smart", label: "群聊助手", emoji: "🤖" },
  { id: "docHub", label: "飞书文档助手", emoji: "📚" },
  { id: "devReport", label: "开发报告助手", emoji: "👩‍💻" },
  { id: "tapdBug", label: "TAPD 提 Bug", emoji: "🐛" },
  { id: "tapdStats", label: "TAPD 缺陷统计", emoji: "📊" },
  { id: "vote", label: "飞书投票", emoji: "🗳️" },
  { id: "docs", label: "文档", emoji: "📄" },
  { id: "sheets", label: "表格", emoji: "📊" },
  { id: "calendar", label: "日历", emoji: "📅" },
  { id: "tasks", label: "任务", emoji: "✅" },
  { id: "im", label: "消息", emoji: "💬" },
  { id: "mail", label: "邮件", emoji: "📧" },
  { id: "vc", label: "视频会议", emoji: "🎥" },
  { id: "contact", label: "通讯录", emoji: "👤" },
  { id: "drive", label: "云盘", emoji: "☁️" },
];

// ─── Reusable UI ──────────────────────────────────────────────────────────────

function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`bg-white rounded-2xl border border-gray-100 shadow-sm p-5 ${className}`}
    >
      {children}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
      {children}
    </h3>
  );
}

/** 表单项下方灰色说明，面向不熟悉 CLI/开发概念的用户 */
function FieldHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] text-gray-400 mt-1 leading-relaxed">{children}</p>
  );
}

function humanizeChatApiFailure(status: number, body: string): string {
  const trimmed = body.replace(/\s+/g, " ").trim().slice(0, 320);
  const looksLikeKeyRejected =
    /身份验证失败|invalid.?api|incorrect.?api.?key|invalid_api_key|unauthorized/i.test(
      trimmed,
    );
  const looksLikeKeyMissing =
    (/not found|please configure|未配置|missing.*key|未读到|无法读取|未找到/i.test(
      trimmed,
    ) &&
      /api key|apikey|密钥/i.test(trimmed)) ||
    /ALIBABA_API_KEY|DASHSCOPE_API_KEY/.test(trimmed);

  if (status === 401) {
    if (looksLikeKeyRejected && !looksLikeKeyMissing) {
      return [
        "「智能总结」失败：当前在设置里保存的模型 **API Key 校验未通过**（上游返回「身份验证失败」等）。",
        "请到网站「设置」核对**当前选中的供应商**与密钥是否一致：通义千问支持 `ALIBABA_API_KEY` 或 `DASHSCOPE_API_KEY`（DashScope sk-，二选一）；智谱填 `ZHIPUAI_API_KEY`；OpenRouter 填 `OPENROUTER_API_KEY`；DeepSeek 填 `DEEPSEEK_API_KEY`。保存后再试。",
        trimmed ? `\n\n（原始提示：${trimmed}）` : "",
      ].join("");
    }
    if (looksLikeKeyMissing) {
      return [
        "「智能总结」读不到当前模型的 API Key。",
        "请打开「设置」检查已选供应商，并填写/保存对应密钥（通义可填 `ALIBABA_API_KEY` 或 `DASHSCOPE_API_KEY`）；修改 `backend/.env` 后需**重启后端**。若 Next 与 FastAPI 不在同一环境，请确认 `BACKEND_URL` 指向的后端进程能读到上述变量。",
        trimmed ? `\n\n（原始提示：${trimmed}）` : "",
      ].join("");
    }
    return [
      "「智能总结」现在还不可用：你还没在网站里连上 AI。",
      "请点本页顶部的「去设置里连接智能助手」，打开设置页后按提示选择模型、填好访问密钥并保存（和首页聊天用的是同一处设置）。",
      trimmed ? `\n\n补充说明：${trimmed}` : "",
    ].join("");
  }
  if (status === 429) {
    return "用的人太多啦，请隔几分钟再试一次。";
  }
  if (
    status === 400 &&
    /30720|input length|InvalidParameter|Range of input length/i.test(trimmed)
  ) {
    return [
      "发到模型的内容太长，超过了当前接口允许的单次字数上限。",
      "请缩短群聊时间范围、少选几个群，或减少粘贴的正文后再试；若已选很久的窗口，可先改成「最近 24 小时」试一次。",
      trimmed ? `\n\n（技术明细：${trimmed}）` : "",
    ].join("");
  }
  if (status >= 500) {
    if (looksLikeKeyRejected) {
      return humanizeChatApiFailure(401, body);
    }
    if (/30720|input length|InvalidParameter|Range of input length/i.test(trimmed)) {
      return [
        "发到模型的内容太长，超过了当前接口允许的单次字数上限。",
        "本页已自动截断后再发；若仍失败，请缩短群聊时间范围、少选几个群，或把补充说明写短一些。",
        trimmed ? `\n\n（技术明细：${trimmed}）` : "",
      ].join("");
    }
    return [
      "智能服务刚才没响应，总结中断。",
      "你可以稍后再试；也可以打开首页发一句聊天，看是不是同样发不出去——若是，多半是网络或账号用量问题。",
      trimmed ? `\n\n（给维护人员看的补充：${trimmed}）` : "",
    ].join("");
  }
  return trimmed || "刚才没连上智能服务，请稍后再试。";
}

/** 智谱等网关要求单次请求 messages 总长度约 ≤30720；留余量避免与上游计量方式不一致 */
const CHAT_TURN_COMBINED_CHAR_MAX = 28_000;
const CHAT_TURN_TRUNCATION_FOOTER =
  "\n\n---\n\n（因单次请求字数上限，上文已截断至靠前部分；可缩短时间范围、少选群或分次拉取后再整理。）\n";

function clampChatTurnToCharBudget(
  systemPrompt: string,
  userContent: string,
  maxCombined = CHAT_TURN_COMBINED_CHAR_MAX,
): { system: string; user: string } {
  const s0 = systemPrompt;
  const u0 = userContent;
  if (s0.length + u0.length <= maxCombined) {
    return { system: s0, user: u0 };
  }
  const footer = CHAT_TURN_TRUNCATION_FOOTER;
  const maxUser = Math.max(1, maxCombined - s0.length);
  if (maxUser >= footer.length + 1) {
    const bodyMax = maxUser - footer.length;
    return { system: s0, user: `${u0.slice(0, Math.max(1, bodyMax))}${footer}` };
  }
  const reserve = footer.length + 8;
  const sysCap = Math.max(400, maxCombined - reserve);
  const sys =
    s0.length > sysCap ? `${s0.slice(0, sysCap - 1)}…` : s0.slice(0, sysCap);
  const maxUser2 = Math.max(1, maxCombined - sys.length - footer.length);
  return {
    system: sys,
    user: `${u0.slice(0, Math.max(1, maxUser2))}${footer}`,
  };
}

function Btn({
  children,
  onClick,
  disabled,
  variant = "default",
  size = "md",
  className = "",
  type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "default" | "primary" | "success" | "warning" | "danger" | "ghost";
  size?: "sm" | "md";
  className?: string;
  type?: "button" | "submit";
}) {
  const base =
    "inline-flex items-center gap-1.5 font-medium rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed";
  const sz = size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm";
  const variants: Record<string, string> = {
    default: "bg-gray-100 text-gray-800 hover:bg-gray-200",
    primary: "bg-blue-600 text-white hover:bg-blue-700",
    success: "bg-emerald-600 text-white hover:bg-emerald-700",
    warning: "bg-amber-500 text-white hover:bg-amber-600",
    danger: "bg-red-500 text-white hover:bg-red-600",
    ghost: "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${sz} ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

function Input({
  value,
  onChange,
  placeholder,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:bg-white transition ${className}`}
    />
  );
}

function Textarea({
  value,
  onChange,
  placeholder,
  rows = 4,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:bg-white transition resize-none"
    />
  );
}

function CliOutputDetails({ results }: { results: CliResult[] }) {
  const raw = results.map((r) => formatResultTechnical(r)).join("\n\n────────\n\n");
  return (
    <details className="mt-3 group rounded-xl border border-black/5 bg-white/50 overflow-hidden">
      <summary className="cursor-pointer select-none list-none px-3 py-2 text-xs text-gray-500 hover:text-gray-700 hover:bg-white/80 flex items-center gap-2 [&::-webkit-details-marker]:hidden">
        <span className="inline-block transition-transform group-open:rotate-90 text-[10px] text-gray-400">
          ▸
        </span>
        <span>仅排错时展开 · 原始命令输出</span>
      </summary>
      <pre className="px-3 pb-3 pt-0 text-[11px] leading-snug text-gray-600 whitespace-pre-wrap break-words max-h-72 overflow-y-auto font-mono">
        {raw}
      </pre>
    </details>
  );
}

function MessageBubble({ m }: { m: ChatMessage }) {
  const isUser = m.role === "user";
  const cliList: CliResult[] | null =
    m.cliBatch && m.cliBatch.length
      ? m.cliBatch
      : m.cliResult
        ? [m.cliResult]
        : null;

  if (!isUser && cliList) {
    const anyFail = cliList.some((r) => r.exitCode !== 0);
    const warnTone = m.cliTone === "warn" && !anyFail;
    const showTechnical = anyFail || warnTone;
    return (
      <div className="flex justify-start gap-2.5 items-start">
        <div
          className="w-9 h-9 rounded-2xl bg-gradient-to-br from-violet-500 via-indigo-500 to-sky-500 flex items-center justify-center text-white text-sm shadow-md shadow-indigo-500/25 shrink-0 mt-0.5"
          aria-hidden
        >
          ✨
        </div>
        <div
          className={`max-w-[min(100%,42rem)] rounded-3xl rounded-tl-md px-4 py-3.5 text-sm whitespace-pre-wrap leading-relaxed shadow-sm border ${
            anyFail || warnTone
              ? "bg-gradient-to-br from-amber-50/95 to-orange-50/80 border-amber-100/80 text-amber-950"
              : "bg-gradient-to-br from-emerald-50/90 to-teal-50/70 border-emerald-100/70 text-gray-800"
          }`}
        >
          <p className="text-[13px] leading-relaxed">{m.content}</p>
          {showTechnical ? (
            <CliOutputDetails results={cliList} />
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} gap-2`}>
      {!isUser && (
        <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-slate-400 to-slate-600 flex items-center justify-center text-white text-xs font-semibold shrink-0 mt-0.5 shadow-sm">
          L
        </div>
      )}
      <div
        className={`max-w-[min(100%,42rem)] rounded-3xl px-4 py-3 text-sm whitespace-pre-wrap leading-relaxed transition-shadow ${
          isUser
            ? "bg-gradient-to-br from-blue-500 to-indigo-600 text-white rounded-tr-md shadow-md shadow-blue-500/20"
            : "bg-white/90 border border-gray-100/90 text-gray-800 rounded-tl-md shadow-sm shadow-gray-200/40 backdrop-blur-sm"
        }`}
      >
        {m.content}
        {m.debugFoldText ? (
          <details className="mt-3 group rounded-xl border border-black/5 bg-gray-50/80 overflow-hidden">
            <summary className="cursor-pointer select-none list-none px-3 py-2 text-xs text-gray-500 hover:text-gray-700 hover:bg-white/80 flex items-center gap-2 [&::-webkit-details-marker]:hidden">
              <span className="inline-block transition-transform group-open:rotate-90 text-[10px] text-gray-400">
                ▸
              </span>
              <span>仅排错时展开 · 拉取调试详情</span>
            </summary>
            <pre className="px-3 pb-3 pt-0 text-[11px] leading-snug text-gray-600 whitespace-pre-wrap break-words max-h-72 overflow-y-auto font-mono">
              {m.debugFoldText}
            </pre>
          </details>
        ) : null}
      </div>
    </div>
  );
}

type SmartStatusTone = "idle" | "running" | "ok" | "err";

interface SmartStatusLine {
  tone: SmartStatusTone;
  title: string;
  detail?: string;
}

/** 简洁版智能助手：用一行状态替代大段「对话式」说明 */
function SmartStatusStrip({
  status,
  onDismiss,
}: {
  status: SmartStatusLine;
  onDismiss?: () => void;
}) {
  /** 已连接且无进行中/结果态时不再占一条顶栏（用户反馈「就绪」无信息量） */
  if (status.tone === "idle" && status.title === "就绪") {
    return null;
  }

  const border =
    status.tone === "running"
      ? "border-sky-200/90 bg-sky-50/95"
      : status.tone === "ok"
        ? "border-emerald-200/90 bg-emerald-50/95"
        : status.tone === "err"
          ? "border-rose-200/90 bg-rose-50/95"
          : "border-gray-200/90 bg-gray-50/90";

  return (
    <div
      className={`shrink-0 flex items-center gap-3 px-4 py-2.5 border-b ${border}`}
      role="status"
      aria-live="polite"
    >
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold"
        aria-hidden
      >
        {status.tone === "running" ? (
          <span className="inline-block h-4 w-4 border-2 border-sky-600 border-t-transparent rounded-full animate-spin" />
        ) : status.tone === "ok" ? (
          <span className="text-emerald-700">✓</span>
        ) : status.tone === "err" ? (
          <span className="text-rose-700">!</span>
        ) : (
          <span className="text-gray-400 text-xs font-semibold">●</span>
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-gray-900 leading-tight">
          {status.title}
        </p>
        {status.detail ? (
          <p className="text-[11px] text-gray-600 mt-0.5 leading-snug line-clamp-2">
            {status.detail}
          </p>
        ) : null}
      </div>
      {(status.tone === "ok" || status.tone === "err") && onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 text-xs text-gray-600 hover:text-gray-900 px-2 py-1 rounded-lg hover:bg-white/80 border border-transparent hover:border-gray-200/80"
        >
          知道了
        </button>
      ) : null}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function LarkCliPage() {
  const [activeTab, setActiveTab] = useState<TabId>("smart");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  /** 简洁版：主界面用状态条，不把教程写进对话区 */
  const [smartStatus, setSmartStatus] = useState<SmartStatusLine>({
    tone: "idle",
    title: "未连接飞书",
  });
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const [docsParams, setDocsParams] = useState<DocsParams>({
    docTitle: `CLI文档-${new Date().toISOString().slice(0, 10)}`,
    docToken: "",
  });
  const [sheetsParams, setSheetsParams] = useState<SheetsParams>({
    sheetTitle: `CLI表格-${new Date().toISOString().slice(0, 10)}`,
    sheetUrl: "",
  });
  const [calendarParams, setCalendarParams] = useState<CalendarParams>({
    attendeeIds: "",
    meetingTitle: `CLI会议-${new Date().toISOString().slice(0, 10)}`,
  });
  const [summaryParams, setSummaryParams] = useState<SummaryParams>({
    sourceText: "",
    docTitle: `AI总结-${new Date().toISOString().slice(0, 10)}`,
  });
  const [chatPullParams, setChatPullParams] = useState<ChatPullParams>({
    chatIds: [],
    chatId: "",
    hoursBack: "24",
    timeMode: "preset",
    customRangeStart: "",
    customRangeEnd: "",
    imAs: "user",
    focusKeyword: "",
  });
  const [lastChatSummaryExport, setLastChatSummaryExport] = useState<{
    title: string;
    markdown: string;
  } | null>(null);
  /** 群聊总结预览：导出 Word/PDF 时读取 innerHTML */
  const summaryPreviewExportRef = useRef<HTMLDivElement | null>(null);
  /** 简洁版：发送总结前写入，供 runFlow 内读取（补充说明进 AI 上下文） */
  const chatSummaryUserNoteRef = useRef("");
  const [simpleChatSummaryComposer, setSimpleChatSummaryComposer] =
    useState("");
  const [myChats, setMyChats] = useState<MyChatRow[]>([]);
  const [chatsListLoading, setChatsListLoading] = useState(false);
  const [chatsListError, setChatsListError] = useState("");
  const [docHubKeyword, setDocHubKeyword] = useState("");
  const [docHubLoading, setDocHubLoading] = useState(false);
  const [docHubError, setDocHubError] = useState("");
  const [docHubGroups, setDocHubGroups] = useState<
    { label: string; rows: DocHubRow[] }[]
  >([]);
  const [docHubTotal, setDocHubTotal] = useState(0);
  const [docHubHint, setDocHubHint] = useState("");
  const [taskParams, setTaskParams] = useState<TaskParams>({
    summary: "跟进 Lark CLI 自动化测试",
    description: "确认各功能链路均正常",
    due: "+2d",
    reminder: "1h",
  });
  const [imParams, setImParams] = useState<ImParams>({
    chatId: "",
    message: "【自动通知】Lark CLI 助手测试消息",
  });
  const [mailParams, setMailParams] = useState<MailParams>({
    to: "",
    subject: "Lark CLI 助手自动邮件",
    body: "这是由 Lark CLI 助手自动生成的测试邮件。",
  });
  const [vcParams, setVcParams] = useState<VcParams>({ query: "" });
  const [contactParams, setContactParams] = useState<ContactParams>({
    query: "",
  });
  const [driveParams, setDriveParams] = useState<DriveParams>({ filePath: "" });
  const [authParams, setAuthParams] = useState<AuthParams>({
    loginScope: "",
    loginDomain: DEFAULT_SIMPLE_LOGIN_DOMAINS,
  });
  const [authTerminal, setAuthTerminal] = useState<
    { type: string; text: string }[]
  >([]);
  const [authRunning, setAuthRunning] = useState(false);
  const [authUrls, setAuthUrls] = useState<string[]>([]);
  /** window.open 被拦截时提示手动点链接 */
  const [authPopupBlocked, setAuthPopupBlocked] = useState(false);
  /** 已打开飞书授权页，轮询 auth status 直到个人登录完成 */
  const [authAwaitingBrowser, setAuthAwaitingBrowser] = useState(false);
  /** 检测到个人飞书已登录，短暂绿色提示条 */
  const [authJustSucceeded, setAuthJustSucceeded] = useState(false);
  /** 个人飞书已连接（持久展示：顶栏、步骤①） */
  const [authPersonalConnected, setAuthPersonalConnected] = useState(false);
  /** 已应用过「连接成功」逻辑，避免重复弹消息（重新点登录时会重置） */
  const feishuHandledRef = useRef(false);
  /** 刚完成 OAuth 登录时，自动拉取多日日程/任务/会议 */
  const pendingOAuthAutoFetchRef = useRef(false);
  /**
   * URL `?mode=full`：展开侧栏全部模块 + 智能助手里的高级卡片 + 底部命令行。
   * 默认（无参数）：仅「连接飞书 / 智能助手」与「总结建文档」一张卡片。
   */
  const [fullWorkbenchMode, setFullWorkbenchMode] = useState(false);
  const fullWorkbenchModeRef = useRef(false);
  const [meetingTodosParams, setMeetingTodosParams] =
    useState<MeetingTodosParams>({
      vcStart: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10),
      vcEnd: new Date().toISOString().slice(0, 10),
      assigneeId: "",
    });
  const [weeklyReportParams, setWeeklyReportParams] =
    useState<WeeklyReportParams>({
      sendChatId: "",
      docTitle: `周报-${new Date().toISOString().slice(0, 10)}`,
    });
  const [deadlineAlertParams, setDeadlineAlertParams] =
    useState<DeadlineAlertParams>({ alertChatId: "", hoursAhead: "48" });
  const [schedulingParams, setSchedulingParams] = useState<SchedulingParams>({
    attendeeNames: "",
    durationMin: "30",
    windowStart: new Date().toISOString().slice(0, 10),
    windowEnd: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10),
  });

  const visibleTabs = useMemo(
    () =>
      fullWorkbenchMode
        ? TABS
        : TABS.filter((t) => ESSENTIAL_TAB_IDS.includes(t.id)),
    [fullWorkbenchMode],
  );

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_WORKBENCH_CHAT_PULL);
      if (!raw) return;
      const j = JSON.parse(raw) as Partial<ChatPullParams> & {
        chatIds?: unknown;
      };
      setChatPullParams((p) => {
        const listIds = Array.isArray(j.chatIds)
          ? j.chatIds.filter((x): x is string => typeof x === "string")
          : [];
        const legacyId = typeof j.chatId === "string" ? j.chatId.trim() : "";
        const chatIds =
          listIds.length > 0
            ? [...new Set(listIds.map((x) => x.trim()).filter(Boolean))]
            : legacyId
              ? [legacyId]
              : p.chatIds;
        return {
          ...p,
          chatIds,
          chatId: typeof j.chatId === "string" ? j.chatId : p.chatId,
          hoursBack:
            typeof j.hoursBack === "string" && j.hoursBack
              ? j.hoursBack
              : p.hoursBack,
          timeMode:
            j.timeMode === "custom" || j.timeMode === "preset"
              ? j.timeMode
              : p.timeMode,
          customRangeStart:
            typeof j.customRangeStart === "string"
              ? j.customRangeStart
              : p.customRangeStart,
          customRangeEnd:
            typeof j.customRangeEnd === "string"
              ? j.customRangeEnd
              : p.customRangeEnd,
          imAs: j.imAs === "bot" ? "bot" : "user",
          focusKeyword:
            typeof j.focusKeyword === "string" ? j.focusKeyword : p.focusKeyword,
        };
      });
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const full = params.get("mode") === "full";
      const tabParam = params.get("tab");
      setFullWorkbenchMode(full);
      fullWorkbenchModeRef.current = full;
      if (tabParam === "meal") {
        setActiveTab("meal");
      } else if (tabParam === "ops") {
        setActiveTab("ops");
      } else if (!full) {
        setActiveTab((t) => (ESSENTIAL_TAB_IDS.includes(t) ? t : "smart"));
      }

      if (!full) {
        // 简洁版不再提供「关键词 / 手动 oc_」表单，避免无界面却沿用旧筛选
        setChatPullParams((p) => ({
          ...p,
          focusKeyword: "",
          chatId: "",
        }));
        return;
      }
      setMessages([
        {
          id: "welcome",
          role: "assistant",
          content:
            "👋 已开启「完整功能」：左侧可见文档、表格、日历、任务等全部模块；智能助手内可展开会议/周报等卡片；底部可输入命令行。\n\n" +
            "若只想总结建文档，把地址栏里的 `?mode=full` 去掉后刷新即可恢复简洁版。",
        },
      ]);
    } catch {
      /* noop */
    }
  }, []);

  // ── Execution helpers ──────────────────────────────────────────────────────

  const appendMessage = useCallback(
    (
      role: Role,
      content: string,
      extra?: {
        cli?: CliResult;
        cliBatch?: CliResult[];
        cliTone?: "warn";
        debugFoldText?: string;
      },
    ) => {
      setMessages((prev) => [
        ...prev,
        {
          id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          role,
          content,
          cliResult: extra?.cli,
          cliBatch: extra?.cliBatch,
          cliTone: extra?.cliTone,
          debugFoldText: extra?.debugFoldText,
        },
      ]);
    },
    [],
  );

  const setSmartLine = useCallback(
    (tone: SmartStatusTone, title: string, detail?: string) => {
      if (fullWorkbenchModeRef.current) return;
      setSmartStatus({ tone, title, detail });
    },
    [],
  );

  const dismissSmartStatus = useCallback(() => {
    if (fullWorkbenchModeRef.current) return;
    setSmartStatus({
      tone: "idle",
      title: authPersonalConnected ? "就绪" : "未连接飞书",
      detail: undefined,
    });
  }, [authPersonalConnected]);

  const handleExportSummaryPdf = useCallback(async () => {
    if (!lastChatSummaryExport) return;
    const el = summaryPreviewExportRef.current;
    if (!el) {
      window.alert("预览区域尚未就绪，请稍后重试。");
      return;
    }
    try {
      await exportHtmlToPdf(
        el,
        `${safeDownloadBasename(lastChatSummaryExport.title)}.pdf`,
        { documentTitle: lastChatSummaryExport.title },
      );
    } catch (e) {
      console.error(e);
      window.alert("导出 PDF 失败，请重试。");
    }
  }, [lastChatSummaryExport]);

  const handleExportSummaryWord = useCallback(async () => {
    if (!lastChatSummaryExport) return;
    const el = summaryPreviewExportRef.current;
    if (!el) {
      window.alert("预览区域尚未就绪，请稍后重试。");
      return;
    }
    try {
      await exportHtmlToDocx(el.innerHTML, {
        title: lastChatSummaryExport.title,
        filename: `${safeDownloadBasename(lastChatSummaryExport.title)}.docx`,
      });
    } catch (e) {
      console.error(e);
      window.alert(
        "导出 Word 失败，请重试。若内容含复杂表格，可先试导出 PDF。",
      );
    }
  }, [lastChatSummaryExport]);

  useEffect(() => {
    if (fullWorkbenchMode) return;
    setSmartStatus((s) => {
      if (s.tone === "running" || s.tone === "ok" || s.tone === "err") return s;
      return {
        tone: "idle",
        title: authPersonalConnected ? "就绪" : "未连接飞书",
        detail: undefined,
      };
    });
  }, [authPersonalConnected, fullWorkbenchMode]);

  /**
   * 检测到个人飞书已就绪：更新顶栏/步骤状态；可选一句对话提示。
   * announceChat=false：进页时已登录，不刷对话。
   */
  const applyFeishuPersonalConnected = useCallback(
    (announceChat: boolean) => {
      if (feishuHandledRef.current) return;
      feishuHandledRef.current = true;
      setAuthPersonalConnected(true);
      setAuthAwaitingBrowser(false);
      setAuthJustSucceeded(true);
      window.setTimeout(() => setAuthJustSucceeded(false), 8000);
      if (!fullWorkbenchModeRef.current) {
        setSmartLine("idle", "就绪");
      }
      if (announceChat) {
        if (fullWorkbenchModeRef.current) {
          pendingOAuthAutoFetchRef.current = true;
        }
        setAuthTerminal((prev) => [
          ...prev,
          { type: "info", text: "\n✓ 飞书已连接。\n" },
        ]);
        if (fullWorkbenchModeRef.current) {
          setMessages((prev) => [
            ...prev,
            {
              id: `assistant-feishu-ok-${Date.now()}`,
              role: "assistant",
              content:
                "飞书已连接好。下面会自动拉取近一段时间的日程、任务和会议，无需再点别的。",
            },
          ]);
        }
      }
    },
    [setSmartLine],
  );

  const probeLarkAuthStatus = useCallback(async (): Promise<CliResult | null> => {
    try {
      const res = await fetch("/api/lark-cli", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: "lark-cli auth status",
          timeoutMs: 20000,
        }),
      });
      const data = (await res.json()) as CliResponse;
      const r = data.result;
      if (!r) return null;
      return {
        command: r.command || "lark-cli auth status",
        exitCode: r.exitCode,
        stdout: r.stdout ?? "",
        stderr: r.stderr ?? "",
        durationMs: r.durationMs ?? 0,
      };
    } catch {
      return null;
    }
  }, []);

  /** 手动刷新连接状态（仍连不上时再展开技术明细） */
  const manualRecheckFeishuAuth = useCallback(async () => {
    const st = await probeLarkAuthStatus();
    if (!st) {
      if (!fullWorkbenchModeRef.current) {
        setSmartLine(
          "err",
          "检测失败",
          "请确认已用项目脚本启动网站，且本机已安装飞书命令行工具",
        );
      } else {
        appendMessage(
          "assistant",
          "暂时检测不到本机飞书工具。请确认网站已用项目自带脚本启动，且本机已安装飞书命令行工具。",
        );
      }
      return;
    }
    if (authPersonalReady(st)) {
      applyFeishuPersonalConnected(true);
      return;
    }
    if (!fullWorkbenchModeRef.current) {
      setSmartLine(
        "err",
        "未检测到个人飞书登录",
        friendlyCliSummary(st).slice(0, 200),
      );
    } else {
      appendMessage(
        "assistant",
        "目前还没有检测到你的飞书个人账号。请在「连接飞书」里再完成一次登录授权；若已点过，请确认是用 `./start_local.sh` 启动的网站（与终端用的是同一条飞书工具）。\n\n" +
          friendlyCliSummary(st),
        { cli: st, cliTone: authStatusNeedsUserLogin(st) ? "warn" : undefined },
      );
    }
  }, [probeLarkAuthStatus, applyFeishuPersonalConnected, appendMessage, setSmartLine]);

  const executeSingle = useCallback(
    async (command: string, timeoutMs = 25000): Promise<CliResult> => {
      const res = await fetch("/api/lark-cli", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command, timeoutMs }),
      });
      const data = (await res.json()) as CliResponse;
      if (!res.ok || !data.result)
        throw new Error(data.error || `HTTP ${res.status}`);
      return data.result;
    },
    [],
  );

  const executeDocsCreate = useCallback(
    async (
      title: string,
      markdown: string,
      timeoutMs = 90000,
    ): Promise<CliResult> => {
      const res = await fetch("/api/lark-cli", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          docsCreate: { title, markdown },
          timeoutMs,
        }),
      });
      const data = (await res.json()) as CliResponse;
      if (!res.ok || !data.result)
        throw new Error(data.error || `HTTP ${res.status}`);
      return data.result;
    },
    [],
  );

  const executeBatch = useCallback(
    async (commands: string[], timeoutMs = 25000): Promise<CliResult[]> => {
      const res = await fetch("/api/lark-cli", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commands, timeoutMs }),
      });
      const data = (await res.json()) as CliResponse;
      if (!res.ok || !data.results)
        throw new Error(data.error || `HTTP ${res.status}`);
      return data.results;
    },
    [],
  );

  const loadDocHub = useCallback(async () => {
    if (!authPersonalConnected) {
      setDocHubError("请先在本页完成「连接飞书」。");
      return;
    }
    setDocHubLoading(true);
    setDocHubError("");
    setDocHubHint("");
    setDocHubGroups([]);
    setDocHubTotal(0);
    try {
      const q = docHubKeyword.trim();
      const queryArg = q.length ? q : " ";
      const maxPages = 18;
      const merged = new Map<string, DocHubRow>();
      let pageToken = "";
      for (let page = 0; page < maxPages; page++) {
        const tokenPart = pageToken
          ? ` --page-token "${quoteCliArg(pageToken)}"`
          : "";
        const cmd =
          `lark-cli docs +search --as user --query "${quoteCliArg(queryArg)}" --page-size 20 --format json${tokenPart}`;
        const r = await executeSingle(cmd, 90000);
        if (r.exitCode !== 0) {
          throw new Error(friendlyCliSummary(r));
        }
        const parsed = tryParseJsonObject(r.stdout);
        if (!parsed) {
          throw new Error("无法解析搜索结果 JSON，请升级本机 lark-cli 后重试。");
        }
        const rawItems = docsSearchItemsFromPayload(parsed);
        for (let i = 0; i < rawItems.length; i++) {
          const it = rawItems[i];
          if (!it || typeof it !== "object") continue;
          const row = normalizeDocHubRow(
            it as Record<string, unknown>,
            merged.size + i,
          );
          if (!row) continue;
          merged.set(row.key, row);
        }
        const { hasMore, pageToken: next } = docsSearchPageMeta(parsed);
        if (!hasMore || !next || rawItems.length === 0) break;
        pageToken = next;
      }
      const rows = [...merged.values()];
      setDocHubTotal(rows.length);
      setDocHubGroups(groupDocHubRows(rows));
      if (rows.length === 0) {
        setDocHubHint(
          "没有拉到文档：可换一个关键词后再试；并确认飞书应用已开通云文档搜索相关权限。",
        );
      }
    } catch (e) {
      setDocHubGroups([]);
      setDocHubTotal(0);
      setDocHubHint("");
      setDocHubError(e instanceof Error ? e.message : String(e));
    } finally {
      setDocHubLoading(false);
    }
  }, [authPersonalConnected, docHubKeyword, executeSingle]);

  const loadMyChats = useCallback(
    async (opts?: { silent?: boolean }) => {
      setChatsListLoading(true);
      setChatsListError("");
      const asWho = chatPullParams.imAs === "bot" ? "bot" : "user";
      try {
        const r = await executeSingle(
          `lark-cli im chats list --as ${asWho} --format json --page-all --page-limit 25`,
          90000,
        );
        if (r.exitCode !== 0) {
          setMyChats([]);
          const msg = friendlyCliSummary(r);
          setChatsListError(msg);
          if (!opts?.silent) {
            if (!fullWorkbenchModeRef.current) {
              setSmartLine("err", "群列表拉取失败", msg.slice(0, 220));
            } else {
              appendMessage(
                "assistant",
                asWho === "bot"
                  ? `获取「机器人所在群」列表失败（请确认应用机器人、开放平台权限与可用范围）：\n\n${msg}`
                  : `获取群列表失败（需已登录飞书且具备读会话列表等 IM 权限）：\n\n${msg}`,
                { cli: r },
              );
            }
          }
          return;
        }
        const parsed = tryParseJsonObject(r.stdout);
        if (!parsed) {
          setMyChats([]);
          setChatsListError("无法解析群列表 JSON");
          if (!opts?.silent) {
            if (!fullWorkbenchModeRef.current) {
              setSmartLine("err", "群列表异常", "请升级本机 lark-cli 后重试");
            } else {
              appendMessage(
                "assistant",
                "群列表返回异常，请升级本机 lark-cli 后点「刷新群列表」。",
              );
            }
          }
          return;
        }
        const rows = parseImChatsListJson(parsed);
        setMyChats(rows);
        setChatsListError("");
        if (!opts?.silent) {
          if (rows.length === 0) {
            if (!fullWorkbenchModeRef.current) {
              setSmartLine(
                "err",
                "没有可用群",
                asWho === "bot"
                  ? "请确认机器人已在目标群且具备读会话权限，或展开「高级」手动填 oc_"
                  : "可展开「高级」手动填 oc_，或到「连接飞书」补权限",
              );
            } else {
              appendMessage(
                "assistant",
                asWho === "bot"
                  ? "机器人侧未拉到群/会话（请确认机器人已加入目标群，且具备机器人读会话/消息等权限）。可用手动填写 chat_id 再试。"
                  : "当前账号下没有拉到群/会话列表（可能是权限范围为空）。可展开下方「手动填写」尝试直接填 oc_。",
              );
            }
          } else if (fullWorkbenchModeRef.current) {
            appendMessage(
              "assistant",
              asWho === "bot"
                ? `已同步机器人可见的 ${rows.length} 个群/会话，在下拉框里选一个即可拉消息并总结。`
                : `已从飞书同步 ${rows.length} 个群/会话，在下拉框里选一个即可拉消息并总结。`,
            );
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setChatsListError(msg);
        setMyChats([]);
        if (!opts?.silent) {
          if (!fullWorkbenchModeRef.current) {
            setSmartLine("err", "群列表出错", msg.slice(0, 200));
          } else {
            appendMessage("assistant", `获取群列表出错：${msg}`);
          }
        }
      } finally {
        setChatsListLoading(false);
      }
    },
    [appendMessage, executeSingle, chatPullParams.imAs, setSmartLine],
  );

  const loadMyChatsRef = useRef(loadMyChats);
  loadMyChatsRef.current = loadMyChats;

  useEffect(() => {
    if (!authPersonalConnected) {
      setMyChats([]);
      setChatsListError("");
    }
  }, [authPersonalConnected]);

  /** 勿把 loadMyChats 放进依赖：其引用若不稳定会触发无限同步 /api/lark-cli */
  useEffect(() => {
    if (!authPersonalConnected || activeTab !== "smart") return;
    void loadMyChatsRef.current({ silent: true });
  }, [activeTab, authPersonalConnected, chatPullParams.imAs]);

  /** 顶部「检测本机」：不往输入框塞命令，直接出结果 */
  const quickSelfCheckTools = async () => {
    if (loading) return;
    setActiveTab("smart");
    setLoading(true);
    try {
      const result = await executeSingle("lark-cli --version", 20000);
      appendMessage(
        "assistant",
        "帮你测过了，本机和飞书对接的小程序情况如下：\n\n" +
          friendlyCliSummary(result),
        { cli: result },
      );
    } catch {
      appendMessage(
        "assistant",
        "本机「飞书对接工具」没有响应。常见情况是：网站后台没开、或电脑里还没装好配套程序。\n\n请优先确认项目已按说明一键启动；仍不行把本页「技术明细」里的内容复制给维护同事。",
      );
    } finally {
      setLoading(false);
    }
  };

  /** 浏览器里完成飞书授权后，加快轮询；切回本页立刻再查 */
  useEffect(() => {
    if (!authAwaitingBrowser) return;
    let cancelled = false;
    let tickCount = 0;
    const maxTicks = 260;

    const pollOnce = async () => {
      if (cancelled || feishuHandledRef.current) return;
      const st = await probeLarkAuthStatus();
      if (!st || st.exitCode !== 0) return;
      if (authPersonalReady(st)) applyFeishuPersonalConnected(true);
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") void pollOnce();
    };

    void pollOnce();
    const iv = window.setInterval(async () => {
      tickCount += 1;
      if (tickCount >= maxTicks) {
        window.clearInterval(iv);
        if (!feishuHandledRef.current) setAuthAwaitingBrowser(false);
        return;
      }
      await pollOnce();
    }, 1500);

    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(iv);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [authAwaitingBrowser, applyFeishuPersonalConnected, probeLarkAuthStatus]);

  /** 未显示已连接时，后台自动探测（授权完切回本页无需再点任何按钮） */
  useEffect(() => {
    if (authPersonalConnected) return;
    let cancelled = false;
    let ticks = 0;
    const maxTicks = 100;

    const tick = async () => {
      if (cancelled || feishuHandledRef.current || ticks >= maxTicks) return;
      if (document.visibilityState !== "visible") return;
      ticks += 1;
      const st = await probeLarkAuthStatus();
      if (!st || st.exitCode !== 0) return;
      if (authPersonalReady(st)) applyFeishuPersonalConnected(true);
    };

    const iv = window.setInterval(() => void tick(), 3000);
    void tick();
    const onVis = () => {
      if (document.visibilityState === "visible") void tick();
    };
    window.addEventListener("focus", onVis);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      window.clearInterval(iv);
      window.removeEventListener("focus", onVis);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [authPersonalConnected, probeLarkAuthStatus, applyFeishuPersonalConnected]);

  /** 进页时若已登录过，直接显示「已连接」、不刷对话 */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const st = await probeLarkAuthStatus();
      if (cancelled || !st || st.exitCode !== 0) return;
      if (authPersonalReady(st)) applyFeishuPersonalConnected(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [probeLarkAuthStatus, applyFeishuPersonalConnected]);

  const runFlow = async (title: string, fn: () => Promise<void>) => {
    if (loading) return;
    const simple = !fullWorkbenchModeRef.current;
    setLoading(true);
    if (!simple) {
      appendMessage("user", title);
    }
    try {
      await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (simple) {
        setSmartLine("err", "失败", msg.slice(0, 220));
      } else {
        appendMessage(
          "assistant",
          `❌ 这次没跑完：${msg}\n\n💡 建议：先点页面顶部「连接飞书」；若用的是总结/周报，再点「去设置里连接智能助手」。仍不行可让同事看折叠里的技术明细。`,
        );
      }
    } finally {
      setLoading(false);
    }
  };

  const runBatch = async (title: string, commands: string[]) => {
    if (hasPlaceholder(commands)) {
      appendMessage("assistant", `⚠️ 请先补全 ${title} 所需参数。`);
      return;
    }
    await runFlow(title, async () => {
      const results = await executeBatch(commands);
      const ok = results.filter((r) => r.exitCode === 0).length;
      const failed = results.filter((r) => r.exitCode !== 0);
      appendMessage("assistant", friendlyBatchIntro(title, results), {
        cliBatch: results,
      });
    });
  };

  /**
   * 按自然日窗口拉取：日历日程 + 会议记录 + 任务（含截止日在窗口内及未来 120 天内的待办）
   */
  const runRecentLarkDataPull = (daysBack: number, title: string) =>
    runFlow(title, async () => {
      const now = new Date();
      const start = new Date(now);
      start.setDate(start.getDate() - daysBack);
      start.setHours(0, 0, 0, 0);
      const end = new Date(now);
      end.setHours(23, 59, 59, 999);
      const startDate = start.toISOString().slice(0, 10);
      const endDate = end.toISOString().slice(0, 10);
      const taskDueEnd = new Date(now.getTime() + 120 * 86400000)
        .toISOString()
        .slice(0, 10);
      appendMessage(
        "assistant",
        `正在拉取 **${startDate}** 至 **${endDate}** 的日程与会议；任务会包含这段截止范围内及后续待办。`,
      );
      const results = await executeBatch(
        [
          `lark-cli calendar +agenda --as user --start "${start.toISOString()}" --end "${end.toISOString()}" --format table`,
          `lark-cli task +get-my-tasks --as user --due-start "${startDate}" --due-end "${taskDueEnd}" --format table`,
          `lark-cli vc +search --as user --start "${startDate}" --end "${endDate}" --format table`,
        ],
        90000,
      );
      appendMessage("assistant", friendlyBatchIntro(title, results), {
        cliBatch: results,
      });
    });

  const runRecentLarkDataPullRef = useRef(runRecentLarkDataPull);
  runRecentLarkDataPullRef.current = runRecentLarkDataPull;

  useEffect(() => {
    if (!authPersonalConnected || !pendingOAuthAutoFetchRef.current) return;
    pendingOAuthAutoFetchRef.current = false;
    const id = window.setTimeout(() => {
      runRecentLarkDataPullRef.current(
        30,
        "📥 已连接，自动同步近 30 天数据",
      );
    }, 800);
    return () => window.clearTimeout(id);
  }, [authPersonalConnected]);

  const askAI = async (
    systemPrompt: string,
    userContent: string,
  ): Promise<string> => {
    const { system, user } = clampChatTurnToCharBudget(
      systemPrompt,
      userContent,
    );
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stream: false,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
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
      // 兼容旧代理返回纯文本正文
      content = raw;
    }
    if (res.ok) {
      const trimmed = (content ?? "").trim();
      if (!trimmed) {
        throw new Error(
          "模型未返回正文，请检查「设置 → 模型」中的 API Key 与供应商是否可用后重试。",
        );
      }
      return trimmed;
    }
    throw new Error(
      humanizeChatApiFailure(res.status, apiError ?? content ?? raw),
    );
  };

  const runCommand = async (command: string) => {
    const trimmed = command.trim();
    if (!trimmed || loading) return;
    appendMessage("user", trimmed);
    setInput("");
    setLoading(true);
    try {
      const result = await executeSingle(trimmed, 20000);
      appendMessage("assistant", friendlyCliSummary(result), {
        cli: result,
        cliTone: authStatusNeedsUserLogin(result) ? "warn" : undefined,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const low = msg.toLowerCase();
      let tip = msg;
      if (low.includes("fetch") || low.includes("network") || low.includes("load failed")) {
        tip =
          "网页连不上后面的服务。请确认已用项目提供的方式同时启动「前台网页」和「后台程序」，再刷新本页重试。";
      } else if (/^HTTP\s*\d/i.test(msg) || /\b50[023]\b/.test(msg)) {
        tip = "后台暂时忙不过来，请稍后再试，或让维护同事看一下服务是否在运行。";
      }
      appendMessage("assistant", `❌ ${tip}`);
    } finally {
      setLoading(false);
    }
  };

  // ── Smart flows ────────────────────────────────────────────────────────────

  const runMeetingToTodos = () =>
    runFlow("🤖 会议纪要 → 自动拆解待办", async () => {
      const { vcStart, vcEnd, assigneeId } = meetingTodosParams;
      if (!vcStart || !vcEnd) {
        appendMessage("assistant", "⚠️ 请填写会议时间范围。");
        return;
      }
      appendMessage("assistant", "🔍 正在检索最近会议记录……");
      const searchResult = await executeSingle(
        `lark-cli vc +search --start "${vcStart}" --end "${vcEnd}" --format json`,
        30000,
      );
      if (searchResult.exitCode !== 0) {
        appendMessage(
          "assistant",
          `会议记录这一步没拉到，可能是这段时间没有会议，或需要先完成飞书授权。\n\n${friendlyCliSummary(searchResult)}`,
          { cli: searchResult },
        );
        return;
      }
      appendMessage("assistant", "📋 正在获取会议纪要……");
      const notesResult = await executeSingle(
        "lark-cli vc +notes --as user --format pretty",
        30000,
      );
      const rawContent = [searchResult.stdout, notesResult.stdout].join("\n\n");
      appendMessage("assistant", "正在从会议内容里摘待办事项，请稍等…");
      const aiOutput = await askAI(
        "你是一个项目助理。请从下面的会议记录/纪要中提取所有 Action Items，每条格式为：「【负责人】任务描述（截止日期建议）」，没有负责人信息则省略。用 Markdown 列表输出，条目要精炼可执行。",
        rawContent,
      );
      appendMessage("assistant", `✅ 待办清单整理好了：\n\n${aiOutput}`);
      if (assigneeId.trim()) {
        const lines = aiOutput
          .split("\n")
          .filter((l) => l.match(/^[-*]\s+/))
          .slice(0, 5);
        if (lines.length > 0) {
          appendMessage(
            "assistant",
            `📝 正在自动创建 ${lines.length} 个任务……`,
          );
          for (const line of lines) {
            const taskTitle = line
              .replace(/^[-*]\s+/, "")
              .trim()
              .slice(0, 80);
            await executeSingle(
              `lark-cli task +create --summary "${quoteCliArg(taskTitle)}" --due "+7d" --format json`,
              20000,
            );
          }
          appendMessage(
            "assistant",
            `✅ 已自动创建 ${lines.length} 个任务到飞书任务中。`,
          );
        }
      }
    });

  const runWeeklyReport = () =>
    runFlow("🤖 一键生成工作报告", async () => {
      const now = new Date();
      const rangeStart = new Date(now);
      rangeStart.setDate(now.getDate() - 30);
      rangeStart.setHours(0, 0, 0, 0);
      const start = rangeStart.toISOString();
      const end = now.toISOString();
      const startDate = rangeStart.toISOString().slice(0, 10);
      const endDate = now.toISOString().slice(0, 10);
      const taskDueEnd = new Date(now.getTime() + 120 * 86400000)
        .toISOString()
        .slice(0, 10);
      appendMessage(
        "assistant",
        "📥 正在收集近 30 天数据（日程 + 任务 + 会议）……",
      );
      const [agendaRes, taskRes, vcRes] = await executeBatch(
        [
          `lark-cli calendar +agenda --as user --start "${start}" --end "${end}" --format table`,
          `lark-cli task +get-my-tasks --as user --due-start "${startDate}" --due-end "${taskDueEnd}" --format table`,
          `lark-cli vc +search --as user --start "${startDate}" --end "${endDate}" --format table`,
        ],
        90000,
      );
      const rawContent = [
        "## 近 30 日日程\n" + (agendaRes.stdout || "（无）"),
        "## 任务与待办（含后续）\n" + (taskRes.stdout || "（无）"),
        "## 近 30 日会议\n" + (vcRes.stdout || "（无）"),
      ].join("\n\n");
      appendMessage(
        "assistant",
        "正在根据这段时间的日程、任务和会议写周报草稿，请稍等…",
      );
      const report = await askAI(
        "你是企业效率助手。请将以下近一个月左右的工作数据整理成结构化 Markdown 周报，包含：主要完成事项、参与会议、进行中的工作、后续重点（结合任务截止日期）。语言简洁专业。",
        rawContent,
      );
      appendMessage("assistant", `📊 周报草稿：\n\n${report}`);
      const { docTitle } = weeklyReportParams;
      appendMessage("assistant", `📄 正在创建文档《${docTitle}》……`);
      const createRes = await executeDocsCreate(docTitle, report, 90000);
      appendMessage(
        "assistant",
        `文档已经在飞书里建好了 ✨\n\n${friendlyCliSummary(createRes)}`,
        { cli: createRes },
      );
      const { sendChatId } = weeklyReportParams;
      if (sendChatId.trim()) {
        appendMessage("assistant", "正在往你填的群里发一条摘要…");
        const preview =
          report.slice(0, 300) +
          (report.length > 300 ? "\n……（查看完整文档）" : "");
        await executeSingle(
          `lark-cli im +messages-send --as bot --chat-id "${quoteCliArg(sendChatId)}" --text "${quoteCliArg(`【周报】${docTitle}\n\n${preview}`)}"`,
          20000,
        );
        appendMessage("assistant", "✅ 已发送到群聊。");
      }
    });

  const runDeadlineAlert = () =>
    runFlow("🤖 任务截止预警播报", async () => {
      const now = new Date();
      const ahead = parseInt(deadlineAlertParams.hoursAhead || "48", 10);
      const deadline = new Date(now.getTime() + ahead * 60 * 60 * 1000);
      const dueStart = now.toISOString().slice(0, 10);
      const dueEnd = deadline.toISOString().slice(0, 10);
      appendMessage("assistant", `🔍 正在扫描未来 ${ahead}h 即将到期的任务……`);
      const result = await executeSingle(
        `lark-cli task +get-my-tasks --due-start "${dueStart}" --due-end "${dueEnd}" --format table`,
        20000,
      );
      if (!result.stdout.trim() || result.exitCode !== 0) {
        appendMessage("assistant", `😊 未来 ${ahead}h 内没有即将到期的任务！`);
        return;
      }
      const aiOutput = await askAI(
        "你是项目管理助理。请将以下任务列表按优先级（截止时间近优先）整理成飞书 IM 友好的消息格式，每行一个任务，用 emoji 标注紧迫度（🔴紧急/🟡注意/🟢宽松），语言简洁。",
        result.stdout,
      );
      const alertMsg = `⏰ 任务截止预警（未来${ahead}h）\n\n${aiOutput}`;
      appendMessage("assistant", `播报内容预览：\n\n${alertMsg}`);
      const { alertChatId } = deadlineAlertParams;
      if (alertChatId.trim()) {
        await executeSingle(
          `lark-cli im +messages-send --as bot --chat-id "${quoteCliArg(alertChatId)}" --text "${quoteCliArg(alertMsg)}"`,
          20000,
        );
        appendMessage("assistant", "✅ 预警消息已发送到群聊。");
      } else {
        appendMessage(
          "assistant",
          "ℹ️ 若在周报卡片里填了「要自动发到群里」，这里会自动推送；没填就只生成文档。",
        );
      }
    });

  const runSchedulingAssistant = () =>
    runFlow("🤖 排期协调助手", async () => {
      const { attendeeNames, durationMin, windowStart, windowEnd } =
        schedulingParams;
      if (!attendeeNames.trim()) {
        appendMessage("assistant", "⚠️ 请填写参与人姓名（逗号分隔）。");
        return;
      }
      const names = attendeeNames
        .split(",")
        .map((n) => n.trim())
        .filter(Boolean);
      appendMessage(
        "assistant",
        `🔍 正在搜索 ${names.join("、")} 的联系人信息……`,
      );
      const searchResults = await executeBatch(
        names.map(
          (n) =>
            `lark-cli contact +search-user --query "${quoteCliArg(n)}" --format json`,
        ),
        20000,
      );
      const openIds: string[] = [];
      for (const r of searchResults) {
        const m = r.stdout.match(/"open_id"\s*:\s*"(ou_[^"]+)"/);
        if (m?.[1]) openIds.push(m[1]);
      }
      if (openIds.length === 0) {
        appendMessage(
          "assistant",
          "❌ 没有搜到这几位同事的飞书账号。请检查姓名是否完整、是否与通讯录一致（可先去左侧「通讯录」试搜）。",
        );
        return;
      }
      appendMessage(
        "assistant",
        `✅ 找到 ${openIds.length} 位联系人，正在查询忙闲状态……`,
      );
      const startISO = `${windowStart}T09:00:00+08:00`;
      const endISO = `${windowEnd}T18:00:00+08:00`;
      const freebusyRes = await executeSingle(
        `lark-cli calendar +freebusy --user-ids "${openIds.join(",")}" --start "${startISO}" --end "${endISO}" --format pretty`,
        20000,
      );
      appendMessage(
        "assistant",
        "📅 大家的空闲时间查好了，正在帮你挑几个合适的开会时段…",
      );
      const suggestion = await askAI(
        `你是排期助理。请根据以下忙闲信息，推荐 3 个适合 ${durationMin} 分钟会议的时间段（工作时间内），格式：\n- 选项A：YYYY-MM-DD HH:mm～HH:mm（冲突分析）\n- 选项B：...\n- 选项C：...`,
        `参与人: ${names.join("、")}\n窗口: ${windowStart} ~ ${windowEnd}\n时长: ${durationMin} 分钟\n\n忙闲信息:\n${freebusyRes.stdout || "（无数据）"}`,
      );
      appendMessage(
        "assistant",
        `🗓️ 推荐会议时间（供选择）：\n\n${suggestion}\n\n确认后可复制时间到「日历」标签页一键创建。`,
      );
    });

  // ── Tab panels ─────────────────────────────────────────────────────────────

  /** @returns 进程退出码；未收到 exit / 异常时为 -1 */
  const runStreamingAuth = async (command: string): Promise<number> => {
    let lastExitCode: number | null = null;
    if (authRunning) return -1;
    setAuthRunning(true);
    setAuthTerminal([{ type: "info", text: `$ ${command}\n` }]);
    setAuthUrls([]);
    setAuthPopupBlocked(false);
    if (/auth\s+login|config\s+init/.test(command)) {
      feishuHandledRef.current = false;
      setAuthPersonalConnected(false);
      setAuthAwaitingBrowser(true);
    }

    const urlRegex = /https?:\/\/[^\s"'\]）)>]+/g;
    let uiReleased = false;
    let releaseTimer: ReturnType<typeof setTimeout> | null = null;
    let urlUnlockScheduled = false;
    let didAutoOpenFeishuOAuth = false;
    let watchdogId: ReturnType<typeof setTimeout> | undefined;

    const releaseAuthUi = (hint: string) => {
      if (uiReleased) return;
      uiReleased = true;
      if (releaseTimer) {
        clearTimeout(releaseTimer);
        releaseTimer = null;
      }
      if (watchdogId !== undefined) clearTimeout(watchdogId);
      setAuthRunning(false);
      if (hint.includes("等待超时")) setAuthAwaitingBrowser(false);
      if (hint)
        setAuthTerminal((prev) => [...prev, { type: "info", text: `\n${hint}\n` }]);
    };

    watchdogId = setTimeout(() => {
      releaseAuthUi(
        "─── 等待超时 ───\n" +
          "按钮已解锁。若你已在飞书里点过授权，稍等几秒顶部应会自动显示「飞书已连接」；若没有，到「连接飞书」再点一次登录即可。",
      );
    }, 240_000);

    const tryScheduleUnlockAfterAuthUrl = (chunk: string) => {
      if (urlUnlockScheduled) return;
      if (!/(auth\s+login|config\s+init)/.test(command)) return;
      const urls = chunk.match(urlRegex) ?? [];
      if (urls.length === 0) return;
      urlUnlockScheduled = true;
      releaseTimer = setTimeout(() => {
        releaseTimer = null;
        releaseAuthUi(
          "─── 可以动啦 ───\n" +
            "请点开上面的链接，在飞书里登录并同意授权。完成后回到本页，状态会自动变成「已连接」（一般几秒内）。\n" +
            "（按钮已解锁，不会再卡住。）",
        );
      }, 2800);
    };

    try {
      const res = await fetch("/api/lark-cli/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command, timeoutMs: 180000 }),
      });

      if (!res.body) throw new Error("No stream body");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          const dataPart = line.replace(/^data:\s*/, "").trim();
          if (!dataPart) continue;
          try {
            const ev = JSON.parse(dataPart) as {
              type: string;
              text?: string;
              code?: number;
            };
            if (ev.type === "stdout" || ev.type === "stderr") {
              const text = ev.text ?? "";
              setAuthTerminal((prev) => [...prev, { type: ev.type, text }]);
              const urls = text.match(urlRegex) ?? [];
              if (urls.length) {
                setAuthUrls((prev) => {
                  const next = [...prev];
                  for (const u of urls) {
                    if (!next.includes(u)) next.push(u);
                  }
                  return next;
                });
                if (!didAutoOpenFeishuOAuth && typeof window !== "undefined") {
                  const oauthUrl = urls.find((u) => isLikelyFeishuOAuthUrl(u));
                  if (oauthUrl) {
                    didAutoOpenFeishuOAuth = true;
                    const win = window.open(
                      oauthUrl,
                      "_blank",
                      "noopener,noreferrer",
                    );
                    if (!win || win.closed) {
                      setAuthPopupBlocked(true);
                    }
                  }
                }
              }
              tryScheduleUnlockAfterAuthUrl(text);
            } else if (ev.type === "exit") {
              if (watchdogId !== undefined) clearTimeout(watchdogId);
              if (releaseTimer) {
                clearTimeout(releaseTimer);
                releaseTimer = null;
              }
              const code = ev.code ?? -1;
              lastExitCode = code;
              setAuthTerminal((prev) => [
                ...prev,
                {
                  type: "exit",
                  text: `\n[进程退出，exit=${code}]\n`,
                },
              ]);
              if (!uiReleased) {
                setAuthRunning(false);
                uiReleased = true;
              }
              if (code === 0) {
                const statusRes = await fetch("/api/lark-cli", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    command: "lark-cli auth status",
                    timeoutMs: 10000,
                  }),
                });
                const statusData = (await statusRes.json()) as {
                  result?: { stdout?: string };
                };
                if (statusData.result?.stdout) {
                  const raw = statusData.result.stdout;
                  const j = tryParseAuthStatusJson(raw);
                  const needUser =
                    j &&
                    String(j.identity ?? "").toLowerCase() === "bot" &&
                    /no user logged in|only bot|auth login/i.test(
                      String(j.note ?? ""),
                    );
                  setAuthTerminal((prev) => [
                    ...prev,
                    {
                      type: "info",
                      text: needUser
                        ? `\n─── 当前状态 ───\n应用已配置，但还没有你的「个人飞书登录」。请往下点「开始登录」，在浏览器里完成授权后再查。\n\n（原始信息）\n${raw}\n`
                        : `\n─── 当前登录状态 ───\n${raw}\n`,
                    },
                  ]);
                  const st: CliResult = {
                    command: "lark-cli auth status",
                    exitCode: 0,
                    stdout: raw,
                    stderr: "",
                    durationMs: 0,
                  };
                  if (authPersonalReady(st)) applyFeishuPersonalConnected(true);
                }
              }
            } else if (ev.type === "timeout") {
              if (watchdogId !== undefined) clearTimeout(watchdogId);
              if (releaseTimer) {
                clearTimeout(releaseTimer);
                releaseTimer = null;
              }
              lastExitCode = -1;
              if (/auth\s+login|config\s+init/.test(command))
                setAuthAwaitingBrowser(false);
              setAuthTerminal((prev) => [
                ...prev,
                { type: "exit", text: "\n[超时]\n" },
              ]);
              if (!uiReleased) {
                setAuthRunning(false);
                uiReleased = true;
              }
            } else if (ev.type === "error") {
              if (watchdogId !== undefined) clearTimeout(watchdogId);
              if (releaseTimer) {
                clearTimeout(releaseTimer);
                releaseTimer = null;
              }
              lastExitCode = -1;
              if (/auth\s+login|config\s+init/.test(command))
                setAuthAwaitingBrowser(false);
              setAuthTerminal((prev) => [
                ...prev,
                { type: "stderr", text: `ERROR: ${ev.text ?? ""}\n` },
              ]);
              if (!uiReleased) {
                setAuthRunning(false);
                uiReleased = true;
              }
            }
          } catch {
            /* ignore parse errors */
          }
        }
      }
      return lastExitCode ?? -1;
    } catch (err) {
      if (/auth\s+login|config\s+init/.test(command))
        setAuthAwaitingBrowser(false);
      if (watchdogId !== undefined) clearTimeout(watchdogId);
      if (releaseTimer) {
        clearTimeout(releaseTimer);
        releaseTimer = null;
      }
      setAuthTerminal((prev) => [
        ...prev,
        {
          type: "stderr",
          text: `\n连接失败: ${err instanceof Error ? err.message : String(err)}\n`,
        },
      ]);
      if (!uiReleased) {
        setAuthRunning(false);
        uiReleased = true;
      }
      return -1;
    } finally {
      if (watchdogId !== undefined) clearTimeout(watchdogId);
      if (releaseTimer) clearTimeout(releaseTimer);
      if (!uiReleased) setAuthRunning(false);
    }
  };

  /** 简洁版「②」：先 domain+recommend，再单独补 search:docs:read（CLI 禁止写进同一条命令）。 */
  const runSimplePersonalLoginChain = async () => {
    const primary = buildAuthLoginCommand({
      loginScope: "",
      loginDomain: DEFAULT_SIMPLE_LOGIN_DOMAINS,
    });
    const code1 = await runStreamingAuth(primary);
    if (code1 !== 0) return;
    setAuthTerminal((prev) => [
      ...prev,
      {
        type: "info",
        text:
          "\n─── 第二步（自动）───\n" +
          "当前 lark-cli 不允许把「--domain + --recommend」与「--scope」写在同一条命令里。\n" +
          "接下来会再打开一次飞书授权页，用于补充云文档搜索所需的 search:docs:read（与 docs +search 一致）。\n" +
          "若你不需要文档搜索，可关闭该授权页跳过；日历、任务等已在第一步完成。\n",
      },
    ]);
    await runStreamingAuth(LARK_AUTH_SUPPLEMENT_SEARCH_DOCS_READ_CMD);
  };

  /** 完整模式「开始登录」：domain 路径且含 docs/wiki/all 时自动串联补 search:docs:read */
  const runWorkbenchPersonalLoginChain = async (p: AuthParams) => {
    const cmd = buildAuthLoginCommand(p);
    if (!cmd) return;
    const code1 = await runStreamingAuth(cmd);
    if (code1 !== 0 || !loginChainNeedsDocSearchSupplement(p)) return;
    setAuthTerminal((prev) => [
      ...prev,
      {
        type: "info",
        text:
          "\n─── 第二步（自动）───\n" +
          "当前 lark-cli 不允许把「--domain + --recommend」与「--scope」写在同一条命令里。\n" +
          "接下来会再打开一次飞书授权页，用于补充云文档搜索所需的 search:docs:read。\n" +
          "若你不需要文档搜索，可关闭该授权页跳过。\n",
      },
    ]);
    await runStreamingAuth(LARK_AUTH_SUPPLEMENT_SEARCH_DOCS_READ_CMD);
  };

  const renderAuth = () => (
    <div className="flex flex-col gap-4">
      {/* 完整模式：独立「自检」卡片 */}
      {fullWorkbenchMode && (
        <Card>
          <SectionTitle>先确认连上没有</SectionTitle>
          <p className="text-xs text-gray-500 mb-3">
            点按钮后看下方对话，会用简单话告诉你结果。
          </p>
          <div className="flex flex-wrap gap-2">
            <Btn
              variant="ghost"
              onClick={() => runCommand("lark-cli auth status")}
              disabled={loading}
            >
              📄 飞书登录好了吗
            </Btn>
            <Btn
              variant="ghost"
              onClick={() => runCommand("lark-cli config show")}
              disabled={loading}
            >
              ⚙️ 当前连接信息
            </Btn>
            <Btn
              variant="ghost"
              onClick={() => runCommand("lark-cli doctor")}
              disabled={loading}
            >
              🧐 环境体检
            </Btn>
            <Btn
              variant="ghost"
              disabled={loading}
              onClick={() =>
                runFlow("更新 lark-cli", async () => {
                  const r = await executeSingle(
                    "npm update -g @larksuite/cli",
                    120000,
                  );
                  appendMessage(
                    "assistant",
                    r.exitCode === 0
                      ? `✅ 更新完成！请重启 AI Agent 加载最新 Skills。\n${r.stdout}`
                      : `❌ 更新失败\n${r.stderr || r.stdout}`,
                  );
                })
              }
            >
              ⬆️ 更新 CLI
            </Btn>
          </div>
        </Card>
      )}

      {/* 主流程 */}
      <Card>
        <div className="flex items-start gap-3 mb-4">
          <span className="text-lg">🔑</span>
          <div className="flex-1">
            <h3 className="font-semibold text-gray-900 text-sm">
              {fullWorkbenchMode ? "第一次连接飞书" : "连接飞书"}
            </h3>
            <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
              {fullWorkbenchMode
                ? "按下面按钮后，中间会出现说明和链接；出现链接就点开，在浏览器里登录飞书并同意授权即可。"
                : "第一次用请先初始化；再用飞书账号登录。出现链接请在浏览器里打开并完成授权。"}
            </p>
            {!fullWorkbenchMode ? (
              <p className="text-xs font-semibold text-gray-800 mt-2">
                用你自己的飞书账号登录
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row flex-wrap gap-2 mb-4">
          <Btn
            variant="primary"
            disabled={authRunning}
            onClick={() => runStreamingAuth("lark-cli config init --new")}
          >
            {authRunning ? "⏳ 请稍候…" : "① 第一次用：点这里初始化"}
          </Btn>
          {!fullWorkbenchMode && (
            <Btn
              variant="success"
              disabled={authRunning}
              onClick={() => void runSimplePersonalLoginChain()}
            >
              {authRunning ? "⏳ 等待授权…" : "② 登录我的飞书"}
            </Btn>
          )}
          {!fullWorkbenchMode && (
            <Btn
              variant="ghost"
              disabled={loading || authRunning}
              onClick={() => runCommand("lark-cli auth status")}
            >
              我授权好了，检查一下
            </Btn>
          )}
          {!fullWorkbenchMode && (
            <Btn
              variant="ghost"
              disabled={authRunning}
              onClick={() => {
                setActiveTab("auth");
                runStreamingAuth(LARK_AUTH_SUPPLEMENT_IM_MESSAGES_AS_USER_CMD);
              }}
            >
              仅补充：读群/单聊消息（与飞书报错 hint 一致）
            </Btn>
          )}
        </div>
        {!fullWorkbenchMode && (
          <p className="text-[11px] text-gray-500 mb-3 leading-relaxed">
            主按钮「② 登录」会先走<strong>云文档 + 即时消息 + 通讯录</strong>域（
            <code className="text-[10px] bg-gray-100 px-0.5 rounded">--recommend</code>
            ）；因 lark-cli 限制不能与 <code className="text-[10px] bg-gray-100 px-0.5 rounded">--scope</code>{" "}
            混写，成功后会<strong>再弹一次</strong>授权页补{" "}
            <code className="text-[10px] bg-gray-100 px-0.5 rounded">search:docs:read</code>
            （文档搜索用；不需要可关掉第二次页面）。拉消息仍报{" "}
            <code className="text-[10px] bg-gray-100 px-0.5 rounded">missing_scope</code>{" "}
            时，点「仅补充：读群/单聊消息」；若仅「同步群列表」失败可再点「仅补群列表」。
          </p>
        )}
        {!fullWorkbenchMode && (
          <div className="mb-3">
            <Btn
              variant="ghost"
              size="sm"
              disabled={authRunning}
              onClick={() => {
                setActiveTab("auth");
                runStreamingAuth(LARK_AUTH_SUPPLEMENT_IM_CHAT_LIST_CMD);
              }}
            >
              仅补群列表（im:chat:read）
            </Btn>
          </div>
        )}

        {/* Scope：仅完整模式平铺；简洁版收进折叠 */}
        {fullWorkbenchMode ? (
          <div className="mb-3">
            <p className="text-xs text-gray-500 font-medium mb-2">
              用飞书账号登录：点选「能力域」（与命令行{" "}
              <code className="font-mono text-[11px]">--domain</code>{" "}
              一致），会自动带上{" "}
              <code className="font-mono text-[11px]">--recommend</code>。
              一般不要自拼 scope 长串，易被判定为无效。
            </p>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {LARK_LOGIN_DOMAINS.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() =>
                    setAuthParams((p) => toggleLoginDomain(p, id))
                  }
                  className={`px-2.5 py-1 rounded-lg text-xs transition border ${
                    isLoginDomainChipSelected(authParams.loginDomain, id)
                      ? "bg-blue-100 text-blue-800 border-blue-300 font-semibold"
                      : "bg-gray-100 text-gray-600 border-gray-200 hover:bg-blue-50 hover:text-blue-700"
                  }`}
                >
                  {isLoginDomainChipSelected(authParams.loginDomain, id)
                    ? "✓ "
                    : ""}
                  {label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="text-xs text-gray-400 mb-1 block">
                  Domain（可手改，逗号分隔，与左侧点选联动）
                </label>
                <Input
                  value={authParams.loginDomain}
                  onChange={(v) =>
                    setAuthParams((p) => ({
                      ...p,
                      loginDomain: v,
                      loginScope: v.trim() ? "" : p.loginScope,
                    }))
                  }
                  placeholder="如 docs 或 docs,drive"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">
                  Scope（可选，仅专家；与 Domain 二选一）
                </label>
                <Input
                  value={authParams.loginScope}
                  onChange={(v) =>
                    setAuthParams((p) => ({
                      ...p,
                      loginScope: v,
                      loginDomain: v.trim() ? "" : p.loginDomain,
                    }))
                  }
                  placeholder="留空即可；勿粘贴旧版整段 scope"
                />
              </div>
            </div>

            <div className="flex gap-2">
              <Btn
                variant="success"
                disabled={
                  authRunning || !buildAuthLoginCommand(authParams)
                }
                onClick={() => void runWorkbenchPersonalLoginChain(authParams)}
              >
                {authRunning ? "⏳ 等待授权…" : "🔑 开始登录"}
              </Btn>
              <Btn
                variant="ghost"
                disabled={authRunning}
                onClick={() =>
                  runStreamingAuth(LARK_AUTH_SUPPLEMENT_IM_MESSAGES_AS_USER_CMD)
                }
              >
                补充读群/单聊消息（与 CLI hint 一致）
              </Btn>
              <Btn
                variant="ghost"
                size="sm"
                disabled={authRunning}
                onClick={() =>
                  runStreamingAuth(LARK_AUTH_SUPPLEMENT_IM_CHAT_LIST_CMD)
                }
              >
                仅补群列表 im:chat:read
              </Btn>
              <Btn
                variant="ghost"
                disabled={authRunning}
                onClick={() =>
                  setAuthParams({
                    loginScope: "",
                    loginDomain: DEFAULT_SIMPLE_LOGIN_DOMAINS,
                  })
                }
              >
                重置为默认（文档+IM+通讯录）
              </Btn>
            </div>
          </div>
        ) : (
          <details className="group mb-1 rounded-xl border border-gray-200 bg-gray-50/80 px-3 py-2 text-xs">
            <summary className="cursor-pointer select-none font-medium text-gray-600 list-none flex items-center gap-2 [&::-webkit-details-marker]:hidden">
              <span className="text-gray-400 group-open:rotate-90 transition-transform">
                ▸
              </span>
              高级：自选权限、环境检测、更新 CLI
            </summary>
            <div className="mt-3 space-y-3 pt-1 border-t border-gray-200/80">
              <div className="flex flex-wrap gap-2">
                <Btn
                  variant="ghost"
                  onClick={() => runCommand("lark-cli auth status")}
                  disabled={loading}
                >
                  登录状态
                </Btn>
                <Btn
                  variant="ghost"
                  onClick={() => runCommand("lark-cli config show")}
                  disabled={loading}
                >
                  当前配置
                </Btn>
                <Btn
                  variant="ghost"
                  onClick={() => runCommand("lark-cli doctor")}
                  disabled={loading}
                >
                  环境体检
                </Btn>
                <Btn
                  variant="ghost"
                  disabled={loading}
                  onClick={() =>
                    runFlow("更新 lark-cli", async () => {
                      const r = await executeSingle(
                        "npm update -g @larksuite/cli",
                        120000,
                      );
                      appendMessage(
                        "assistant",
                        r.exitCode === 0
                          ? `✅ 更新完成！请重启 AI Agent 加载最新 Skills。\n${r.stdout}`
                          : `❌ 更新失败\n${r.stderr || r.stdout}`,
                      );
                    })
                  }
                >
                  更新 CLI
                </Btn>
              </div>
              <p className="text-[11px] text-gray-500 font-medium">
                点选能力域（与上方「②」相同逻辑）；或清空 Domain
                后仅在右侧填专家级 scope。推荐优先用域 + recommend。
              </p>
              <div className="flex flex-wrap gap-1.5">
                {LARK_LOGIN_DOMAINS.map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() =>
                      setAuthParams((p) => toggleLoginDomain(p, id))
                    }
                    className={`px-2 py-1 rounded-lg text-xs transition border ${
                      isLoginDomainChipSelected(authParams.loginDomain, id)
                        ? "bg-blue-100 text-blue-800 border-blue-300 font-semibold"
                        : "bg-gray-100 text-gray-600 border-gray-200 hover:bg-blue-50 hover:text-blue-700"
                    }`}
                  >
                    {isLoginDomainChipSelected(authParams.loginDomain, id)
                      ? "✓ "
                      : ""}
                    {label}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] text-gray-400 mb-1 block">
                    Domain
                  </label>
                  <Input
                    value={authParams.loginDomain}
                    onChange={(v) =>
                      setAuthParams((p) => ({
                        ...p,
                        loginDomain: v,
                        loginScope: v.trim() ? "" : p.loginScope,
                      }))
                    }
                    placeholder="如 docs,drive"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-gray-400 mb-1 block">
                    Scope（可选）
                  </label>
                  <Input
                    value={authParams.loginScope}
                    onChange={(v) =>
                      setAuthParams((p) => ({
                        ...p,
                        loginScope: v,
                        loginDomain: v.trim() ? "" : p.loginDomain,
                      }))
                    }
                    placeholder="与 Domain 二选一"
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Btn
                  variant="success"
                  size="sm"
                  disabled={authRunning || !buildAuthLoginCommand(authParams)}
                  onClick={() => void runWorkbenchPersonalLoginChain(authParams)}
                >
                  {authRunning ? "⏳ 等待授权…" : "按当前选择登录"}
                </Btn>
                <Btn
                  variant="ghost"
                  size="sm"
                  disabled={authRunning}
                  onClick={() =>
                    setAuthParams({
                      loginScope: "",
                      loginDomain: DEFAULT_SIMPLE_LOGIN_DOMAINS,
                    })
                  }
                >
                  重置为默认（文档+IM+通讯录）
                </Btn>
              </div>
            </div>
          </details>
        )}

        {/* Streaming terminal output */}
        {authTerminal.length > 0 && (
          <div className="mt-4">
            {/* Extracted URLs — shown prominently */}
            {authUrls.length > 0 && (
              <div className="mb-3 p-3 rounded-xl bg-blue-50 border border-blue-200">
                <p className="text-xs font-semibold text-blue-700 mb-2">
                  🔗 已尝试自动打开飞书登录页（新标签页）
                </p>
                {authPopupBlocked && (
                  <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5 mb-2">
                    浏览器可能拦截了弹窗，请<strong>手动点击</strong>下面链接完成登录。
                  </p>
                )}
                <p className="text-[11px] text-blue-600/90 mb-2">
                  若未自动跳转，同样可点下列链接：
                </p>
                <div className="flex flex-col gap-1.5">
                  {authUrls.map((url) => (
                    <a
                      key={url}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs text-blue-600 underline underline-offset-2 break-all hover:text-blue-800"
                    >
                      🌐 {url}
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Terminal scroll area */}
            <div className="rounded-xl bg-gray-950 p-4 font-mono text-xs leading-relaxed overflow-y-auto max-h-72 whitespace-pre-wrap">
              {authRunning && (
                <span className="inline-flex items-center gap-1.5 text-emerald-400 mb-1">
                  <svg
                    className="w-3 h-3 animate-spin"
                    viewBox="0 0 24 24"
                    fill="none"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8v8z"
                    />
                  </svg>
                  运行中，等待授权完成…
                </span>
              )}
              {authTerminal.map((chunk, i) => (
                <span
                  key={i}
                  className={
                    chunk.type === "stderr"
                      ? "text-yellow-300"
                      : chunk.type === "exit"
                        ? "text-gray-400"
                        : chunk.type === "info"
                          ? "text-cyan-300"
                          : "text-gray-100"
                  }
                >
                  {chunk.text}
                </span>
              ))}
            </div>

            <div className="flex gap-2 mt-2">
              <Btn
                size="sm"
                variant="ghost"
                onClick={() => {
                  setAuthTerminal([]);
                  setAuthUrls([]);
                  setAuthPopupBlocked(false);
                }}
                disabled={authRunning}
              >
                清空终端
              </Btn>
            </div>
          </div>
        )}
      </Card>
    </div>
  );

  const renderDocHub = () => (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex items-start gap-3 mb-3">
          <span className="text-xl" aria-hidden>
            📚
          </span>
          <div className="flex-1 min-w-0">
            <SectionTitle>飞书文档助手</SectionTitle>
            <p className="text-xs text-gray-500 mt-1 leading-relaxed">
              通过「云文档 / Wiki
              搜索」拉取你有权限访问的文档与表格等，按类型分组展示；留空关键词则做一次宽泛检索（结果量因租户与权限而异，最多翻约
              18 页）。
            </p>
          </div>
        </div>
        <label className="text-xs font-medium text-gray-600 block mb-1">
          搜索关键词（可留空）
        </label>
        <Input
          value={docHubKeyword}
          onChange={(v) => setDocHubKeyword(v)}
          placeholder="例如：项目名、周报、PRD；留空则尽量拉取近期可搜到的文档"
        />
        <FieldHint>
          依赖本机 <code className="text-[10px]">lark-cli docs +search</code>，需用户身份下具备{" "}
          <code className="text-[10px]">search:docs:read</code>。简洁版「②
          登录我的飞书」在第一步结束后会自动发起第二步以补该 scope（与 CLI 限制有关）；若仍报{" "}
          <code className="text-[10px]">missing_scope</code>，请确认开放平台已开通该权限，或使用下方「补充文档搜索权限」再授权一次。
        </FieldHint>
        <div className="mt-3 flex flex-wrap gap-2">
          <Btn
            variant="primary"
            disabled={docHubLoading || !authPersonalConnected}
            onClick={() => void loadDocHub()}
          >
            {docHubLoading ? "拉取中…" : "拉取并分类展示"}
          </Btn>
          {!authPersonalConnected ? (
            <span className="text-[11px] text-amber-800 self-center">
              请先完成「连接飞书」
            </span>
          ) : null}
        </div>
      </Card>

      {docHubError ? (
        <Card>
          <p className="text-sm text-rose-700 leading-relaxed">{docHubError}</p>
          {docHubSearchScopeMissing(docHubError) ? (
            <div className="mt-4 space-y-3 border-t border-rose-100 pt-4">
              <div className="flex flex-wrap gap-2">
                <Btn
                  size="sm"
                  variant="primary"
                  disabled={authRunning}
                  onClick={() => {
                    setActiveTab("auth");
                    runStreamingAuth(LARK_AUTH_SUPPLEMENT_SEARCH_DOCS_READ_CMD);
                  }}
                >
                  {authRunning
                    ? "⏳ 等待浏览器授权…"
                    : "补充文档搜索权限（search:docs:read）"}
                </Btn>
                <Btn
                  size="sm"
                  variant="ghost"
                  disabled={authRunning}
                  onClick={() => setActiveTab("auth")}
                >
                  打开连接飞书
                </Btn>
              </div>
              <p className="text-[11px] leading-relaxed text-gray-700 whitespace-pre-wrap">
                {docHubSearchScopeFollowupText()}
              </p>
            </div>
          ) : null}
        </Card>
      ) : null}

      {docHubHint && !docHubError ? (
        <Card>
          <p className="text-sm text-amber-900/90 leading-relaxed">{docHubHint}</p>
        </Card>
      ) : null}

      {docHubTotal > 0 ? (
        <Card>
          <p className="text-xs text-gray-600 mb-3">
            共 <span className="font-semibold text-gray-900">{docHubTotal}</span>{" "}
            条（已去重），按类型分组如下。
          </p>
          <div className="max-h-[min(70vh,520px)] space-y-5 overflow-y-auto pr-1">
            {docHubGroups.map((g) => (
              <div key={g.label}>
                <h3 className="text-sm font-semibold text-gray-900 border-b border-gray-200 pb-1.5 mb-2">
                  {g.label}
                  <span className="ml-2 text-xs font-normal text-gray-500">
                    {g.rows.length} 个
                  </span>
                </h3>
                <ul className="space-y-1.5">
                  {g.rows.map((row) => (
                    <li
                      key={row.key}
                      className="flex items-start gap-2 rounded-lg border border-gray-100 bg-gray-50/80 px-2.5 py-1.5 text-[13px]"
                    >
                      <span className="min-w-0 flex-1 text-gray-900 leading-snug">
                        {row.title}
                      </span>
                      {row.url ? (
                        <a
                          href={row.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0 text-xs text-blue-600 hover:underline"
                        >
                          打开
                        </a>
                      ) : (
                        <span className="shrink-0 text-[10px] text-gray-400">
                          {row.typeRaw}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );

  const renderDevReport = () => (
    <DevReportPanel loading={loading} setLoading={setLoading} />
  );

  const renderTapdBug = () => <TapdBugPanel />;

  const renderTapdStats = () => <TapdBugStatsPanel />;

  const renderVote = () => <LarkVotePanel />;

  const renderDocs = () => (
    <Card>
      <SectionTitle>文档操作</SectionTitle>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <Input
          value={docsParams.docTitle}
          onChange={(v) => setDocsParams((p) => ({ ...p, docTitle: v }))}
          placeholder="文档标题"
        />
        <Input
          value={docsParams.docToken}
          onChange={(v) => setDocsParams((p) => ({ ...p, docToken: v }))}
          placeholder="Doc Token（用于更新/读取）"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Btn
          variant="primary"
          onClick={() =>
            void (async () => {
              setLoading(true);
              try {
                const title = docsParams.docTitle.trim() || "未命名文档";
                const markdown = `# ${title}\n\n创建于 Lark CLI 测试页`;
                const created = await executeDocsCreate(title, markdown, 30000);
                appendMessage(
                  "assistant",
                  `创建文档结果：\n\n${friendlyCliSummary(created)}`,
                  { cli: created },
                );
              } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                appendMessage("assistant", `创建文档失败：${msg}`);
              } finally {
                setLoading(false);
              }
            })()
          }
          disabled={loading}
        >
          ＋ 创建
        </Btn>
        <Btn
          onClick={() =>
            runBatch("搜索文档", [
              `lark-cli docs +search --query "${docsParams.docTitle}"`,
            ])
          }
          disabled={loading}
        >
          🔍 搜索
        </Btn>
        <Btn
          onClick={() =>
            runBatch("追加内容", [
              docsParams.docToken
                ? `lark-cli docs +update --doc "${docsParams.docToken}" --mode append --markdown "\n\n追加内容：Docs 读写链路测试"`
                : "<请填写 Doc Token>",
            ])
          }
          disabled={loading}
        >
          ✏️ 追加
        </Btn>
        <Btn
          onClick={() =>
            runBatch("读取文档", [
              docsParams.docToken
                ? `lark-cli docs +fetch --doc "${docsParams.docToken}" --format pretty`
                : "<请填写 Doc Token>",
            ])
          }
          disabled={loading}
        >
          📖 读取
        </Btn>
      </div>
    </Card>
  );

  const renderSheets = () => (
    <Card>
      <SectionTitle>表格操作</SectionTitle>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <Input
          value={sheetsParams.sheetTitle}
          onChange={(v) => setSheetsParams((p) => ({ ...p, sheetTitle: v }))}
          placeholder="表格标题"
        />
        <Input
          value={sheetsParams.sheetUrl}
          onChange={(v) => setSheetsParams((p) => ({ ...p, sheetUrl: v }))}
          placeholder="Sheet URL（用于读写）"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Btn
          variant="primary"
          onClick={() =>
            runBatch("创建表格", [
              `lark-cli sheets +create --title "${sheetsParams.sheetTitle}" --headers '["日期","渠道","数量"]' --data '[["${new Date().toISOString().slice(0, 10)}","抖音","18"]]'`,
            ])
          }
          disabled={loading}
        >
          ＋ 创建
        </Btn>
        <Btn
          onClick={() =>
            runBatch("写入数据", [
              sheetsParams.sheetUrl
                ? `lark-cli sheets +write --url "${sheetsParams.sheetUrl}" --range A2:C2 --values '[["${new Date().toISOString().slice(0, 10)}","小红书","26"]]'`
                : "<请填写 Sheet URL>",
            ])
          }
          disabled={loading}
        >
          ✏️ 写入
        </Btn>
        <Btn
          onClick={() =>
            runBatch("读取数据", [
              sheetsParams.sheetUrl
                ? `lark-cli sheets +read --url "${sheetsParams.sheetUrl}" --range A1:C10`
                : "<请填写 Sheet URL>",
            ])
          }
          disabled={loading}
        >
          📖 读取
        </Btn>
      </div>
    </Card>
  );

  const renderCalendar = () => {
    const range = getDefaultCalendarRange();
    return (
      <Card>
        <SectionTitle>日历操作</SectionTitle>
        <div className="grid grid-cols-2 gap-3 mb-4">
          <Input
            value={calendarParams.meetingTitle}
            onChange={(v) =>
              setCalendarParams((p) => ({ ...p, meetingTitle: v }))
            }
            placeholder="会议标题"
          />
          <Input
            value={calendarParams.attendeeIds}
            onChange={(v) =>
              setCalendarParams((p) => ({ ...p, attendeeIds: v }))
            }
            placeholder="参会人 IDs（逗号分隔，可选）"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Btn
            onClick={() =>
              runBatch("今日日程", [
                `lark-cli calendar +agenda --as user --format table`,
              ])
            }
            disabled={loading}
          >
            📅 今日日程
          </Btn>
          <Btn
            onClick={() => {
              const now = new Date();
              const start = new Date(now);
              start.setDate(start.getDate() - 30);
              start.setHours(0, 0, 0, 0);
              const end = new Date(now);
              end.setHours(23, 59, 59, 999);
              runBatch("近 30 天日程", [
                `lark-cli calendar +agenda --as user --start "${start.toISOString()}" --end "${end.toISOString()}" --format table`,
              ]);
            }}
            disabled={loading}
          >
            📅 近 30 天
          </Btn>
          <Btn
            variant="primary"
            onClick={() => {
              const a = calendarParams.attendeeIds.trim();
              runBatch("创建日程", [
                `lark-cli calendar +create --summary "${calendarParams.meetingTitle}" --start "${range.start}" --end "${range.end}"${a ? ` --attendee-ids "${a}"` : ""}`,
              ]);
            }}
            disabled={loading}
          >
            ＋ 创建
          </Btn>
          <Btn
            onClick={() =>
              runBatch("忙闲查询", [
                calendarParams.attendeeIds.trim()
                  ? `lark-cli calendar +freebusy --user-ids "${calendarParams.attendeeIds}" --start "${range.start}" --end "${range.end}" --format pretty`
                  : "<请填写参会人 IDs>",
              ])
            }
            disabled={loading}
          >
            🕐 忙闲
          </Btn>
          <Btn
            onClick={() =>
              runBatch("时间推荐", [
                calendarParams.attendeeIds.trim()
                  ? `lark-cli calendar +suggestion --start "${range.start}" --end "${new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString()}" --attendee-ids "${calendarParams.attendeeIds}" --duration-minutes 30`
                  : "<请填写参会人 IDs>",
              ])
            }
            disabled={loading}
          >
            💡 时间推荐
          </Btn>
        </div>
      </Card>
    );
  };

  const renderTasks = () => (
    <Card>
      <SectionTitle>任务操作</SectionTitle>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <Input
          value={taskParams.summary}
          onChange={(v) => setTaskParams((p) => ({ ...p, summary: v }))}
          placeholder="任务标题"
        />
        <Input
          value={taskParams.due}
          onChange={(v) => setTaskParams((p) => ({ ...p, due: v }))}
          placeholder="截止时间（+2d / 2026-04-10）"
        />
        <Input
          value={taskParams.description}
          onChange={(v) => setTaskParams((p) => ({ ...p, description: v }))}
          placeholder="任务描述"
        />
        <Input
          value={taskParams.reminder}
          onChange={(v) => setTaskParams((p) => ({ ...p, reminder: v }))}
          placeholder="提醒时间（1h / 15m / 1d）"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Btn
          variant="primary"
          onClick={() =>
            runBatch("创建任务", [
              `lark-cli task +create --summary "${taskParams.summary}" --description "${taskParams.description}" --due "${taskParams.due}" --format json`,
            ])
          }
          disabled={loading}
        >
          ＋ 创建
        </Btn>
        <Btn
          onClick={() =>
            runBatch("我的任务", [`lark-cli task +get-my-tasks --format table`])
          }
          disabled={loading}
        >
          📋 我的任务
        </Btn>
        <Btn
          onClick={() =>
            runBatch("搜索任务", [
              `lark-cli task +get-my-tasks --query "${taskParams.summary}" --format table`,
            ])
          }
          disabled={loading}
        >
          🔍 搜索
        </Btn>
      </div>
    </Card>
  );

  const renderIM = () => (
    <Card>
      <SectionTitle>即时消息</SectionTitle>
      <p className="text-xs text-gray-500 mb-3">
        发群消息需向管理员要「群编号」；个人场景一般用飞书客户端即可。
      </p>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <Input
          value={imParams.chatId}
          onChange={(v) => setImParams((p) => ({ ...p, chatId: v }))}
          placeholder="群或会话编号（管理员提供）"
        />
        <Input
          value={imParams.message}
          onChange={(v) => setImParams((p) => ({ ...p, message: v }))}
          placeholder="消息内容"
        />
      </div>
      <Btn
        variant="primary"
        onClick={() =>
          runBatch("发送消息", [
            imParams.chatId.trim()
              ? `lark-cli im +messages-send --as bot --chat-id "${imParams.chatId}" --text "${quoteCliArg(imParams.message)}"`
              : "<请填写 chat_id>",
          ])
        }
        disabled={loading}
      >
        📤 发送
      </Btn>
    </Card>
  );

  const renderMail = () => (
    <Card>
      <SectionTitle>邮件</SectionTitle>
      <p className="text-xs text-gray-500 mb-3">
        发信走你的飞书邮箱：需个人登录，且授权里包含邮件能力。若报错{" "}
        <code className="text-[11px] bg-gray-100 px-1 rounded">not logged in</code>{" "}
        ，点下面「补充邮件授权」走一遍飞书授权（或到「连接飞书」勾选 mail
        相关 scope / Domain 填 mail 后「开始登录」）。
      </p>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <Input
          value={mailParams.to}
          onChange={(v) => setMailParams((p) => ({ ...p, to: v }))}
          placeholder="收件人邮箱"
        />
        <Input
          value={mailParams.subject}
          onChange={(v) => setMailParams((p) => ({ ...p, subject: v }))}
          placeholder="邮件主题"
        />
      </div>
      <Textarea
        value={mailParams.body}
        onChange={(v) => setMailParams((p) => ({ ...p, body: v }))}
        placeholder="邮件正文"
        rows={3}
      />
      <div className="mt-3 flex flex-wrap gap-2">
        <Btn
          variant="ghost"
          disabled={authRunning}
          onClick={() =>
            runStreamingAuth(
              "lark-cli auth login --domain mail --recommend",
            )
          }
        >
          {authRunning ? "⏳ 授权中…" : "📎 补充邮件授权"}
        </Btn>
        <Btn
          variant="primary"
          onClick={() =>
            runBatch("发送邮件", [
              mailParams.to.trim()
                ? `lark-cli mail +send --as user --confirm-send --to "${mailParams.to}" --subject "${quoteCliArg(mailParams.subject)}" --body "${quoteCliArg(mailParams.body)}"`
                : "<请填写收件人>",
            ])
          }
          disabled={loading || authRunning}
        >
          📧 发送
        </Btn>
      </div>
    </Card>
  );

  const renderVC = () => (
    <Card>
      <SectionTitle>视频会议</SectionTitle>
      <div className="mb-4">
        <Input
          value={vcParams.query}
          onChange={(v) => setVcParams({ query: v })}
          placeholder="搜索关键词（可选）"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Btn
          onClick={() => {
            const end = new Date();
            const start = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
            runBatch("搜索会议", [
              vcParams.query.trim()
                ? `lark-cli vc +search --query "${vcParams.query}" --start "${start.toISOString().slice(0, 10)}" --end "${end.toISOString().slice(0, 10)}" --format table`
                : `lark-cli vc +search --start "${start.toISOString().slice(0, 10)}" --end "${end.toISOString().slice(0, 10)}" --format table`,
            ]);
          }}
          disabled={loading}
        >
          🔍 搜索记录
        </Btn>
        <Btn
          onClick={() =>
            runBatch("获取纪要", [
              "lark-cli vc +notes --as user --format pretty",
            ])
          }
          disabled={loading}
        >
          📋 获取纪要
        </Btn>
      </div>
    </Card>
  );

  const renderContact = () => (
    <Card>
      <SectionTitle>通讯录</SectionTitle>
      <div className="mb-4">
        <Input
          value={contactParams.query}
          onChange={(v) => setContactParams({ query: v })}
          placeholder="搜索关键词（姓名/邮箱）"
        />
      </div>
      <Btn
        variant="primary"
        onClick={() =>
          runBatch("搜索联系人", [
            contactParams.query.trim()
              ? `lark-cli contact +search-user --query "${contactParams.query}" --format table`
              : "<请填写搜索关键词>",
          ])
        }
        disabled={loading}
      >
        🔍 搜索
      </Btn>
    </Card>
  );

  const renderDrive = () => (
    <Card>
      <SectionTitle>云盘</SectionTitle>
      <div className="mb-4">
        <Input
          value={driveParams.filePath}
          onChange={(v) => setDriveParams({ filePath: v })}
          placeholder="本地文件路径（如 docs/README.md）"
        />
      </div>
      <Btn
        variant="primary"
        onClick={() =>
          runBatch("上传文件", [
            driveParams.filePath.trim()
              ? `lark-cli drive +upload --file "${driveParams.filePath}"`
              : "<请填写文件路径>",
          ])
        }
        disabled={loading}
      >
        ☁️ 上传
      </Btn>
    </Card>
  );

  const simpleChatPullContext = useMemo(() => {
    const fromChecks = chatPullParams.chatIds.map((x) => x.trim()).filter(Boolean);
    const mergeManual = fullWorkbenchMode;
    const allEffective = mergeManual
      ? effectiveChatPullIds(chatPullParams)
      : fromChecks;
    const manualOnly = mergeManual
      ? allEffective.filter((id) => !fromChecks.includes(id))
      : [];
    const nCheck = fromChecks.length;
    const nManual = manualOnly.length;

    const labelForId = (id: string, short: boolean) => {
      const row = myChats.find((c) => c.chat_id === id);
      const raw =
        row?.name ??
        (short && id.length > 12
          ? `${id.slice(0, 10)}…`
          : id.length > 26
            ? `${id.slice(0, 24)}…`
            : id);
      return raw;
    };

    let name: string;
    if (nCheck === 0 && nManual === 0) {
      name = "未选择群聊";
    } else if (nCheck === 0) {
      const n = allEffective.length;
      if (n === 1) {
        name = labelForId(allEffective[0]!, false);
      } else {
        const first = labelForId(allEffective[0]!, true);
        name = `${first} 等 ${n} 个会话（仅手动填写）`;
      }
    } else if (nCheck === 1 && nManual === 0) {
      name = labelForId(fromChecks[0]!, false);
    } else if (nManual === 0) {
      const id0 = fromChecks[0]!;
      const first = labelForId(id0, true);
      name = `${first} 等 ${nCheck} 个群`;
    } else {
      const id0 = fromChecks[0]!;
      const first = labelForId(id0, true);
      name = `${first} 等 ${nCheck} 个已选，另有 ${nManual} 个手动会话`;
    }
    const rangeLabel =
      chatPullParams.timeMode === "custom"
        ? chatPullParams.customRangeStart && chatPullParams.customRangeEnd
          ? "自定义时段"
          : "自定义（待填）"
        : formatChatPullHoursLabel(chatPullParams.hoursBack);
    /** 驱动 <summary> 内节点 key，避免 WebKit 下折叠条文案不随 state 重绘 */
    const summaryKey = [
      mergeManual ? "m1" : "m0",
      chatPullParams.chatIds.join("\u001f"),
      chatPullParams.chatId,
      chatPullParams.timeMode,
      chatPullParams.hoursBack,
      chatPullParams.customRangeStart,
      chatPullParams.customRangeEnd,
    ].join("\u001e");
    return { name, rangeLabel, summaryKey };
  }, [chatPullParams, myChats, fullWorkbenchMode]);

  const renderSmartAssistant = () => {
    const toggleChatPullListId = (id: string) => {
      setChatPullParams((p) => {
        const has = p.chatIds.includes(id);
        const nextIds = has
          ? p.chatIds.filter((x) => x !== id)
          : [...p.chatIds, id];
        return { ...p, chatIds: nextIds };
      });
    };

    const renderChatPullPickers = (variant: "simple" | "full") => {
      const isSimple = variant === "simple";
      const labelCls = isSimple
        ? "mb-1 block text-[10px] font-medium uppercase tracking-wide text-slate-500"
        : "text-xs font-medium text-gray-600 block mb-1";
      const listWrapCls = isSimple
        ? "max-h-36 space-y-0.5 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1"
        : "max-h-48 space-y-0.5 overflow-y-auto rounded-xl border border-gray-200 bg-white p-1.5";
      const rowCls = isSimple
        ? "flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-[13px] text-slate-800 hover:bg-slate-50"
        : "flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-gray-900 hover:bg-gray-50";
      const segWrap = isSimple
        ? "flex overflow-hidden rounded-lg border border-slate-200 text-[11px] font-medium"
        : "flex overflow-hidden rounded-xl border border-gray-200 text-xs font-medium";
      const selectCls = isSimple
        ? "mt-2 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[13px] text-slate-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]"
        : "mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900";
      const dtCls = isSimple
        ? "w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[12px] text-slate-900"
        : "w-full rounded-xl border border-gray-200 bg-white px-2 py-2 text-sm text-gray-900";
      const subLbl = isSimple
        ? "mb-0.5 block text-[10px] text-slate-500"
        : "mb-0.5 block text-[10px] text-gray-500";

      return (
        <>
          <div>
            <label className={labelCls}>
              {isSimple ? "群会话（可多选）" : "选择群或会话（可多选）"}
            </label>
            <div className={listWrapCls}>
              {!authPersonalConnected ? (
                <p
                  className={`px-2 py-2 ${isSimple ? "text-[11px]" : "text-xs"} text-amber-700`}
                >
                  请先连接飞书
                </p>
              ) : myChats.length === 0 && !chatsListLoading ? (
                <p
                  className={`px-2 py-2 ${isSimple ? "text-[11px]" : "text-xs"} text-gray-500`}
                >
                  {isSimple ? "暂无群，先点 ↻ 同步" : "暂无列表，先刷新群列表"}
                </p>
              ) : (
                myChats.map((c) => (
                  <label key={c.chat_id} className={rowCls}>
                    <input
                      type="checkbox"
                      className="shrink-0 rounded border-slate-300 text-blue-600"
                      checked={chatPullParams.chatIds.includes(c.chat_id)}
                      onChange={() => toggleChatPullListId(c.chat_id)}
                      disabled={!authPersonalConnected || chatsListLoading}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {c.name.length > (isSimple ? 40 : 48)
                        ? `${c.name.slice(0, isSimple ? 40 : 48)}…`
                        : c.name}
                    </span>
                  </label>
                ))
              )}
            </div>
          </div>
          <div>
            <label className={labelCls}>时间范围</label>
            <div className={segWrap}>
              <button
                type="button"
                onClick={() =>
                  setChatPullParams((p) => ({ ...p, timeMode: "preset" }))
                }
                className={`flex-1 border-r border-slate-200/80 px-2 py-1.5 transition-colors sm:px-3 sm:py-2 ${
                  chatPullParams.timeMode === "preset"
                    ? "bg-blue-600 text-white"
                    : "bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                最近
              </button>
              <button
                type="button"
                onClick={() =>
                  setChatPullParams((p) => ({
                    ...p,
                    timeMode: "custom",
                    customRangeStart:
                      p.customRangeStart ||
                      toDatetimeLocalValue(
                        new Date(Date.now() - 24 * 3600 * 1000),
                      ),
                    customRangeEnd:
                      p.customRangeEnd || toDatetimeLocalValue(new Date()),
                  }))
                }
                className={`flex-1 px-2 py-1.5 transition-colors sm:px-3 sm:py-2 ${
                  chatPullParams.timeMode === "custom"
                    ? "bg-violet-600 text-white"
                    : "bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                自定义
              </button>
            </div>
            {chatPullParams.timeMode === "preset" ? (
              <select
                value={chatPullParams.hoursBack}
                onChange={(e) =>
                  setChatPullParams((p) => ({
                    ...p,
                    hoursBack: e.target.value,
                  }))
                }
                className={selectCls}
                aria-label="时间范围"
              >
                <option value="6">最近 6 小时</option>
                <option value="12">最近 12 小时</option>
                <option value="24">最近 24 小时</option>
                <option value="48">最近 48 小时</option>
                <option value="72">最近 72 小时</option>
                <option value="168">最近 7 天</option>
              </select>
            ) : (
              <div
                className={
                  isSimple
                    ? "mt-2 grid grid-cols-1 gap-2"
                    : "mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2"
                }
              >
                <div>
                  <span className={subLbl}>开始（本地时间）</span>
                  <input
                    type="datetime-local"
                    value={chatPullParams.customRangeStart}
                    onChange={(e) =>
                      setChatPullParams((p) => ({
                        ...p,
                        customRangeStart: e.target.value,
                      }))
                    }
                    className={dtCls}
                  />
                </div>
                <div>
                  <span className={subLbl}>结束（本地时间）</span>
                  <input
                    type="datetime-local"
                    value={chatPullParams.customRangeEnd}
                    onChange={(e) =>
                      setChatPullParams((p) => ({
                        ...p,
                        customRangeEnd: e.target.value,
                      }))
                    }
                    className={dtCls}
                  />
                </div>
              </div>
            )}
          </div>
        </>
      );
    };

    const runWorkbenchChatPullSummary = async () => {
                const simple = !fullWorkbenchModeRef.current;
                const note = chatSummaryUserNoteRef.current;
                setLastChatSummaryExport(null);
                const ids = resolveChatPullIdsForWorkbench(
                  chatPullParams,
                  fullWorkbenchModeRef.current,
                );
                if (!ids.length) {
                  if (simple) {
                    setSmartLine(
                      "err",
                      "未选群",
                      "在列表勾选群，或展开「高级」粘贴 oc_（多个用逗号分隔）",
                    );
                  } else {
                    appendMessage(
                      "assistant",
                      "⚠️ 请至少选择一个群（列表多选），或在「更多选项与说明」里手动填写 oc_ 会话 ID（多个用逗号或换行分隔）。若列表为空，点「刷新群列表」。",
                    );
                  }
                  return;
                }
                const tw = resolveChatPullTimeWindow(chatPullParams);
                if (tw.error) {
                  if (simple) {
                    setSmartLine("err", "时间范围有误", tw.error);
                  } else {
                    appendMessage("assistant", `⚠️ ${tw.error}`);
                  }
                  return;
                }
                const { start, end } = tw;
                const startISO = start.toISOString();
                const endISO = end.toISOString();
                const spanHours = Math.max(
                  1,
                  Math.round((end.getTime() - start.getTime()) / 3600000),
                );
                const imAsFlag = chatPullParams.imAs === "bot" ? "bot" : "user";

                if (simple) {
                  setSmartLine(
                    "running",
                    "正在拉取群消息…",
                    ids.length > 1 ? `${ids.length} 个群 · 约 ${spanHours} 小时` : "",
                  );
                } else {
                  appendMessage(
                    "assistant",
                    `正在以「${imAsFlag === "bot" ? "机器人" : "用户"}」身份拉取 ${ids.length} 个群内消息（${start.toLocaleString("zh-CN")} – ${end.toLocaleString("zh-CN")}，跨度约 ${spanHours} 小时；按时间升序，每群最多约 1000 条）…`,
                  );
                }
                const allLines: string[] = [];
                const pullDebugReports: string[] = [];
                const focusKw = chatPullParams.focusKeyword.trim();
                let totalMsgsPulled = 0;

                for (const cid of ids) {
                  const chatLabel =
                    myChats.find((c) => c.chat_id === cid)?.name ?? cid;
                  allLines.push(`\n## 群：${chatLabel}\n`);
                  let pageToken = "";
                  for (let page = 0; page < 20; page++) {
                    const tokenArg = pageToken
                      ? ` --page-token "${quoteCliArg(pageToken)}"`
                      : "";
                    const cmd =
                      `lark-cli im +chat-messages-list --as ${imAsFlag} --chat-id "${quoteCliArg(cid)}" ` +
                      `--start "${quoteCliArg(startISO)}" --end "${quoteCliArg(endISO)}" ` +
                      `--sort asc --page-size 50 --format json${tokenArg}`;
                    const r = await executeSingle(cmd, 45000);
                    if (r.exitCode !== 0) {
                      const detail = friendlyCliSummary(r);
                      const followup = imWorkbenchPullFailureFollowup(
                        `${detail}\n${r.stderr}\n${r.stdout}`,
                      );
                      if (simple) {
                        setSmartLine(
                          "err",
                          `「${chatLabel.slice(0, 20)}」拉取失败`,
                          `第 ${page + 1} 页 · ${[detail, followup].filter(Boolean).join(" · ").slice(0, 200)}`,
                        );
                      } else {
                        appendMessage(
                          "assistant",
                          `拉取群「${chatLabel}」消息失败（第 ${page + 1} 页）：\n\n${detail}`,
                          { cli: r },
                        );
                        if (followup) {
                          appendMessage("assistant", followup);
                        }
                      }
                      return;
                    }
                    const parsed = tryParseJsonObject(r.stdout);
                    if (!parsed) {
                      pullDebugReports.push(
                        formatImChatMessagesPullDebug(page, null, r),
                      );
                      console.warn(
                        "[lark-workbench im +chat-messages-list] parse_fail",
                        { page, chatId: cid, spanHours, pullDebugReports },
                      );
                      if (simple) {
                        setSmartLine(
                          "err",
                          "解析失败",
                          `群「${chatLabel.slice(0, 16)}」第 ${page + 1} 页 · 请升级 lark-cli 或在「高级」重试`,
                        );
                      } else {
                        appendMessage(
                          "assistant",
                          `无法解析群「${chatLabel}」第 ${page + 1} 页 JSON。请确认 lark-cli 已更新；若需排查可展开下方折叠区复制调试信息。`,
                          {
                            debugFoldText: pullDebugReports.join("\n\n---\n\n"),
                          },
                        );
                      }
                      return;
                    }
                    pullDebugReports.push(
                      formatImChatMessagesPullDebug(page, parsed, r),
                    );
                    totalMsgsPulled += imMessagesArrayFromPage(parsed).length;
                    allLines.push(...linesFromImMessagesJson(parsed, focusKw));
                    const { hasMore, pageToken: next } =
                      imChatMessagesListPageMeta(parsed);
                    if (!hasMore || !next) break;
                    pageToken = next;
                  }
                }

                const contentJoined = allLines
                  .filter((c) => !/^## 群：/.test(c.trim()))
                  .join("\n\n")
                  .trim();
                if (!contentJoined) {
                  console.warn(
                    "[lark-workbench im +chat-messages-list] empty_after_parse",
                    {
                      chatIds: ids,
                      spanHours,
                      lineCount: allLines.length,
                      totalMsgsPulled,
                      pagesLogged: pullDebugReports.length,
                    },
                  );
                  if (totalMsgsPulled === 0) {
                    if (simple) {
                      setSmartLine(
                        "err",
                        "没有可用文本",
                        "该时间范围内未解析到文本消息；可换时间范围或检查群与权限",
                      );
                    } else {
                      appendMessage(
                        "assistant",
                        "该时间范围内没有解析到文本消息。请检查：所选群是否正确、身份（用户/机器人）与权限是否匹配、时间范围内群内是否确有发言。若仍不对，展开下方折叠区把调试信息发给维护同事。",
                        {
                          debugFoldText: pullDebugReports.join("\n\n---\n\n"),
                        },
                      );
                    }
                  } else if (focusKw) {
                    if (simple) {
                      setSmartLine(
                        "err",
                        "未匹配到该对象",
                        `共拉取 ${totalMsgsPulled} 条消息，但发送者昵称/姓名/id 与正文均未匹配「${focusKw}」。请核对飞书里的显示名（群名片可能与通讯录不同），或缩短片段、清空后处理全群摘录`,
                      );
                    } else {
                      appendMessage(
                        "assistant",
                        `所选时间范围内共拉取 ${totalMsgsPulled} 条消息，但没有发送者信息或正文匹配「${focusKw}」。请改用该成员在飞书中的主昵称、或更短的姓名片段；也可清空「服务对象」后处理全群摘录。若仍不对，展开下方折叠区查看首条消息的原始字段键名。`,
                        {
                          debugFoldText: pullDebugReports.join("\n\n---\n\n"),
                        },
                      );
                    }
                  } else if (simple) {
                    setSmartLine(
                      "err",
                      "没有可用文本",
                      "拉取到消息但未能生成可读摘录，请展开「高级」查看调试信息或升级 lark-cli",
                    );
                  } else {
                    appendMessage(
                      "assistant",
                      "拉取到消息记录但未能生成可读摘录。请展开下方折叠区对照调试信息，或确认 lark-cli 版本与接口返回格式。",
                      {
                        debugFoldText: pullDebugReports.join("\n\n---\n\n"),
                      },
                    );
                  }
                  return;
                }

                if (
                  focusKw &&
                  allLines.length < totalMsgsPulled &&
                  !simple
                ) {
                  appendMessage(
                    "assistant",
                    `已按「${focusKw}」筛选发送者或正文：保留 ${allLines.length} / 约 ${totalMsgsPulled} 条消息将交给助手处理。`,
                  );
                }
                const linesForAi = allLines;
                const source = linesForAi.join("\n\n").trim();

                const docTitle =
                  summaryParams.docTitle.trim() ||
                  (focusKw
                    ? `群聊-${focusKw}-${new Date().toISOString().slice(0, 10)}`
                    : `群聊整理-${new Date().toISOString().slice(0, 10)}`);
                if (simple) {
                  setSmartLine(
                    "running",
                    "正在调用智能助手生成文档…",
                    `已整理 ${linesForAi.length} 条消息片段`,
                  );
                } else {
                  appendMessage(
                    "assistant",
                    `共 ${linesForAi.length} 条消息片段已整理，正在调用智能助手生成「${docTitle}」…`,
                  );
                }
                let clipped = source.slice(0, 100_000);
                if (note) {
                  clipped =
                    `【用户补充说明】\n${note}\n\n---\n\n${clipped}`;
                }
                const noteTrim = note.trim();
                const taskPreamble = noteTrim
                  ? "摘录开头附有【用户补充说明】：请将其视为本次任务的**主需求**（可以是纪要、待办清单、时间线、翻译、邮件/汇报草稿、风险梳理、针对某个问题的问答等）。在严格遵守摘录事实的前提下尽量满足；输出格式、语气与篇幅以说明为准；若说明与下列默认结构冲突，以说明为准。"
                  : "用户未写补充说明时：请将摘录整理成**结构化 Markdown 纪要**，包含主题脉络、关键结论、待办与负责人（若有）、风险与阻塞、需跟进问题；表述简洁，勿编造聊天里未出现的事实。";
                const sysSimple = focusKw
                  ? `你是企业效率助手。${taskPreamble}\n用户关注的对象为「${focusKw}」。下面是飞书群聊摘录（已按发送者昵称/姓名/id 或正文做消息级筛选；勿编造未出现的事实）。在落实主需求的同时，建议覆盖：与该对象**直接相关**的讨论要点、关键结论；如适用可含待办表格（| 事项 | 建议负责人 | 说明 |）与风险/阻塞。若摘录与「${focusKw}」几乎无关，请在文首用一句话说明。`
                  : `你是企业效率助手。${taskPreamble}\n下面是一段按时间排序的飞书群聊摘录。`;
                const sysFull = focusKw
                  ? `你是企业效率助手。${taskPreamble}\n服务对象为「${focusKw}」，摘录已按发送者或正文筛选。输出 Markdown：围绕该对象落实主需求；若未指定格式，可含主题脉络、关键结论、待办表格（| 事项 | 负责人 | 说明 |）、风险与需跟进；勿编造。若明显无关请在文首说明。`
                  : `你是企业效率助手。${taskPreamble}\n下列为飞书群聊摘录。`;
                const summary = await askAI(
                  !fullWorkbenchModeRef.current ? sysSimple : sysFull,
                  clipped,
                );
                setLastChatSummaryExport({ title: docTitle, markdown: summary });
                const created = await executeDocsCreate(docTitle, summary, 90000);
                if (simple) {
                  if (created.exitCode !== 0) {
                    setSmartLine(
                      "err",
                      "文档未创建",
                      friendlyCliSummary(created).slice(0, 220),
                    );
                  } else {
                    setSmartLine("idle", "就绪");
                    setSimpleChatSummaryComposer("");
                  }
                } else {
                  appendMessage(
                    "assistant",
                    `已经在飞书里建好文档 ✨\n\n${friendlyCliSummary(created)}`,
                    { cli: created },
                  );
                  appendMessage(
                    "assistant",
                    `📄 文档正文：\n\n${summary}\n\n---\n可使用顶部「下载 Markdown」保存到本地。`,
                  );
                }
                try {
                  localStorage.setItem(
                    LS_WORKBENCH_CHAT_PULL,
                    JSON.stringify({
                      chatIds: chatPullParams.chatIds,
                      chatId: chatPullParams.chatId,
                      hoursBack: chatPullParams.hoursBack,
                      timeMode: chatPullParams.timeMode,
                      customRangeStart: chatPullParams.customRangeStart,
                      customRangeEnd: chatPullParams.customRangeEnd,
                      imAs: chatPullParams.imAs,
                      focusKeyword: chatPullParams.focusKeyword.trim(),
                    }),
                  );
                } catch {
                  /* ignore */
                }
    };

    const renderChatPullFooter = () => (
      <>
        {chatsListError ? (
          <div className="mb-2 space-y-2">
            <p className="text-xs text-red-600 leading-relaxed">{chatsListError}</p>
            {imWorkbenchAuthSupplementSuggested(chatsListError) && (
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap gap-2 items-center">
                  <Btn
                    size="sm"
                    variant="primary"
                    disabled={authRunning}
                    onClick={() => {
                      setActiveTab("auth");
                      runStreamingAuth(
                        LARK_AUTH_SUPPLEMENT_IM_MESSAGES_AS_USER_CMD,
                      );
                    }}
                  >
                    {authRunning
                      ? "⏳ 等待浏览器授权…"
                      : "补充读群/单聊消息（三项 scope）"}
                  </Btn>
                  <Btn
                    size="sm"
                    variant="ghost"
                    disabled={authRunning}
                    onClick={() => {
                      setActiveTab("auth");
                      runStreamingAuth(LARK_AUTH_SUPPLEMENT_IM_CHAT_LIST_CMD);
                    }}
                  >
                    仅补群列表 im:chat:read
                  </Btn>
                </div>
                <span className="text-[11px] text-gray-500">
                  拉消息失败请优先点「三项 scope」；完成后回到本页再试。
                </span>
              </div>
            )}
          </div>
        ) : null}
        {fullWorkbenchMode && (
        <details
          className={`mb-3 rounded-xl text-xs text-gray-700 ${
            fullWorkbenchMode
              ? "border border-gray-200 bg-gray-50/80"
              : "border border-dashed border-gray-200/70 bg-gray-50/40"
          }`}
        >
          <summary
            className={`cursor-pointer list-none select-none px-3 py-2 font-medium text-gray-700 hover:bg-white/50 rounded-xl [&::-webkit-details-marker]:hidden ${
              fullWorkbenchMode
                ? "flex flex-col gap-0.5 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
                : "flex items-center justify-between"
            }`}
          >
            {fullWorkbenchMode ? (
              <>
                <span className="text-gray-800">更多选项与说明</span>
                <span className="text-[10px] font-normal text-gray-500 sm:text-right">
                  群来源 · 关键词 · 手动会话 ID · 权限与常见问题
                </span>
              </>
            ) : (
              <span className="text-[11px] font-normal text-gray-500">
                高级 · 机器人 / 用户 · 关键词 · 手动 oc_ · 权限帮助
              </span>
            )}
          </summary>
          <div className="px-3 pb-3 space-y-4 border-t border-gray-200/80 pt-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">
                  群列表来源
                </label>
                <div className="flex rounded-xl border border-gray-200 overflow-hidden text-xs font-medium">
                  <button
                    type="button"
                    onClick={() =>
                      setChatPullParams((p) => ({
                        ...p,
                        imAs: "user",
                        chatId: "",
                        chatIds: [],
                      }))
                    }
                    className={`flex-1 px-3 py-2 transition-colors ${
                      chatPullParams.imAs === "user"
                        ? "bg-blue-600 text-white"
                        : "bg-white text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    我参与的（用户）
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setChatPullParams((p) => ({
                        ...p,
                        imAs: "bot",
                        chatId: "",
                        chatIds: [],
                      }))
                    }
                    className={`flex-1 px-3 py-2 transition-colors border-l border-gray-200 ${
                      chatPullParams.imAs === "bot"
                        ? "bg-violet-600 text-white"
                        : "bg-white text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    机器人所在群
                  </button>
                </div>
                <p className="text-[10px] text-gray-500 mt-1 leading-snug">
                  列表与拉消息用同一身份（
                  <code className="text-[10px] bg-white/90 px-0.5 rounded">
                    --as user|bot
                  </code>
                  ）。用户模式不要求机器人在群内。
                </p>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">
                  服务对象 / 关键词（选填）
                </label>
                <Input
                  value={chatPullParams.focusKeyword}
                  onChange={(v) =>
                    setChatPullParams((p) => ({ ...p, focusKeyword: v }))
                  }
                  placeholder="例如 tutu：匹配发送者昵称/姓名/id 或正文片段"
                />
                <FieldHint>
                  留空则全群摘录；填写后按<strong>消息</strong>筛选（优先核对发送者在飞书中的显示名）。
                </FieldHint>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">
                列表里没有？手动填写会话 ID（oc_…）
              </label>
              <Input
                value={chatPullParams.chatId}
                onChange={(v) =>
                  setChatPullParams((p) => ({ ...p, chatId: v }))
                }
                placeholder="单个或多个 oc_…，英文逗号或换行分隔"
              />
            </div>
            <FieldHint>
              群列表与客户端「全部群」可能略有差异；读消息会自动翻页（最多约 1000
              条）。若报{" "}
              <code className="text-[10px]">missing_scope</code>，可在「连接飞书」里补充「读群/单聊消息」权限，与终端{" "}
              <code className="text-[10px]">lark-cli auth login --scope</code>{" "}
              提示一致。
            </FieldHint>
            <details className="rounded-lg border border-gray-100 bg-white/90 px-3 py-2 text-[11px] text-gray-700 leading-relaxed">
              <summary className="cursor-pointer font-medium text-gray-800 select-none">
                机器人不在群里，还能拉到记录吗？
              </summary>
              <p className="mt-2">
                用「用户」身份读历史时，不依赖机器人是否在群内；但登录授权的那个<strong>真人账号</strong>必须在群（或有读权限）。
              </p>
              <p className="mt-2">
                本人不在群则无法代读；可请群主加群，或由同事导出记录后在「完整功能」里粘贴总结。
              </p>
              <p className="mt-2">
                机器人收新消息一般需拉进群并配事件订阅；历史拉取仍以有权限的成员身份为主。
              </p>
            </details>
            <details className="rounded-lg border border-amber-100 bg-amber-50/60 px-3 py-2 text-[11px] text-amber-950 leading-relaxed">
              <summary className="cursor-pointer font-medium select-none">
                一直报权限问题？（missing_scope / 99991679）给管理员看
              </summary>
              <ol className="mt-2 list-decimal list-inside space-y-1.5 pl-0.5">
                <li>
                  在{" "}
                  <a
                    href="https://open.feishu.cn/app/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-700 underline underline-offset-2"
                  >
                    open.feishu.cn/app
                  </a>{" "}
                  打开应用 → 权限管理 → 勾选读消息相关用户权限（如{" "}
                  <code className="text-[10px]">group_msg:get_as_user</code>、
                  <code className="text-[10px]">p2p_msg:get_as_user</code>、
                  <code className="text-[10px]">contact:user.base:readonly</code>
                  ）。
                </li>
                <li>若企业要求「发版」，请发版后让用户重新授权。</li>
                <li>
                  若错误为{" "}
                  <code className="text-[10px]">Permission denied [99991679]</code>
                  ，多为可用范围或 token：完整重登后再试。
                </li>
                <li>
                  补充授权命令：{" "}
                  <code className="block mt-1 whitespace-pre-wrap break-all rounded bg-white/90 px-2 py-1 text-[10px] text-gray-800 border border-amber-200/80">
                    {LARK_AUTH_SUPPLEMENT_IM_MESSAGES_AS_USER_CMD}
                  </code>
                </li>
              </ol>
            </details>
          </div>
        </details>
        )}
        <div
          className={
            fullWorkbenchMode ? "mt-1 flex flex-wrap gap-2" : "mt-0 flex flex-col gap-2"
          }
        >
          {fullWorkbenchMode ? (
            <Btn
              variant="primary"
              disabled={loading}
              onClick={() => {
                chatSummaryUserNoteRef.current = "";
                void runFlow("工作群聊天记录", runWorkbenchChatPullSummary);
              }}
            >
              拉取群聊并生成文档
            </Btn>
          ) : (
            <form
              className="flex w-full flex-col gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                if (loading) return;
                chatSummaryUserNoteRef.current =
                  simpleChatSummaryComposer.trim();
                void runFlow("工作群聊天记录", runWorkbenchChatPullSummary);
              }}
            >
              <label className="text-[11px] font-medium leading-snug text-slate-600">
                说明你想怎么处理这段群聊（选填）
              </label>
              <textarea
                value={simpleChatSummaryComposer}
                onChange={(e) => setSimpleChatSummaryComposer(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey)) return;
                  e.preventDefault();
                  if (loading) return;
                  chatSummaryUserNoteRef.current =
                    simpleChatSummaryComposer.trim();
                  void runFlow("工作群聊天记录", runWorkbenchChatPullSummary);
                }}
                disabled={loading}
                rows={3}
                placeholder="例如：只做待办表；整理成时间线；翻译成英文；写一封给老板的汇报邮件；提取争议点与风险…（可换行 · ⌘↵ 或 Ctrl+↵ 也可发送）"
                className="min-h-[3.5rem] w-full resize-y rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] leading-snug text-slate-800 shadow-sm placeholder:text-[11px] placeholder:leading-snug placeholder:text-slate-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:opacity-50"
              />
              <p className="text-[10px] leading-snug text-slate-400">
                群与时间在上方选好；这里用自然语言写希望助手做的事（筛选某人、只要待办、翻译等都可以写进说明里）。
              </p>
              <Btn
                type="submit"
                variant="primary"
                className="!flex w-full justify-center rounded-lg py-2 text-xs font-semibold shadow-sm"
                disabled={loading}
              >
                {loading ? "执行中…" : "发送并拉取处理"}
              </Btn>
            </form>
          )}
        </div>

      </>
    );
    return (
    <div
      className={`flex flex-col gap-4 ${fullWorkbenchMode ? "" : "h-full min-h-0 min-w-0 flex-1"}`}
    >
      {fullWorkbenchMode && (
        <details className="bg-sky-50 border border-sky-100 rounded-2xl px-4 py-3 text-sm open:pb-4">
          <summary className="font-medium text-sky-900 cursor-pointer select-none list-none flex items-center gap-2 [&::-webkit-details-marker]:hidden">
            <span>📖</span>
            <span>还有不明白的？点我展开说明</span>
          </summary>
          <ol className="mt-3 space-y-2.5 text-xs text-sky-900/90 pl-1 list-decimal list-inside leading-relaxed">
            <li>
              飞书相关功能都要先<strong>连上你的飞书账号</strong>：点页面最上面「①
              连接我的飞书」或左侧「连接飞书」。
            </li>
            <li>
              「总结、周报、待办拆解」会用到<strong>智能助手</strong>：和网站首页聊天用的是同一套设置，点顶部「②
              去设置里连接智能助手」按页面填空即可。
            </li>
            <li>
              若按钮点了没反应，点顶部「③
              检测本机是否正常」。
            </li>
            <li>
              下面灰色小字是补充说明；真正出错时，对话里会告诉你要改哪一步。
            </li>
          </ol>
        </details>
      )}

      {/* 粘贴总结：仅「完整功能」模式；简洁版只做群聊拉取 */}
      {fullWorkbenchMode && (
        <Card>
          <div className="flex items-start gap-3 mb-3">
            <span className="text-xl">📝</span>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-gray-900 text-sm">
                自动总结并建文档
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">
                适合：会议纪要、聊天记录、长文章 — 粘贴文字后一键生成飞书云文档
              </p>
            </div>
          </div>
          <div className="mb-3">
            <label className="text-xs font-medium text-gray-600 block mb-1">
              文档标题
            </label>
            <Input
              value={summaryParams.docTitle}
              onChange={(v) => setSummaryParams((p) => ({ ...p, docTitle: v }))}
              placeholder="例如：项目周会纪要-4月"
            />
          </div>
          <label className="text-xs font-medium text-gray-600 block mb-1">
            要总结的正文
          </label>
          <Textarea
            value={summaryParams.sourceText}
            onChange={(v) => setSummaryParams((p) => ({ ...p, sourceText: v }))}
            placeholder="把要总结的内容粘贴到这里…"
            rows={5}
          />
          <FieldHint>
            内容越长，等待越久；失败时可少贴一点或稍后再试。成功后到飞书「云文档」里能看到新文档。
          </FieldHint>
          <div className="mt-3">
            <Btn
              variant="primary"
              disabled={loading}
              onClick={() =>
                runFlow("自动总结并建文档", async () => {
                  const source = summaryParams.sourceText.trim();
                  if (!source) {
                    appendMessage(
                      "assistant",
                      "⚠️ 请先在上方输入框里粘贴要总结的文字，再点按钮。",
                    );
                    return;
                  }
                  appendMessage("assistant", "正在帮你整理内容，请稍等片刻…");
                  const summary = await askAI(
                    "你是企业效率助手。请将输入内容总结成结构化 Markdown，包含：关键结论、待办事项、风险与建议，要求简洁清晰。",
                    source,
                  );
                  const docTitle =
                    summaryParams.docTitle.trim() ||
                    `AI总结-${new Date().toISOString().slice(0, 10)}`;
                  const created = await executeDocsCreate(
                    docTitle,
                    summary,
                    90000,
                  );
                  appendMessage(
                    "assistant",
                    `已经在飞书里建好文档啦 ✨\n\n${friendlyCliSummary(created)}`,
                    { cli: created },
                  );
                  appendMessage(
                    "assistant",
                    `📄 帮你整理好的正文：\n\n${summary}`,
                  );
                })
              }
            >
              ✨ 一键总结并建文档
            </Btn>
          </div>
        </Card>
      )}

      {fullWorkbenchMode ? (
        <Card>
          <>
            <div className="flex items-start gap-3 mb-2">
              <span className="text-xl">💬</span>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-gray-900 text-sm">
                  工作群聊天记录 → 拉取并生成文档
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  选群、时间，点按钮；详细机制见下方「更多选项与说明」。
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <Btn
                size="sm"
                variant="ghost"
                disabled={loading || chatsListLoading || !authPersonalConnected}
                onClick={() => void loadMyChats({ silent: false })}
              >
                {chatsListLoading ? "正在同步…" : "刷新群列表"}
              </Btn>
              {!authPersonalConnected && (
                <span className="text-[11px] text-amber-700">
                  请先完成「连接飞书」
                </span>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-2">
              {renderChatPullPickers("full")}
            </div>
          </>
        {renderChatPullFooter()}
        </Card>
      ) : (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 lg:grid lg:h-full lg:min-h-0 lg:min-w-0 lg:grid-cols-1 lg:grid-cols-[minmax(12.5rem,19vw)_1fr] lg:grid-rows-1 lg:items-stretch lg:gap-6">
          <aside className="order-1 flex min-h-0 min-w-0 flex-col overflow-y-auto lg:h-full lg:min-h-0">
            <div className="flex min-h-0 w-full flex-col rounded-2xl border border-slate-200/75 bg-gradient-to-b from-white via-white to-slate-50/90 p-3 shadow-sm ring-1 ring-slate-900/[0.04] lg:min-h-0 lg:flex-1">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-xs font-semibold tracking-tight text-slate-800">
                  群聊整理
                </span>
                <div className="ml-auto flex items-center gap-1">
                  <button
                    type="button"
                    title="同步群列表"
                    aria-label="同步群列表"
                    disabled={loading || chatsListLoading || !authPersonalConnected}
                    onClick={() => void loadMyChats({ silent: false })}
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200/90 bg-white text-base text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                  >
                    {chatsListLoading ? (
                      <span
                        className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-400 border-t-transparent"
                        aria-hidden
                      />
                    ) : (
                      <span aria-hidden>↻</span>
                    )}
                  </button>
                </div>
              </div>

              <details className="group rounded-xl border border-slate-200/80 bg-white/80 open:border-slate-300/90 open:bg-white open:shadow-sm">
                <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-2 py-2 text-left text-[12px] text-slate-700 transition hover:bg-slate-50/90 [&::-webkit-details-marker]:hidden">
                  <span
                    key={simpleChatPullContext.summaryKey}
                    className="min-w-0 flex-1 truncate font-medium text-slate-900"
                  >
                    {simpleChatPullContext.name}
                  </span>
                  <span className="shrink-0 text-slate-300">·</span>
                  <span
                    key={`${simpleChatPullContext.summaryKey}-range`}
                    className="shrink-0 whitespace-nowrap text-slate-500"
                  >
                    {simpleChatPullContext.rangeLabel}
                  </span>
                  <span
                    className="shrink-0 text-[10px] text-slate-400 transition-transform group-open:rotate-180"
                    aria-hidden
                  >
                    ▾
                  </span>
                </summary>
                <div className="space-y-2.5 border-t border-slate-100 px-2 pb-3 pt-2.5">
                  {renderChatPullPickers("simple")}
                  {!authPersonalConnected ? (
                    <p className="text-[11px] leading-snug text-amber-800">
                      需先完成飞书连接
                    </p>
                  ) : null}
                </div>
              </details>

              <div className="mt-3 min-h-0 flex-1">{renderChatPullFooter()}</div>
            </div>
          </aside>

          <section className="order-2 flex min-h-[15rem] min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-md shadow-slate-900/[0.05] ring-1 ring-slate-900/[0.03] lg:h-full lg:min-h-0 lg:min-w-0">
            <header className="flex shrink-0 items-center gap-3 border-b border-slate-100 bg-gradient-to-r from-slate-50/95 via-white to-white px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  预览
                </p>
                <p className="truncate text-sm font-semibold text-slate-900">
                  {lastChatSummaryExport?.title ?? "尚无文档"}
                </p>
              </div>
              {!loading && lastChatSummaryExport ? (
                <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-800">
                  已生成
                </span>
              ) : null}
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-slate-50/50 overscroll-contain">
              {loading ? (
                <div className="flex min-h-[12rem] flex-col items-center justify-center gap-3 px-6 text-sm text-slate-500">
                  <span
                    className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent"
                    aria-hidden
                  />
                  正在拉取消息并由助手生成文档，请稍候…
                </div>
              ) : lastChatSummaryExport ? (
                <div
                  ref={summaryPreviewExportRef}
                  className="break-words px-4 py-4 text-slate-900 [overflow-wrap:anywhere]"
                >
                  <MarkdownSummaryPreview
                    markdown={lastChatSummaryExport.markdown}
                  />
                </div>
              ) : (
                <div className="flex min-h-[12rem] flex-col items-center justify-center gap-2 px-8 text-center">
                  <p className="text-sm font-medium text-slate-600">尚无预览</p>
                  <p className="max-w-sm text-[13px] leading-relaxed text-slate-400">
                    在左侧写好需求说明并点「发送并拉取处理」后，正文会出现在这里（与顶部「最新产出」一致）。
                  </p>
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {fullWorkbenchMode && (
        <details className="bg-gray-50 border border-gray-100 rounded-2xl px-4 py-3 text-xs text-gray-700">
          <summary className="font-medium text-gray-800 cursor-pointer select-none">
            想「消息一到就自动总结」？（事件订阅说明）
          </summary>
          <p className="mt-2 leading-relaxed">
            本页面每次点击只会短时执行命令，<strong>不能</strong>像客户端一样常驻监听。
            若要实时处理：可在<strong>长期运行的服务器</strong>上使用{" "}
            <code className="text-[11px] bg-white px-1 rounded border">
              lark-cli event
            </code>{" "}
            订阅 IM 事件（如 <code className="text-[11px]">im.message.receive_v1</code>
            ），收到事件后调用你们的后端，再调 AI 写文档或发群卡片；或在飞书开放平台配置「事件订阅」指向自建
            Webhook。工作群常见做法是把<strong>机器人拉进群</strong>并开通读消息权限，由后端消费事件队列。
          </p>
        </details>
      )}

      {fullWorkbenchMode && (
        <>
      {/* Meeting → Todos */}
      <Card>
        <div className="flex items-start gap-3 mb-4">
          <span className="text-xl">🎥</span>
          <div>
            <h3 className="font-semibold text-gray-900 text-sm">
              会议纪要 → 自动拆解待办
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              按日期拉会议与纪要 → 自动列出待办 → 可选写入飞书任务
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-2">
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">
              开始日期
            </label>
            <Input
              value={meetingTodosParams.vcStart}
              onChange={(v) =>
                setMeetingTodosParams((p) => ({ ...p, vcStart: v }))
              }
              placeholder="2026-04-07"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">
              结束日期
            </label>
            <Input
              value={meetingTodosParams.vcEnd}
              onChange={(v) =>
                setMeetingTodosParams((p) => ({ ...p, vcEnd: v }))
              }
              placeholder="2026-04-14"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">
              自动建任务给谁（选填）
            </label>
            <Input
              value={meetingTodosParams.assigneeId}
              onChange={(v) =>
                setMeetingTodosParams((p) => ({ ...p, assigneeId: v }))
              }
              placeholder="留空 = 只出清单，不创建任务"
            />
          </div>
        </div>
        <FieldHint>
          第三栏<strong>可空</strong>：空着就只给你待办清单，自己复制到飞书也行。只有想「自动写进飞书任务」时才填：到左边「找人」搜同事，把结果里<strong>以
          ou 开头的一长串编号</strong>粘贴过来。
        </FieldHint>
        <div className="mt-3">
          <Btn variant="success" disabled={loading} onClick={runMeetingToTodos}>
            🚀 拉会议并拆解待办
          </Btn>
        </div>
      </Card>

      {/* Weekly Report */}
      <Card>
        <div className="flex items-start gap-3 mb-4">
          <span className="text-xl">📊</span>
          <div>
            <h3 className="font-semibold text-gray-900 text-sm">
              工作报告（AI 整理）
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              自动汇总近 30 天日程、任务、会议 → 生成飞书文档；需要时再发到群
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-2">
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">
              周报文档标题
            </label>
            <Input
              value={weeklyReportParams.docTitle}
              onChange={(v) =>
                setWeeklyReportParams((p) => ({ ...p, docTitle: v }))
              }
              placeholder="例如：工作周报-第15周"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">
              要自动发到群里吗（一般不用填）
            </label>
            <Input
              value={weeklyReportParams.sendChatId}
              onChange={(v) =>
                setWeeklyReportParams((p) => ({ ...p, sendChatId: v }))
              }
              placeholder="留空：只生成文档，不自动群发"
            />
          </div>
        </div>
        <FieldHint>
          大多数人<strong>留空即可</strong>。只有公司已配好「机器人群通知」时，才向管理员要「群编号」填这里。
        </FieldHint>
        <div className="mt-3">
          <Btn variant="success" disabled={loading} onClick={runWeeklyReport}>
            🚀 生成工作报告（近 30 天数据）
          </Btn>
        </div>
      </Card>

      {/* Deadline Alert */}
      <Card>
        <div className="flex items-start gap-3 mb-4">
          <span className="text-xl">⏰</span>
          <div>
            <h3 className="font-semibold text-gray-900 text-sm">
              任务截止预警
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              看看未来几天哪些事快到期 → 自动排优先级 → 可发到群提醒同事
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-2">
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">
              往后看多少小时
            </label>
            <Input
              value={deadlineAlertParams.hoursAhead}
              onChange={(v) =>
                setDeadlineAlertParams((p) => ({ ...p, hoursAhead: v }))
              }
              placeholder="默认 48（两天内）"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">
              要自动发到群里吗（一般不用填）
            </label>
            <Input
              value={deadlineAlertParams.alertChatId}
              onChange={(v) =>
                setDeadlineAlertParams((p) => ({ ...p, alertChatId: v }))
              }
              placeholder="留空：只在下面对话里显示，可复制到飞书"
            />
          </div>
        </div>
        <FieldHint>
          不填时会把整理好的文字显示在对话里，你手动转发即可。填「群编号」需要公司提前配好机器人，再问管理员要。
        </FieldHint>
        <div className="mt-3">
          <Btn variant="warning" disabled={loading} onClick={runDeadlineAlert}>
            🚀 扫描并整理截止任务
          </Btn>
        </div>
      </Card>

      {/* Scheduling */}
      <Card>
        <div className="flex items-start gap-3 mb-4">
          <span className="text-xl">🗓️</span>
          <div>
            <h3 className="font-semibold text-gray-900 text-sm">
              排期协调助手
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              写同事中文名（和通讯录一致）→ 查大家什么时候有空 → 给出几个开会时段备选
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-2">
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">
              参与人姓名
            </label>
            <Input
              value={schedulingParams.attendeeNames}
              onChange={(v) =>
                setSchedulingParams((p) => ({ ...p, attendeeNames: v }))
              }
              placeholder="张三, 李四（用逗号分隔）"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">
              会议时长（分钟）
            </label>
            <Input
              value={schedulingParams.durationMin}
              onChange={(v) =>
                setSchedulingParams((p) => ({ ...p, durationMin: v }))
              }
              placeholder="默认 30"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">
              从哪天开始查
            </label>
            <Input
              value={schedulingParams.windowStart}
              onChange={(v) =>
                setSchedulingParams((p) => ({ ...p, windowStart: v }))
              }
              placeholder="YYYY-MM-DD"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">
              查到哪天为止
            </label>
            <Input
              value={schedulingParams.windowEnd}
              onChange={(v) =>
                setSchedulingParams((p) => ({ ...p, windowEnd: v }))
              }
              placeholder="YYYY-MM-DD"
            />
          </div>
        </div>
        <FieldHint>
          若提示搜不到人，请去「通讯录」核对姓名；推荐时段仅供参考，可在「日历」里再创建日程。
        </FieldHint>
        <div className="mt-3">
          <Btn
            variant="primary"
            disabled={loading}
            onClick={runSchedulingAssistant}
          >
            🚀 查忙闲并推荐时间
          </Btn>
        </div>
      </Card>

      {/* Today / multi-day brief */}
      <Card>
        <div className="flex items-start gap-3 mb-4">
          <span className="text-xl">☀️</span>
          <div>
            <h3 className="font-semibold text-gray-900 text-sm">
              工作简报（直连飞书）
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              不用 AI，按时间范围自动拉日程、任务、会议；连接成功时也会自动拉近 30 天。
            </p>
          </div>
        </div>
        <FieldHint>
          点一次即可，结果在下方对话区。需要更长窗口可点「近 90 天」。
        </FieldHint>
        <div className="mt-3 flex flex-wrap gap-2">
          <Btn
            disabled={loading}
            onClick={() => {
              const now = new Date();
              const start = new Date(now);
              start.setHours(0, 0, 0, 0);
              const end = new Date(now);
              end.setHours(23, 59, 59, 999);
              const dueEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
                .toISOString()
                .slice(0, 10);
              runBatch("今日工作简报", [
                `lark-cli calendar +agenda --as user --start "${start.toISOString()}" --end "${end.toISOString()}" --format table`,
                `lark-cli task +get-my-tasks --as user --due-start "${now.toISOString().slice(0, 10)}" --due-end "${dueEnd}" --format table`,
                `lark-cli vc +search --as user --start "${now.toISOString().slice(0, 10)}" --end "${now.toISOString().slice(0, 10)}" --format table`,
              ]);
            }}
          >
            今天
          </Btn>
          <Btn
            disabled={loading}
            onClick={() => runRecentLarkDataPull(7, "同步近 7 天数据")}
          >
            近 7 天
          </Btn>
          <Btn
            variant="primary"
            disabled={loading}
            onClick={() => runRecentLarkDataPull(30, "同步近 30 天数据")}
          >
            近 30 天
          </Btn>
          <Btn
            disabled={loading}
            onClick={() => runRecentLarkDataPull(90, "同步近 90 天数据")}
          >
            近 90 天
          </Btn>
        </div>
      </Card>
        </>
      )}
    </div>
  );
  };

  const tabPanels: Record<TabId, () => React.ReactNode> = {
    auth: renderAuth,
    meal: () => <MealReceiptWorkbench embedded />,
    ops: () => <OpsPanel />,
    smart: renderSmartAssistant,
    docHub: renderDocHub,
    devReport: renderDevReport,
    tapdBug: renderTapdBug,
    tapdStats: renderTapdStats,
    vote: renderVote,
    docs: renderDocs,
    sheets: renderSheets,
    calendar: renderCalendar,
    tasks: renderTasks,
    im: renderIM,
    mail: renderMail,
    vc: renderVC,
    contact: renderContact,
    drive: renderDrive,
  };

  // ─── Layout ──────────────────────────────────────────────────────────────────

  return (
    <div className="h-screen flex flex-col bg-gray-50 overflow-hidden">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 px-4 sm:px-6 py-3 flex items-center gap-3 shrink-0">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold text-sm shrink-0">
          L
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="font-semibold text-gray-900 text-sm leading-none flex flex-wrap items-center gap-2">
            飞书工作台
            {!fullWorkbenchMode ? (
              authPersonalConnected ? (
                <span className="text-[11px] font-medium text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full">
                  飞书已连接
                </span>
              ) : (
                <span className="text-[11px] font-medium text-amber-900 bg-amber-50 border border-amber-200/90 px-2 py-0.5 rounded-full">
                  飞书未连接
                </span>
              )
            ) : (
              authPersonalConnected && (
                <span className="text-[11px] font-medium text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full">
                  飞书已连接
                </span>
              )
            )}
          </h1>
          {fullWorkbenchMode && (
            <p className="text-xs text-gray-500 mt-0.5 truncate sm:whitespace-normal">
              {authPersonalConnected
                ? "已就绪，可直接用左侧功能"
                : "先完成下方「连接飞书」，其余功能即可使用"}
            </p>
          )}
        </div>
        <div className="ml-auto shrink-0 flex items-center gap-2">
          {!fullWorkbenchMode && !authPersonalConnected && (
            <button
              type="button"
              onClick={() => setActiveTab("auth")}
              className="inline-flex text-xs font-medium text-amber-900 bg-amber-100 hover:bg-amber-200/90 px-2.5 py-1 rounded-lg border border-amber-300/80 shrink-0"
            >
              去连接
            </button>
          )}
          {!fullWorkbenchMode ? (
            <Link
              href="/lark-cli?mode=full"
              className="inline-flex text-xs font-medium text-violet-700 hover:text-violet-900 px-2 py-1 rounded-lg hover:bg-violet-50 border border-violet-200/80 shrink-0"
            >
              完整功能
            </Link>
          ) : (
            <Link
              href="/lark-cli"
              className="inline-flex text-xs font-medium text-gray-600 hover:text-gray-900 px-2 py-1 rounded-lg hover:bg-gray-100 shrink-0"
            >
              简洁版
            </Link>
          )}
          <Link
            href="/settings#llm-settings"
            className={`text-xs font-medium text-blue-600 hover:text-blue-800 px-2 py-1 rounded-lg hover:bg-blue-50 shrink-0 ${
              fullWorkbenchMode ? "hidden sm:inline-flex" : "inline-flex"
            }`}
          >
            设置
          </Link>
          {loading &&
            (fullWorkbenchMode ||
              (activeTab !== "smart" &&
                activeTab !== "meal" &&
                activeTab !== "ops")) && (
              <span className="flex items-center gap-1.5 text-xs text-blue-600 bg-blue-50 px-3 py-1.5 rounded-full">
                <svg
                  className="w-3 h-3 animate-spin"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v8z"
                  />
                </svg>
                执行中…
              </span>
            )}
        </div>
      </header>

      {/* 新手配置：仅完整功能模式展示多步引导；简洁版只靠顶栏状态 +「去连接」 */}
      {fullWorkbenchMode && (
        <div className="shrink-0 border-b border-amber-100/90 bg-gradient-to-r from-amber-50 via-orange-50/50 to-rose-50/40 px-4 py-3">
          <p className="text-[13px] font-semibold text-amber-950 mb-2">
            {authPersonalConnected
              ? "飞书已连上，可继续第二步（可选）"
              : "先做这两步，下面功能才好用"}
          </p>
          <div className="flex flex-wrap items-stretch gap-2">
            <button
              type="button"
              onClick={() => setActiveTab("auth")}
              className={`inline-flex items-center justify-center rounded-full px-4 py-2 text-xs font-medium shadow-sm transition-all active:scale-[0.99] ${
                authPersonalConnected
                  ? "bg-emerald-50 border border-emerald-200 text-emerald-900 hover:bg-emerald-100"
                  : "bg-white border border-amber-200 text-amber-950 hover:bg-amber-50 hover:border-amber-300"
              }`}
            >
              {authPersonalConnected ? "① 飞书已连接 ✓" : "① 连接我的飞书"}
            </button>
            <Link
              href="/settings#llm-settings"
              className="inline-flex items-center justify-center rounded-full bg-indigo-600 text-white px-4 py-2 text-xs font-medium shadow-md shadow-indigo-500/20 hover:bg-indigo-700 transition-all active:scale-[0.99]"
            >
              ② 去设置里连接智能助手
            </Link>
            <button
              type="button"
              onClick={() => void quickSelfCheckTools()}
              disabled={loading}
              className="inline-flex items-center justify-center rounded-full border border-rose-200 bg-rose-50 text-rose-900 px-4 py-2 text-xs font-medium hover:bg-rose-100 transition-all active:scale-[0.99] disabled:opacity-40"
            >
              ③ 检测本机是否正常
            </button>
            <Link
              href="/"
              className="inline-flex items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 px-3 py-2 text-xs hover:bg-gray-50"
            >
              回首页
            </Link>
          </div>
        </div>
      )}

      {authAwaitingBrowser && (
        <div className="shrink-0 px-4 py-2 bg-sky-50 border-b border-sky-200 flex flex-wrap items-center gap-3">
          <svg
            className="w-4 h-4 text-sky-600 shrink-0 animate-spin"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8v8z"
            />
          </svg>
          <p className="text-sm text-sky-950 flex-1 min-w-0">
            正在等飞书授权完成，顶部会自动变成「飞书已连接」，一般几秒内就好。
            <button
              type="button"
              onClick={() => void manualRecheckFeishuAuth()}
              className="ml-2 text-xs text-sky-700 underline decoration-sky-300 hover:text-sky-900"
            >
              没变化？
            </button>
          </p>
        </div>
      )}
      {authJustSucceeded && (
        <div
          className="shrink-0 px-4 py-2 bg-emerald-50 border-b border-emerald-200 flex items-center gap-2 text-sm text-emerald-900"
          role="status"
          aria-live="polite"
        >
          <span aria-hidden>✓</span>
          <span className="font-medium">飞书已连接，可以开始用了</span>
        </div>
      )}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Sidebar */}
        <nav className="w-44 shrink-0 bg-white border-r border-gray-100 flex flex-col py-2 gap-0.5 overflow-y-auto">
          {visibleTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-3 py-2.5 text-sm font-medium rounded-xl mx-2 transition-all text-left ${
                activeTab === tab.id
                  ? "bg-blue-50 text-blue-700"
                  : "text-gray-500 hover:bg-gray-50 hover:text-gray-900"
              }`}
            >
              <span className="text-sm">{tab.emoji}</span>
              <span className="truncate">
                {tab.id === "auth" && authPersonalConnected
                  ? "连接飞书 ✓"
                  : tab.label}
              </span>
            </button>
          ))}
        </nav>

        {/* Right: 简洁版顶栏为产出与状态，主区为表单 + 预览（不展示对话气泡，避免挤占版面） */}
        <div className="flex-1 flex flex-col overflow-hidden min-h-0">
          {activeTab === "devReport" ||
          activeTab === "tapdBug" ||
          activeTab === "tapdStats" ||
          activeTab === "vote" ? (
            <div
              className={`flex min-h-0 flex-1 flex-col overflow-hidden bg-gray-50 ${
                activeTab === "tapdBug" ||
                activeTab === "tapdStats" ||
                activeTab === "vote"
                  ? ""
                  : "px-4 py-5 sm:px-6 lg:px-8"
              }`}
            >
              {activeTab === "devReport"
                ? tabPanels.devReport()
                : activeTab === "tapdStats"
                  ? tabPanels.tapdStats()
                  : activeTab === "vote"
                    ? tabPanels.vote()
                    : tabPanels.tapdBug()}
            </div>
          ) : activeTab === "meal" || activeTab === "ops" ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-gray-50 px-4 py-5 sm:px-6 lg:px-8">
              {tabPanels[activeTab]()}
            </div>
          ) : activeTab === "smart" && !fullWorkbenchMode ? (
            <>
              {/* 顶部：下载条 + 状态条（无对话历史，避免反复操作把表单顶出视口） */}
              <div className="shrink-0 flex flex-col border-b border-gray-100 bg-gradient-to-b from-gray-50/80 to-slate-50/60">
                {lastChatSummaryExport ? (
                  <div className="shrink-0 flex flex-wrap items-center justify-between gap-2 border-b border-emerald-100/90 bg-emerald-50/95 px-5 py-2.5">
                    <p className="text-sm text-emerald-950 min-w-0 flex-1 truncate">
                      <span className="font-medium">最新产出</span>
                      <span className="text-emerald-700 mx-1">·</span>
                      <span className="text-emerald-900">
                        {lastChatSummaryExport.title}
                      </span>
                    </p>
                    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          downloadTextFile(
                            `${safeDownloadBasename(lastChatSummaryExport.title)}.md`,
                            lastChatSummaryExport.markdown,
                          )
                        }
                        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
                      >
                        下载 Markdown
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleExportSummaryWord()}
                        className="rounded-lg border border-emerald-300/90 bg-white px-3 py-1.5 text-xs font-medium text-emerald-900 hover:bg-emerald-50/90"
                      >
                        导出 Word
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleExportSummaryPdf()}
                        className="rounded-lg border border-emerald-300/90 bg-white px-3 py-1.5 text-xs font-medium text-emerald-900 hover:bg-emerald-50/90"
                      >
                        导出 PDF
                      </button>
                    </div>
                  </div>
                ) : null}
                <SmartStatusStrip
                  status={smartStatus}
                  onDismiss={dismissSmartStatus}
                />
              </div>
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-b border-gray-100 bg-gray-50 px-5 py-4">
                <div className="min-h-0 flex-1 overflow-hidden">
                  {tabPanels.smart()}
                </div>
              </div>
            </>
          ) : (
            <>
              <div
                className="px-5 py-4 overflow-y-auto border-b border-gray-100 bg-gray-50 shrink-0 min-h-0"
                style={{ maxHeight: "48%" }}
              >
                {tabPanels[activeTab]?.()}
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 flex flex-col gap-5 bg-gradient-to-b from-gray-50/80 to-slate-50/60">
                {activeTab === "smart" && lastChatSummaryExport ? (
                  <div className="sticky top-0 z-10 -mx-5 -mt-4 mb-1 flex flex-wrap items-center justify-between gap-2 border-b border-emerald-100/90 bg-emerald-50/95 px-5 py-2.5 backdrop-blur-sm">
                    <p className="text-sm text-emerald-950 min-w-0 flex-1 truncate">
                      <span className="font-medium">最新产出</span>
                      <span className="text-emerald-700 mx-1">·</span>
                      <span className="text-emerald-900">
                        {lastChatSummaryExport.title}
                      </span>
                    </p>
                    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          downloadTextFile(
                            `${safeDownloadBasename(lastChatSummaryExport.title)}.md`,
                            lastChatSummaryExport.markdown,
                          )
                        }
                        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
                      >
                        下载 Markdown
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleExportSummaryWord()}
                        className="rounded-lg border border-emerald-300/90 bg-white px-3 py-1.5 text-xs font-medium text-emerald-900 hover:bg-emerald-50/90"
                      >
                        导出 Word
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleExportSummaryPdf()}
                        className="rounded-lg border border-emerald-300/90 bg-white px-3 py-1.5 text-xs font-medium text-emerald-900 hover:bg-emerald-50/90"
                      >
                        导出 PDF
                      </button>
                    </div>
                  </div>
                ) : null}
                {messages.map((m) => (
                  <MessageBubble key={m.id} m={m} />
                ))}
              </div>
            </>
          )}

          {/* Input bar（精简模式隐藏，避免干扰「只总结建文档」） */}
          {fullWorkbenchMode && (
            <form
              className="shrink-0 px-5 py-3 border-t border-gray-100 bg-white flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void runCommand(input);
              }}
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="技术人员用：可在此输入命令（新手可留空，用上方面板即可）"
                className="flex-1 rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:bg-white transition"
              />
              <button
                type="submit"
                disabled={loading || !input.trim()}
                className="px-5 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-40 transition"
              >
                执行
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
