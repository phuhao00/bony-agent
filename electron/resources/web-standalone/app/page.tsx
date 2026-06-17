"use client";

import { ChatEmptyHero } from "@/app/components/ChatEmptyHero";
import { ChatNewSessionButton } from "@/app/components/ChatNewSessionButton";
import { TaskRunningIndicator } from "@/components/TaskRunningIndicator";
import { ChatAttachmentMenu } from "@/components/ChatAttachmentMenu";
import { ChatConversationPrefsCards } from "@/components/ChatConversationPrefsCards";
import { ChatWorkspaceContextStrip } from "@/components/ChatWorkspaceContextStrip";
import { ChatWorkspaceFilesPanel } from "@/components/ChatWorkspaceFilesPanel";
import { ClaudeCodePermissionBanner } from "@/components/ClaudeCodePermissionBanner";
import { MarkdownSummaryPreview } from "@/components/MarkdownSummaryPreview";
import {
    MoodPermissionDropdown,
    normalizeMoodPermission,
    patchCompanionMoodPermission,
    type MoodPermission,
} from "@/components/MoodPermissionDropdown";
import { WorkspaceAttachedChips } from "@/components/WorkspaceAttachedChips";
import { useChatSession } from "@/contexts/ChatSessionContext";
import { usePrefs } from "@/contexts/PrefsContext";
import { useTranslation } from "@/hooks/useTranslation";
import { useWorkspaceProjectActive } from "@/hooks/useWorkspaceProjectActive";
import {
    parseA2uiMediaFromContent,
    stripA2uiMediaLines,
} from "@/lib/a2uiMedia";
import type { WorkspaceContextPayload } from "@/lib/agent-chat-types";
import {
    stripAgentModelTrace,
    stripIncompleteAgentTraceDisplay,
    type ParticipationItem,
} from "@/lib/agentModelTrace";
import { getAssistantByAgentId } from "@/lib/assistant-catalog";
import type { ChatMessage, RecipeResultCard, TraceEntry } from "@/lib/chat-message";
import { readSelectedWorkspaceRoot } from "@/lib/workspace-projects";
import { subscribeWorkspaceSelection } from "@/lib/workspace-selection-sync";
import {
    ArrowUp,
    ChevronRight,
    ListTree,
    Mic,
    MicOff,
    SlidersHorizontal,
    Square,
} from "lucide-react";
import Link from "next/link";
import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type RefObject,
} from "react";
import "react-chat-elements/dist/main.css";
import MultimodalInput, {
    AttachedFile,
    type MultimodalInputHandle,
} from "../components/MultimodalInput";
import DefaultLLMProviderSection from "./components/DefaultLLMProviderSection";
import MediaModelSelector from "./components/MediaModelSelector";
import PublishModal from "./components/PublishModal";

type MultiAgentTraceEvent = {
  type: string;
  next_agent?: string;
  agent_id?: string;
  guidance?: string;
  content?: string;
  response?: string;
  provider?: string;
  model?: string;
  trace_id?: string;
  graph_id?: string;
  completed_agents?: string[];
  detail?: string;
  message?: string;
  permission_id?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  title?: string;
  description?: string;
  assistant?: {
    display_name?: string;
    displayName?: string;
    labs_href?: string;
    labsHref?: string;
  } | null;
  task_id?: string;
  status?: string;
  recipe_id?: string;
  recipe_name?: string;
  report?: string;
  error?: string;
};

type TraceEventRecord = {
  timestamp: string;
  type: string;
  detail?: string;
  response?: string;
  content?: string;
  guidance?: string;
  next_agent?: string;
  agent_id?: string;
  completed_agents?: string[];
};

type TraceDetail = {
  id: string;
  status: string;
  input: string;
  created_at: string;
  updated_at: string;
  final_response?: string;
  error?: string | null;
  metadata?: {
    mode?: string;
    provider?: string;
    model?: string;
    completed_agents?: string[];
  };
  events?: TraceEventRecord[];
};

const summarizeTraceText = (text?: string, maxLength = 160) => {
  const normalized = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "";
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength)}...`
    : normalized;
};

const parseSseChunk = (
  chunk: string,
  onEvent: (event: MultiAgentTraceEvent) => void,
) => {
  const blocks = chunk.split("\n\n");
  const rest = blocks.pop() || "";

  for (const block of blocks) {
    const dataLines = block
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => line.slice(6));
    if (!dataLines.length) continue;
    let parsed: MultiAgentTraceEvent;
    try {
      parsed = JSON.parse(dataLines.join("\n"));
    } catch {
      continue;
    }
    onEvent(parsed);
  }

  return rest;
};

// 自定义媒体渲染组件 (A2UI 核心)
const MediaRenderer = ({ content }: { content: string }) => {
  const rawContent = typeof content === "string" ? content : String(content ?? "");
  const safe = stripIncompleteAgentTraceDisplay(stripAgentModelTrace(rawContent).content);

  const reStorageImage =
    /storage[/\\]outputs[/\\]([^\s<>"')]+\.(?:jpg|jpeg|png|gif|webp))/gi;
  const reStorageVideo =
    /storage[/\\]outputs[/\\]([^\s<>"')]+\.(?:mp4|webm|mov|avi))/gi;
  const reMarkdownMedia = /!\[[^\]]*\]\(([^)\s]+)\)/gi;
  const reHttpImage =
    /https?:\/\/[^\s<>"']+\.(?:jpg|jpeg|png|gif|webp)(?:\?[^\s<>"']*)?/gi;
  const reHttpVideo =
    /https?:\/\/[^\s<>"']+\.(?:mp4|webm|mov|avi)(?:\?[^\s<>"']*)?/gi;
  const reBackendMedia = /https?:\/\/127\.0\.0\.1:\d+\/media\/([^\s)"']+)/gi;
  const reBackendMediaPath =
    /\/media\/([^\s"'>\n]+\.(?:jpg|jpeg|png|gif|webp|mp4|webm|mov|avi))/gi;

  const normalizeMarkdownImageUrl = (raw: string): string | null => {
    const inner = raw.trim().replace(/^<|>$/g, "");
    if (!inner || inner === "/" || inner === ".") return null;
    if (
      inner.startsWith("/api/media/") &&
      inner.length > "/api/media/".length + 2
    )
      return inner.split("#")[0];
    if (inner.includes("storage/outputs/") || inner.includes("storage\\outputs\\")) {
      const fn =
        inner.split(/storage[/\\]outputs[/\\]/i)[1]?.split(/[\s)"'\]]/)[0] || "";
      if (/\.(jpg|jpeg|png|gif|webp)$/i.test(fn)) return `/api/media/${fn.replace(/\\/g, "/")}`;
    }
    if (
      /^https?:\/\//i.test(inner) &&
      /\.(jpg|jpeg|png|gif|webp)(?=[\s?)"']|$)/i.test(inner)
    )
      return inner;
    if (/^[a-zA-Z0-9_.-]+\.(jpg|jpeg|png|gif|webp)$/i.test(inner))
      return `/api/media/${inner}`;
    return null;
  };

  const normalizeMarkdownVideoUrl = (raw: string): string | null => {
    const inner = raw.trim().replace(/^<|>$/g, "");
    if (!inner || inner === "/") return null;
    if (inner.startsWith("/api/media/")) return inner;
    if (inner.includes("storage/outputs/") || inner.includes("storage\\outputs\\")) {
      const fn =
        inner.split(/storage[/\\]outputs[/\\]/i)[1]?.split(/[\s)"'\]]/)[0] || "";
      if (/\.(mp4|webm|mov|avi)$/i.test(fn)) return `/api/media/${fn.replace(/\\/g, "/")}`;
    }
    if (
      /^https?:\/\//i.test(inner) &&
      /\.(mp4|webm|mov|avi)(?=[\s?)"']|$)/i.test(inner)
    )
      return inner;
    return null;
  };

  const collectImages = (html: string): string[] => {
    const list: string[] = [];
    const seen = new Set<string>();
    const add = (url: string | null) => {
      if (!url) return;
      const u = url.trim();
      if (!u || u === "/" || /^\/api\/media\/?$/i.test(u)) return;
      const base = (u.split("/").pop() || u).split("?")[0];
      if (!base || base.length < 5) return;
      if (seen.has(base)) return;
      seen.add(base);
      list.push(u);
    };

    const { imageUrls: a2Images } = parseA2uiMediaFromContent(html);
    for (const u of a2Images) add(u);

    for (const m of html.matchAll(reStorageImage)) add(`/api/media/${m[1].replace(/\\/g, "/")}`);
    for (const m of html.matchAll(reMarkdownMedia))
      add(normalizeMarkdownImageUrl(m[1]));
    for (const m of html.matchAll(reHttpImage)) add(m[0]);
    for (const m of html.matchAll(reBackendMedia)) add(`/api/media/${m[1]}`);
    for (const m of html.matchAll(reBackendMediaPath)) add(`/api/media/${m[1].replace(/\\/g, "/")}`);

    return list;
  };

  const collectVideos = (html: string): string[] => {
    const list: string[] = [];
    const seen = new Set<string>();
    const add = (url: string | null) => {
      if (!url) return;
      const u = url.trim();
      if (!u || u === "/") return;
      const base = (u.split("/").pop() || u).split("?")[0];
      if (!base) return;
      if (seen.has(base)) return;
      seen.add(base);
      list.push(u);
    };

    const { videoUrls: a2Videos } = parseA2uiMediaFromContent(html);
    for (const u of a2Videos) add(u);

    for (const m of html.matchAll(reStorageVideo)) add(`/api/media/${m[1].replace(/\\/g, "/")}`);
    for (const m of html.matchAll(reMarkdownMedia))
      add(normalizeMarkdownVideoUrl(m[1]));
    for (const m of html.matchAll(reHttpVideo)) add(m[0]);
    for (const m of html.matchAll(reBackendMedia)) add(`/api/media/${m[1]}`);
    for (const m of html.matchAll(reBackendMediaPath)) add(`/api/media/${m[1].replace(/\\/g, "/")}`);

    /** 工具结果常见「CDN mp4 + 本地下载」两条可同时被正则抓到，basename 不同会漏过去重——有 /api/media 时去掉云厂商冗余外链。 */
    const dropRemoteCdnIfLocalMp4 = (urls: readonly string[]): string[] => {
      const hasLocal = urls.some(
        (x) =>
          x.startsWith("/api/media") &&
          /\.(mp4|webm|mov|avi)$/i.test((x.split("?")[0] ?? "").slice(-96)),
      );
      if (!hasLocal) return [...urls];
      const cdnRe =
        /aliyuncs\.com|dashscope|alibabacloud\.com|volces\.com|open\.bigmodel|amazonaws\.com|cloudfront\.net|blob\.core\.windows\.net|googleapis\.com|googleusercontent/i;
      return urls.filter((u) =>
        /^https?:\/\//i.test(u) ? !cdnRe.test(u) : true,
      );
    };

    return dropRemoteCdnIfLocalMp4(list);
  };

  const images = collectImages(safe);
  const videos = collectVideos(safe);

  const hidePublish = safe.includes("[Step 3] 全平台自动发布结果");

  if (images.length > 0 || videos.length > 0) {
    const textOnly = stripA2uiMediaLines(safe)
      .replace(reStorageImage, "")
      .replace(reStorageVideo, "")
      .replace(reMarkdownMedia, "")
      .replace(reHttpImage, "")
      .replace(reHttpVideo, "")
      .replace(reBackendMedia, "")
      .replace(/!\[[^\]]*\]\(\s*\/?\s*\)/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    return (
      <div className="mt-2 flex flex-col gap-5">
        {textOnly ? (
          <div className="rounded-2xl border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-4 py-3 sm:px-5">
            <MarkdownSummaryPreview markdown={textOnly} />
          </div>
        ) : null}
        {images.map((url, i) => (
          <div
            key={`img-${i}`}
            className="overflow-hidden rounded-[22px] border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] shadow-sm"
          >
            <div className="relative overflow-hidden bg-[var(--page-canvas)]">
              <img
                src={url}
                alt="Generated Content"
                className="max-h-[72vh] w-full object-contain"
              />
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-[color:var(--separator-subtle)] px-4 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--label-secondary)]">
                Image {i + 1}
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={`/media/image-edit?src=${encodeURIComponent(url)}`}
                  className="rounded-full px-2.5 py-1 text-xs font-medium text-[color:var(--accent)] transition-colors hover:bg-[var(--nav-active-fill)]"
                >
                  编辑
                </a>
                {!hidePublish && (
                  <PublishModal content={safe} mediaUrl={url} mediaType="image" />
                )}
              </div>
            </div>
          </div>
        ))}
        {videos.map((url, i) => (
          <div
            key={`vid-${i}`}
            className="overflow-hidden rounded-[22px] border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] shadow-sm"
          >
            <video src={url} controls className="w-full bg-black" />
            <div className="flex items-center justify-between gap-3 border-t border-[color:var(--separator-subtle)] px-4 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--label-secondary)]">
                Video {i + 1}
              </div>
              {!hidePublish && (
                <PublishModal content={safe} mediaUrl={url} mediaType="video" />
              )}
            </div>
          </div>
        ))}
      </div>
    );
  }

  const mdSource = stripA2uiMediaLines(safe).replace(
    /!\[[^\]]*\]\(\s*\/?\s*\)/g,
    "",
  );
  return <MarkdownSummaryPreview markdown={mdSource} />;
};

/** 全部为图片附件且用户意图为生成/编辑/动画时走 agent chat 工具链，而非无工具的 multimodal/chat */
function shouldUseAttachmentToolPath(
  text: string,
  files: AttachedFile[],
  emptyPromptMediaHint: string,
): boolean {
  if (files.length === 0) return false;
  const nonImg = files.filter((f) => f.category !== "image");
  if (nonImg.length > 0) return false;

  const raw = text.trim();
  const ANALYZE_ONLY =
    /^请?(分析|总结|摘要|提炼|看懂|这是什么|读取|抽取|列出|复述|简述|概要|校对|审稿|纠错|翻译成|转成文本|转成markdown|转成MD|转成文字|OCR|ocr)$/i.test(
      raw,
    );
  if (ANALYZE_ONLY) return false;

  const MEDIA_GEN_HINT =
    /生成|画图|制图|绘图|插画|海报|配图|表情包|人像|水印|恶搞|搞笑|GIF|gif|成片|动起来|转成视频|做视频|短视频|視頻|影片|短片|tiktok|img2vid|動畫|animation|[Vv]ideo|[Ii]mage|[Pp]icture|poster|thumbnail|banner|edit|inpaint|img2|img[- ]to[- ]video|[图][转轉換][視视][頻頻]|图生视频/;
  const effective = MEDIA_GEN_HINT.test(raw)
    ? raw
    : raw === ""
      ? emptyPromptMediaHint
      : "";
  if (!effective || !MEDIA_GEN_HINT.test(effective)) return false;
  return true;
}

function ChatSettingsQuickLinks() {
  const { t } = useTranslation();
  const rowClass =
    "card-surface flex items-center gap-3 rounded-xl border border-[color:var(--separator-subtle)] px-3 py-3 transition-colors hover:bg-[var(--nav-active-fill)]";
  return (
    <div className="flex flex-col gap-2">
      <Link
        href="/settings/capabilities?tab=mcp"
        className={rowClass}
      >
        <div className="min-w-0 flex-1 text-left">
          <p className="text-[13px] font-semibold text-[color:var(--foreground)]">
            {t("chat.linkMcpTitle")}
          </p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-[color:var(--label-secondary)]">
            {t("chat.linkMcpDesc")}
          </p>
        </div>
        <ChevronRight
          className="h-4 w-4 shrink-0 text-[color:var(--label-secondary)]"
          strokeWidth={2}
          aria-hidden
        />
      </Link>
      <Link href="/settings/context" className={rowClass}>
        <div className="min-w-0 flex-1 text-left">
          <p className="text-[13px] font-semibold text-[color:var(--foreground)]">
            {t("chat.linkContextTitle")}
          </p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-[color:var(--label-secondary)]">
            {t("chat.linkContextDesc")}
          </p>
        </div>
        <ChevronRight
          className="h-4 w-4 shrink-0 text-[color:var(--label-secondary)]"
          strokeWidth={2}
          aria-hidden
        />
      </Link>
    </div>
  );
}

async function uploadReferenceBlob(file: File): Promise<string> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/chat/upload-reference", {
    method: "POST",
    body: fd,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      (data as { detail?: string }).detail ||
      (data as { error?: string }).error ||
      `${res.status}`;
    throw new Error(msg);
  }
  const url = (data as { public_url?: string }).public_url;
  if (!url) throw new Error("上传成功但未返回 public_url");
  return url as string;
}

type ChatInputToolbarProps = {
  multimodalRef: RefObject<MultimodalInputHandle | null>;
  moodPermission: MoodPermission;
  onMoodPick: (next: MoodPermission) => void;
  chatPermOpen: boolean;
  onChatPermOpenChange: (open: boolean) => void;
  chatPermRef: RefObject<HTMLDivElement | null>;
  /** 贴底输入条：权限菜单向上展开，避免挨近视口底边被裁切 */
  moodPreferMenuAbove?: boolean;
  chatVoiceOn: boolean;
  onVoiceToggle: () => void;
  isLoading: boolean;
  canSubmit: boolean;
  onSubmit: () => void;
  onStop?: () => void;
  submitAriaLabel: string;
  idPrefix: string;
  t: (key: string) => string;
};

function ChatInputToolbar({
  multimodalRef,
  moodPermission,
  onMoodPick,
  chatPermOpen,
  onChatPermOpenChange,
  chatPermRef,
  moodPreferMenuAbove = false,
  chatVoiceOn,
  onVoiceToggle,
  isLoading,
  canSubmit,
  onSubmit,
  onStop,
  submitAriaLabel,
  idPrefix,
  t,
}: ChatInputToolbarProps) {
  return (
    <div className="flex items-center justify-between gap-2 border-t border-[color:var(--separator-subtle)] px-3 py-2 sm:gap-3 sm:px-4">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <ChatAttachmentMenu multimodalRef={multimodalRef} />
        <MoodPermissionDropdown
          value={moodPermission}
          open={chatPermOpen}
          onOpenChange={onChatPermOpenChange}
          onPick={onMoodPick}
          containerRef={chatPermRef}
          triggerId={`${idPrefix}-mood-trigger`}
          menuId={`${idPrefix}-mood-menu`}
          menuVariant="onTheme"
          iconOnlyTrigger
          preferMenuAbove={moodPreferMenuAbove}
          triggerClassName="flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] px-2.5 text-[color:var(--foreground)] shadow-sm transition-colors hover:bg-[var(--nav-active-fill)]"
        />
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          title={t("chat.voiceInputTitle")}
          aria-label={t("chat.voiceInputAria")}
          aria-pressed={chatVoiceOn}
          onClick={onVoiceToggle}
          className={`flex h-9 w-9 items-center justify-center rounded-full transition hover:opacity-90 active:scale-[0.97] ${
            chatVoiceOn
              ? "bg-[color:var(--accent)] text-white shadow-sm"
              : "bg-transparent text-[color:var(--foreground)] hover:bg-[var(--nav-active-fill)]"
          }`}
        >
          {chatVoiceOn ? (
            <MicOff className="h-[1.125rem] w-[1.125rem]" strokeWidth={2} />
          ) : (
            <Mic className="h-[1.125rem] w-[1.125rem]" strokeWidth={2} />
          )}
        </button>
        {isLoading && onStop ? (
          <button
            type="button"
            aria-label={t("chat.stopGenerating")}
            title={t("chat.stopGenerating")}
            onClick={onStop}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[color:var(--accent)] text-white shadow-sm transition hover:opacity-90 active:scale-[0.97]"
          >
            <Square className="h-3.5 w-3.5 fill-current" strokeWidth={0} />
          </button>
        ) : (
          <button
            type="button"
            aria-label={submitAriaLabel}
            title={submitAriaLabel}
            onClick={onSubmit}
            disabled={isLoading || !canSubmit}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--chrome-rail-bg)] text-[color:var(--foreground)] shadow-sm ring-1 ring-[color:var(--separator-subtle)] transition hover:opacity-90 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-35 disabled:ring-0"
          >
            <ArrowUp className="h-4 w-4" strokeWidth={2.25} />
          </button>
        )}
      </div>
    </div>
  );
}

function RecipeResultCards({ cards }: { cards?: RecipeResultCard[] }) {
  if (!cards?.length) return null;
  return (
    <div className="mt-3 space-y-2.5">
      {cards.map((card, index) => (
        <div
          key={`${card.taskId || card.recipeId || card.recipeName || "recipe"}-${index}`}
          className="rounded-2xl border border-[color:color-mix(in_srgb,var(--accent)_24%,transparent)] bg-[color:color-mix(in_srgb,var(--accent)_6%,transparent)] p-3"
        >
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:var(--label-secondary)]">
                {card.assistantName}
              </div>
              <div className="truncate text-sm font-semibold text-[color:var(--foreground)]">
                {card.recipeName || card.recipeId || "Recipe 工作流"}
              </div>
            </div>
            <span className="rounded-full bg-[var(--card-bg)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--label-secondary)] ring-1 ring-[color:var(--separator-subtle)]">
              {card.status || "completed"}
            </span>
          </div>
          {card.error ? (
            <div className="rounded-xl border border-rose-300/50 bg-rose-500/10 px-3 py-2 text-xs leading-5 text-rose-700 dark:text-rose-200">
              {card.error}
            </div>
          ) : card.report ? (
            <details className="rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-3 py-2">
              <summary className="cursor-pointer text-xs font-semibold text-[color:var(--foreground)]">
                查看报告摘要
              </summary>
              <div className="mt-2 max-h-72 overflow-y-auto text-xs leading-5 text-[color:var(--foreground)]">
                <MarkdownSummaryPreview markdown={card.report} />
              </div>
            </details>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-[color:var(--label-secondary)]">
            {card.taskId ? <span>task: {card.taskId}</span> : null}
            {card.labsHref ? (
              <Link
                href={card.labsHref}
                className="font-semibold text-[color:var(--accent)] hover:underline"
              >
                在专业工作台继续编辑
              </Link>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Chat() {
  const { prefs, notify, playSound, verboseLog, saveDraft } = usePrefs();
  const { t } = useTranslation();
  const {
    messages,
    setMessages,
    input,
    setInput,
    isLoading,
    setIsLoading,
    abortRef,
    stopGeneration,
    clearSession,
    sessionEpoch,
    claudePermission,
    setClaudePermission,
    claudePermissionBusy,
    respondClaudePermission,
  } = useChatSession();
  const [currentModel, setCurrentModel] = useState<string>("");
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [workspaceAttachedPaths, setWorkspaceAttachedPaths] = useState<
    string[]
  >([]);
  const [gitBranch, setGitBranch] = useState<string | null>(null);
  const [workspaceRootPath, setWorkspaceRootPath] = useState<string | null>(
    null,
  );
  const [activeTraceId, setActiveTraceId] = useState<string | null>(null);
  const [activeTrace, setActiveTrace] = useState<TraceDetail | null>(null);
  const [traceLoading, setTraceLoading] = useState(false);
  const [traceError, setTraceError] = useState<string>("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const multimodalRef = useRef<MultimodalInputHandle>(null);
  const [modelPanelOpen, setModelPanelOpen] = useState(false);
  const [mobileModelPanelOpen, setMobileModelPanelOpen] = useState(false);
  const [chatRailTab, setChatRailTab] = useState<"files" | "settings">(
    "settings",
  );
  const [isMdLayout, setIsMdLayout] = useState(() =>
    typeof globalThis !== "undefined" &&
    typeof globalThis.matchMedia === "function"
      ? globalThis.matchMedia("(min-width: 768px)").matches
      : true,
  );
  const [moodPermission, setMoodPermission] = useState<MoodPermission>("default");
  const [chatPermOpen, setChatPermOpen] = useState(false);
  const chatPermRef = useRef<HTMLDivElement>(null);
  const [chatVoiceOn, setChatVoiceOn] = useState(false);
  const chatVoiceOnRef = useRef(false);
  const chatRecRef = useRef<{ stop: () => void } | null>(null);
  const [chatVoiceTip, setChatVoiceTip] = useState<string | null>(null);

  useEffect(() => {
    if (sessionEpoch === 0) return;
    setActiveTraceId(null);
    setActiveTrace(null);
    setTraceError("");
    setTraceLoading(false);
    setAttachedFiles([]);
    setWorkspaceAttachedPaths([]);
  }, [sessionEpoch]);

  const openTrace = async (traceId: string) => {
    setActiveTraceId(traceId);
    setActiveTrace(null);
    setTraceError("");
    setTraceLoading(true);
    try {
      const response = await fetch(
        `/api/multi-agent/traces/${encodeURIComponent(traceId)}`,
      );
      const data = await response
        .json()
        .catch(() => ({ error: "Trace response is not valid JSON" }));
      if (!response.ok) {
        throw new Error(
          data.detail || data.error || `Failed to load trace ${traceId}`,
        );
      }
      setActiveTrace(data as TraceDetail);
    } catch (error: unknown) {
      setTraceError(
        error instanceof Error ? error.message : "Failed to load trace",
      );
    } finally {
      setTraceLoading(false);
    }
  };

  const closeTrace = () => {
    setActiveTraceId(null);
    setActiveTrace(null);
    setTraceError("");
    setTraceLoading(false);
  };

  const updateAssistantMessage = (
    assistantId: string,
    updater: (message: ChatMessage) => ChatMessage,
  ) => {
    setMessages((prev) => {
      const updated = [...prev];
      const idx = updated.findIndex((m) => m.id === assistantId);
      if (idx !== -1) {
        updated[idx] = updater(updated[idx]);
      }
      return updated;
    });
  };

  const appendRecipeCard = (assistantId: string, event: MultiAgentTraceEvent) => {
    const assistant = event.agent_id ? getAssistantByAgentId(event.agent_id) : null;
    const card: RecipeResultCard = {
      assistantName:
        event.assistant?.displayName ||
        event.assistant?.display_name ||
        assistant?.displayName ||
        event.agent_id ||
        "专业助手",
      agentId: event.agent_id,
      recipeId: event.recipe_id,
      recipeName: event.recipe_name || event.recipe_id || "Recipe 工作流",
      status: event.status || (event.type === "recipe_failed" ? "failed" : "completed"),
      report: event.report,
      taskId: event.task_id,
      labsHref: event.assistant?.labsHref || event.assistant?.labs_href || assistant?.labsHref,
      error: event.error,
    };
    updateAssistantMessage(assistantId, (message) => ({
      ...message,
      recipeCards: [...(message.recipeCards || []), card],
      trace: [
        ...(message.trace || []),
        {
          type: event.type,
          title:
            event.type === "recipe_failed"
              ? `${card.assistantName} 工作流失败`
              : `${card.assistantName} 工作流完成`,
          detail: summarizeTraceText(card.error || card.report || card.recipeName || ""),
        },
      ],
    }));
  };

  useEffect(() => {
    const mq = globalThis.matchMedia?.("(min-width: 768px)");
    if (!mq) return;
    const onChange = () => setIsMdLayout(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const refreshModelChip = () => {
      fetch("/api/config/provider")
        .then((r) => r.json())
        .then((data) => {
          const model = data.current?.model || "";
          const providerId = data.current?.id || "";
          setCurrentModel(model || providerId);
        })
        .catch(() => {});
    };
    refreshModelChip();
    window.addEventListener("llm-provider-changed", refreshModelChip);
    return () =>
      window.removeEventListener("llm-provider-changed", refreshModelChip);
  }, []);

  useEffect(() => {
    const LS_KEY = "default_llm_provider";
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/config/provider");
        const data = await res.json();
        if (cancelled || data._fallback) return;
        const saved = localStorage.getItem(LS_KEY);
        if (!saved || saved === data.current?.id) return;
        const ok = data.available?.some(
          (p: { id: string; has_key: boolean }) =>
            p.id === saved && p.has_key,
        );
        if (!ok) return;
        const post = await fetch("/api/config/provider", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider: saved }),
        });
        const out = await post.json();
        if (!cancelled && out.success) {
          window.dispatchEvent(
            new CustomEvent("llm-provider-changed", { detail: saved }),
          );
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/companion/state")
      .then((r) => r.json())
      .then((data: unknown) => {
        if (cancelled || !data || typeof data !== "object") return;
        const mood = (data as { mood?: { permission?: string } }).mood;
        setMoodPermission(normalizeMoodPermission(mood?.permission));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    chatVoiceOnRef.current = chatVoiceOn;
  }, [chatVoiceOn]);

  useEffect(() => {
    if (!mobileModelPanelOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileModelPanelOpen(false);
    };
    globalThis.addEventListener("keydown", onKey);
    return () => globalThis.removeEventListener("keydown", onKey);
  }, [mobileModelPanelOpen]);

  useEffect(() => {
    if (!chatPermOpen) return;
    const onDown = (e: MouseEvent) => {
      if (chatPermRef.current?.contains(e.target as Node)) return;
      setChatPermOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [chatPermOpen]);

  useEffect(() => {
    if (!chatVoiceTip) return;
    const id = window.setTimeout(() => setChatVoiceTip(null), 6000);
    return () => window.clearTimeout(id);
  }, [chatVoiceTip]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (!chatVoiceOn) {
      try {
        chatRecRef.current?.stop();
      } catch {
        /* ignore */
      }
      chatRecRef.current = null;
      return;
    }

    type SpeechRecCtor = new () => {
      lang: string;
      interimResults: boolean;
      continuous: boolean;
      start: () => void;
      stop: () => void;
      onresult: ((ev: {
        resultIndex: number;
        results: Array<{ isFinal: boolean; 0: { transcript: string } }>;
      }) => void) | null;
      onend: (() => void) | null;
      onerror: ((ev: { error: string }) => void) | null;
    };

    const win = window as unknown as {
      SpeechRecognition?: SpeechRecCtor;
      webkitSpeechRecognition?: SpeechRecCtor;
    };
    const SpeechRecognitionAPI =
      win.SpeechRecognition ?? win.webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) {
      setChatVoiceTip(t("chat.voiceNotSupported"));
      setChatVoiceOn(false);
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        if (!cancelled) {
          setChatVoiceTip(t("chat.voiceMicDenied"));
          setChatVoiceOn(false);
        }
        return;
      }
      if (cancelled) return;

      const recognition = new SpeechRecognitionAPI();
      chatRecRef.current = recognition;
      recognition.lang = "zh-CN";
      recognition.interimResults = true;
      recognition.continuous = false;
      recognition.onresult = (event) => {
        let final = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          if (event.results[i].isFinal) {
            final += event.results[i][0].transcript;
          }
        }
        const piece = final.trim();
        if (piece) {
          setInput((prev) => {
            const p = prev.replace(/\s+$/u, "");
            return p ? `${p} ${piece}` : piece;
          });
        }
      };
      recognition.onerror = (ev) => {
        if (ev.error === "not-allowed") {
          setChatVoiceTip(t("chat.voiceMicDenied"));
          setChatVoiceOn(false);
        }
      };
      recognition.onend = () => {
        if (!cancelled && chatVoiceOnRef.current) {
          try {
            recognition.start();
          } catch {
            /* may already be running */
          }
        }
      };
      try {
        recognition.start();
      } catch {
        /* ignore */
      }
    })();

    return () => {
      cancelled = true;
      try {
        chatRecRef.current?.stop();
      } catch {
        /* ignore */
      }
      chatRecRef.current = null;
    };
  }, [chatVoiceOn, t]);

  const attachWorkspacePath = useCallback(
    (relPath: string) => {
      const normalized = relPath.replace(/\\/g, "/");
      setWorkspaceAttachedPaths((prev) =>
        prev.includes(normalized) ? prev : [...prev, normalized],
      );
      setInput((prev) => {
        const token = `@${normalized}`;
        if (prev.includes(token)) return prev;
        const trimmed = prev.replace(/\s+$/u, "");
        return trimmed ? `${trimmed} ${token}` : `${token} `;
      });
    },
    [],
  );

  const detachWorkspacePath = useCallback((relPath: string) => {
    setWorkspaceAttachedPaths((prev) => prev.filter((p) => p !== relPath));
    setInput((prev) =>
      prev
        .replace(new RegExp(`@?${relPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`, "g"), "")
        .replace(/\s{2,}/g, " ")
        .trimStart(),
    );
  }, []);

  const processChat = async (
    history: ChatMessage[],
    workspaceContext?: WorkspaceContextPayload,
  ) => {
    setIsLoading(true);
    verboseLog("processChat start", history.length, "messages");
    const assistantId = `assistant-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const modelTag = currentModel
      ? t("chat.modelTagMulti", { model: "Multi-Agent" })
      : "";
    setMessages((prev) => [
      ...prev,
      { id: assistantId, role: "assistant", content: "", modelTag },
    ]);

    try {
      const chatPreferences = {
        onlineSearchMode: prefs.chatOnlineSearchMode,
        unboundMode: prefs.chatUnboundMode,
        chatMemoryEnabled: prefs.chatMemoryEnabled,
        chatKnowledgeMode: prefs.chatKnowledgeMode,
        chatKnowledgeScope: prefs.chatKnowledgeScope,
        chatMemoryRecall: prefs.chatMemoryRecall,
      };

      updateAssistantMessage(assistantId, (message) => ({
        ...message,
        content: t("chat.multiAgentWorking"),
        trace: [],
        completedAgents: [],
      }));

      const controller = new AbortController();
      abortRef.current = controller;
      const response = await fetch("/api/agent/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history.map((m) => ({ role: m.role, content: m.content })),
          mode: "multi",
          preferences: chatPreferences,
          workspace_context: workspaceContext,
          agent_id: undefined,
          graph_hint: "auto",
        }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const errData = await response
          .json()
          .catch(() => ({ error: "Unknown error" }));
        throw new Error(
          errData.detail || errData.error || `Error ${response.status}`,
        );
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      let buffer = "";
      let finalResponse = "";
      let streamContent = "";
      let modelName = "";
      let traceId = "";
      let graphId = "";
      let completedAgents: string[] = [];
      let pendingStreamError: Error | undefined;

      while (!done) {
        const { value, done: doneReading } = await reader.read();
        done = doneReading;
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        buffer = parseSseChunk(buffer, (event) => {
          if (event.type === "metadata") {
            modelName = event.model || event.provider || "LLM";
            traceId = event.trace_id || traceId;
            graphId = event.graph_id || graphId;
            updateAssistantMessage(assistantId, (message) => ({
              ...message,
              modelTag: t("chat.modelTagMulti", { model: modelName }),
              traceId,
            }));
            return;
          }

          if (event.type === "graph_selected") {
            graphId = event.graph_id || graphId;
            if (event.agent_id) {
              const assistant = getAssistantByAgentId(event.agent_id);
              updateAssistantMessage(assistantId, (message) => ({
                ...message,
                content: assistant
                  ? `${assistant.displayName} 正在接手…`
                  : t("chat.multiAgentRouting", { agent: event.agent_id || "…" }),
                trace: [
                  ...(message.trace || []),
                  {
                    type: "graph_selected",
                    title: "已选择专业助手",
                    detail: assistant?.displayName || event.agent_id,
                  },
                ],
              }));
            }
            return;
          }

          if (event.type === "assistant_selected") {
            const assistant = event.agent_id ? getAssistantByAgentId(event.agent_id) : null;
            updateAssistantMessage(assistantId, (message) => ({
              ...message,
              content: assistant
                ? `${assistant.displayName} 正在接手…`
                : t("chat.multiAgentRouting", { agent: event.agent_id || "…" }),
              trace: [
                ...(message.trace || []),
                {
                  type: "assistant_selected",
                  title: "专业助手接手",
                  detail:
                    event.assistant?.displayName ||
                    event.assistant?.display_name ||
                    assistant?.description ||
                    event.agent_id,
                },
              ],
            }));
            return;
          }

          if (event.completed_agents?.length) {
            completedAgents = event.completed_agents;
          }

          if (event.type === "token" && event.content) {
            streamContent += event.content;
            updateAssistantMessage(assistantId, (message) => ({
              ...message,
              content: streamContent,
            }));
            return;
          }

          if (event.type === "decision") {
            updateAssistantMessage(assistantId, (message) => ({
              ...message,
              content: t("chat.multiAgentRouting", {
                agent: event.next_agent || "…",
              }),
              trace: [
                ...(message.trace || []),
                {
                  type: "decision",
                  title: t("chat.dispatchTo", {
                    agent: String(event.next_agent ?? "…"),
                  }),
                  detail: summarizeTraceText(
                    event.guidance || t("chat.noExtraGuidance"),
                  ),
                },
              ],
              completedAgents,
            }));
            return;
          }

          if (event.type === "agent_result") {
            const agentContent = String(event.content || "").trim();
            updateAssistantMessage(assistantId, (message) => ({
              ...message,
              content:
                event.agent_id === "claude_code" && agentContent
                  ? agentContent
                  : t("chat.multiAgentDoneAgent", {
                      agent: event.agent_id || "agent",
                    }),
              trace: [
                ...(message.trace || []),
                {
                  type: "agent_result",
                  title: t("chat.agentCompleted", {
                    agent: event.agent_id || "agent",
                  }),
                  detail: summarizeTraceText(event.content || ""),
                },
              ],
              completedAgents,
            }));
            return;
          }

          if (event.type === "permission_request" && event.permission_id) {
            setClaudePermission({
              permission_id: event.permission_id,
              tool_name: event.tool_name,
              title: event.title,
              description: event.description,
            });
            return;
          }

          if (event.type === "recipe_started") {
            const assistant = event.agent_id ? getAssistantByAgentId(event.agent_id) : null;
            updateAssistantMessage(assistantId, (message) => ({
              ...message,
              content: `${assistant?.displayName || event.agent_id || "专业助手"} 正在执行工作流…`,
              trace: [
                ...(message.trace || []),
                {
                  type: "recipe_started",
                  title: "Recipe 工作流启动",
                  detail: event.tool_name,
                },
              ],
            }));
            return;
          }

          if (event.type === "recipe_completed" || event.type === "recipe_failed") {
            appendRecipeCard(assistantId, event);
            return;
          }

          if (event.type === "final") {
            finalResponse = event.response || finalResponse;
            if (graphId === "chat") {
              streamContent = finalResponse || streamContent;
              updateAssistantMessage(assistantId, (message) => ({
                ...message,
                content: streamContent,
              }));
            } else {
              updateAssistantMessage(assistantId, (message) => ({
                ...message,
                trace: [
                  ...(message.trace || []),
                  {
                    type: "final",
                    title: t("chat.finalResponseDone"),
                    detail: summarizeTraceText(event.response || ""),
                  },
                ],
                completedAgents,
              }));
            }
            return;
          }

          if (event.type === "error") {
            pendingStreamError = new Error(
              String(event.detail || event.message || "Agent chat stream failed"),
            );
            return;
          }
        });
        if (pendingStreamError) throw pendingStreamError;
      }

      const isMultiUi = graphId !== "chat";
      const agentBadges =
        isMultiUi && completedAgents.length > 0
          ? t("chat.collabAgents", { agents: completedAgents.join(" → ") })
          : "";
      const traceBadge = traceId ? t("chat.traceLine", { id: traceId }) : "";
      const displayContent =
        (isMultiUi ? finalResponse || streamContent : streamContent || finalResponse) ||
        t("chat.noResponse");

      updateAssistantMessage(assistantId, (message) => ({
        ...message,
        content: displayContent + agentBadges + traceBadge,
        modelTag: isMultiUi
          ? t("chat.modelTagMulti", { model: modelName || "LLM" })
          : t("chat.modelTagBracket", { tag: modelName || currentModel || "LLM" }),
        traceId,
        completedAgents,
        participation: isMultiUi
          ? [
              {
                kind: "dialogue",
                title: t("chat.participationOrchestration"),
                detail: `${modelName || "LLM"}（Multi-Agent / ${graphId || "orchestrator"}）`,
              },
              ...(completedAgents.length > 0
                ? [
                    {
                      kind: "agents",
                      title: t("chat.participationAgents"),
                      detail: completedAgents.join(" → "),
                    },
                  ]
                : []),
            ]
          : message.participation,
      }));
      // ── task completed successfully ───────────────────────────────────────────────
      playSound("complete");
      notify(t("chat.notifyDone"), t("chat.notifyDoneBody"));
      verboseLog("processChat succeeded");
      // auto-save draft ───────────────────────────────────────────────────────
      const lastUser = history.filter((m) => m.role === "user").pop();
      if (lastUser) saveDraft(lastUser.role, lastUser.content);
    } catch (error: unknown) {
      // User-initiated stop — keep whatever was already streamed, no error UI.
      if (error instanceof DOMException && error.name === "AbortError") {
        verboseLog("processChat aborted by user");
        setMessages((prev) => {
          const updated = [...prev];
          const index = updated.findIndex((m) => m.id === assistantId);
          if (index !== -1 && !updated[index].content.trim()) {
            updated[index] = {
              ...updated[index],
              content: t("chat.generationStopped"),
            };
          }
          return updated;
        });
      } else {
        playSound("error");
        verboseLog("processChat error", error);
        setMessages((prev) => {
          const updated = [...prev];
          const index = updated.findIndex((m) => m.id === assistantId);
          if (index !== -1)
            updated[index] = {
              ...updated[index],
              content: t("chat.genericError", {
                msg:
                  error instanceof Error
                    ? error.message
                    : t("chat.connectionLost"),
              }),
            };
          return updated;
        });
      }
    } finally {
      abortRef.current = null;
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if ((!input.trim() && attachedFiles.length === 0) || isLoading) return;
    playSound("send");

    // ── 图片附件 + Direct + 生成类意图 → 上传参考图再走 /api/chat（带工具）
    // ─────────────────────────────────────────────────────────────────────────
    if (
      attachedFiles.length > 0 &&
      shouldUseAttachmentToolPath(input, attachedFiles, t("chat.hintMultiAgent"))
    ) {
      const filesSnap = [...attachedFiles];
      const userSnippet = input.trim();
      try {
        const urls: string[] = [];
        for (const af of filesSnap.filter((x) => x.category === "image")) {
          urls.push(await uploadReferenceBlob(af.file));
        }

        let body =
          userSnippet || t("chat.defaultImageTask");

        body += `\n\n${t("chat.backendRefUrls")}\n${urls.map((u, i) => `${i + 1}. ${u}`).join("\n")}`;

        const uid = `user-${Date.now()}`;
        const userVisible: ChatMessage = {
          id: uid,
          role: "user",
          content:
            `${userSnippet || t("chat.refImageUploadLabel")}（${t("chat.refImageCount", { count: urls.length })}）`,
        };
        const userForModel: ChatMessage = {
          id: uid,
          role: "user",
          content: body,
        };

        const newHistoryUi = [...messages, userVisible];
        setAttachedFiles([]);
        setInput("");
        if (inputRef.current) inputRef.current.style.height = "auto";
        const historyForTools = [...messages, userForModel];
        setMessages(newHistoryUi);

        await processChat(historyForTools, {
          root: readSelectedWorkspaceRoot() || workspaceRootPath || undefined,
          attached_files: [...workspaceAttachedPaths],
          attachments: urls.map((url, index) => ({
            name: filesSnap[index]?.file.name || `reference-${index + 1}`,
            type: filesSnap[index]?.file.type,
            size: filesSnap[index]?.file.size,
            url,
          })),
          branch: gitBranch || undefined,
          source_message_id: uid,
        });
      } catch (err) {
        playSound("error");
        notify(
          t("chat.uploadRefFailTitle"),
          err instanceof Error ? err.message : t("chat.retry"),
        );
      }
      return;
    }

    // ── multimodal path (files attached) ──────────────────────────────────────
    if (attachedFiles.length > 0) {
      const userContent =
        input.trim() ||
        t("chat.uploadedFilesAnalyze", {
          count: attachedFiles.length,
        });
      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        content: `📎 ${userContent}`,
      };
      const newHistory = [...messages, userMsg];
      setMessages(newHistory);
      setInput("");
      setAttachedFiles([]);
      if (inputRef.current) inputRef.current.style.height = "auto";

      setIsLoading(true);
      const assistantId = `assistant-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: "assistant", content: t("chat.processingFiles") },
      ]);
      try {
        const formData = new FormData();
        formData.append("message", userContent);
        for (const af of attachedFiles) formData.append("files", af.file);
        const controller = new AbortController();
        abortRef.current = controller;
        const res = await fetch("/api/multimodal/chat", {
          method: "POST",
          body: formData,
          signal: controller.signal,
        });
        if (!res.ok || !res.body)
          throw new Error(`${res.status} ${res.statusText}`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let done = false;
        let buffer = "";
        let finalContent = "";

        while (!done) {
          const { value, done: d } = await reader.read();
          done = d;
          buffer += decoder.decode(value || new Uint8Array(), {
            stream: !done,
          });
          const normalized = buffer.replace(/\r\n/g, "\n");
          const lines = normalized.split("\n\n");
          buffer = lines.pop() || "";
          for (const block of lines) {
            const dataLine = block
              .split("\n")
              .find((l) => l.startsWith("data: "));
            if (!dataLine) continue;
            const raw = dataLine.slice(6).trimStart();
            if (raw === "[DONE]") break;
            try {
              const ev = JSON.parse(raw) as {
                content?: unknown;
                error?: string;
              };
              if (ev.error)
                throw new Error(ev.error);
              if (ev.content != null && ev.content !== "") {
                let chunk = "";
                if (typeof ev.content === "string") chunk = ev.content;
                else if (Array.isArray(ev.content)) {
                  chunk = ev.content
                    .map((part: unknown) => {
                      if (typeof part === "string") return part;
                      if (
                        part &&
                        typeof part === "object" &&
                        "text" in part &&
                        typeof (part as { text: unknown }).text === "string"
                      )
                        return (part as { text: string }).text;
                      return "";
                    })
                    .join("");
                } else chunk = String(ev.content);
                if (chunk) {
                  finalContent += chunk;
                  setMessages((prev) => {
                    const updated = [...prev];
                    const idx = updated.findIndex((m) => m.id === assistantId);
                    if (idx !== -1)
                      updated[idx] = {
                        ...updated[idx],
                        content: finalContent,
                      };
                    return updated;
                  });
                }
              }
            } catch (parseErr) {
              if (parseErr instanceof SyntaxError) continue;
              throw parseErr;
            }
          }
        }
        let participationMm: ParticipationItem[] | undefined;
        try {
          const pr = await fetch("/api/config/provider");
          const pdata = await pr.json();
          if (!pdata._fallback && pdata.current) {
            const modelLabel = pdata.current.model || pdata.current.id || "—";
            const provEntry = pdata.available?.find(
              (x: { id: string }) => x.id === pdata.current?.id,
            );
            const nameLabel =
              pdata.current.name ||
              provEntry?.name ||
              pdata.current.id ||
              "—";
            participationMm = [
              {
                kind: "dialogue",
                title: t("chat.dialogueModel"),
                detail: `${modelLabel}（${nameLabel}）`,
              },
              {
                kind: "multimodal",
                title: t("chat.attachmentHandling"),
                detail: t("chat.attachmentProcessDetail"),
              },
            ];
          }
        } catch {
          participationMm = undefined;
        }

        setMessages((prev) => {
          const updated = [...prev];
          const idx = updated.findIndex((m) => m.id === assistantId);
          if (idx !== -1)
            updated[idx] = {
              ...updated[idx],
              content: finalContent || t("chat.noAssistantContent"),
              participation: participationMm,
            };
          return updated;
        });
        playSound("complete");
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          setMessages((prev) => {
            const updated = [...prev];
            const idx = updated.findIndex((m) => m.id === assistantId);
            if (idx !== -1 && !updated[idx].content.trim())
              updated[idx] = {
                ...updated[idx],
                content: t("chat.generationStopped"),
              };
            return updated;
          });
        } else {
          playSound("error");
          setMessages((prev) => {
            const updated = [...prev];
            const idx = updated.findIndex((m) => m.id === assistantId);
            if (idx !== -1)
              updated[idx] = {
                ...updated[idx],
                content: t("chat.genericError", {
                  msg:
                    err instanceof Error
                      ? err.message
                      : t("chat.fileProcessFail"),
                }),
              };
            return updated;
          });
        }
      } finally {
        abortRef.current = null;
        setIsLoading(false);
      }
      return;
    }

    // ── text-only path ────────────────────────────────────────────────────────
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: input,
    };
    const newHistory = [...messages, userMsg];
    const projectRoot = readSelectedWorkspaceRoot();
    const workspaceSnap: WorkspaceContextPayload = workspaceProjectActive
      ? {
          root: projectRoot || workspaceRootPath || undefined,
          attached_files: [...workspaceAttachedPaths],
          branch: gitBranch || undefined,
          source_message_id: userMsg.id,
        }
      : {
          attached_files: [...workspaceAttachedPaths],
          source_message_id: userMsg.id,
        };
    setMessages(newHistory);
    setInput("");
    setWorkspaceAttachedPaths([]);
    if (inputRef.current) inputRef.current.style.height = "auto";
    await processChat(newHistory, workspaceSnap);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const sk = prefs.submitKey;
    const isEnter = e.key === "Enter";
    const triggered =
      (sk === "enter" && isEnter && !e.shiftKey && !e.metaKey && !e.ctrlKey) ||
      (sk === "shift+enter" && isEnter && e.shiftKey) ||
      (sk === "cmd+enter" && isEnter && (e.metaKey || e.ctrlKey));
    if (triggered) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const continuePlaceholder = useMemo(() => {
    if (prefs.submitKey === "shift+enter")
      return t("chat.placeholderContinueShift");
    if (prefs.submitKey === "cmd+enter")
      return t("chat.placeholderContinueCmd");
    return t("chat.placeholderContinueEnter");
  }, [prefs.submitKey, t]);

  const handleMainMoodPick = async (next: MoodPermission) => {
    setMoodPermission(next);
    await patchCompanionMoodPermission(next);
  };

  const toggleChatVoice = () => setChatVoiceOn((v) => !v);

  const applyHeroPrompt = useCallback((text: string) => {
    setInput(text);
    queueMicrotask(() => inputRef.current?.focus());
  }, [setInput]);

  const chatSettingsOpen = isMdLayout
    ? modelPanelOpen
    : mobileModelPanelOpen;

  const { hydrated: workspaceHydrated, projectActive: workspaceProjectActive } =
    useWorkspaceProjectActive();

  useEffect(() => {
    if (!workspaceHydrated) return;
    if (!workspaceProjectActive && chatRailTab === "files")
      setChatRailTab("settings");
  }, [workspaceHydrated, workspaceProjectActive, chatRailTab]);

  useEffect(() => {
    if (!workspaceProjectActive) {
      setGitBranch(null);
      setWorkspaceRootPath(null);
      return;
    }
    const projectRoot = readSelectedWorkspaceRoot();
    if (projectRoot) setWorkspaceRootPath(projectRoot);

    let cancelled = false;
    const rootQ = projectRoot
      ? `?root=${encodeURIComponent(projectRoot)}`
      : "";
    void fetch(`/api/workspace/git/summary${rootQ}`)
      .then(async (r) => {
        const data = (await r.json()) as {
          branch?: string | null;
          rootPath?: string;
        };
        if (!cancelled) {
          setGitBranch(data.branch ?? null);
          if (!projectRoot) setWorkspaceRootPath(data.rootPath ?? null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setGitBranch(null);
          if (!projectRoot) setWorkspaceRootPath(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceProjectActive]);

  useEffect(() => {
    return subscribeWorkspaceSelection(() => {
      const root = readSelectedWorkspaceRoot();
      if (root) setWorkspaceRootPath(root);
    });
  }, []);

  const chatInputPlaceholder =
    workspaceAttachedPaths.length > 0
      ? t("chat.workspace.inputPlaceholderCode")
      : t("chat.inputPlaceholder");

  const explorerTabVisible = workspaceHydrated && workspaceProjectActive;
  const showExplorerPanel = explorerTabVisible && chatRailTab === "files";
  const explorerTabSelected =
    explorerTabVisible && chatRailTab === "files";
  const settingsTabSelected =
    !explorerTabVisible || chatRailTab === "settings";

  const onRailTabClick = useCallback(
    (tab: "files" | "settings") => {
      if (tab === "files" && !explorerTabVisible) return;
      if (isMdLayout) {
        if (!modelPanelOpen) {
          setChatRailTab(tab);
          setModelPanelOpen(true);
          return;
        }
        if (chatRailTab === tab) {
          setModelPanelOpen(false);
          return;
        }
        setChatRailTab(tab);
        return;
      }
      if (!mobileModelPanelOpen) {
        setChatRailTab(tab);
        setMobileModelPanelOpen(true);
        return;
      }
      if (chatRailTab === tab) {
        setMobileModelPanelOpen(false);
        return;
      }
      setChatRailTab(tab);
    },
    [
      isMdLayout,
      modelPanelOpen,
      mobileModelPanelOpen,
      chatRailTab,
      explorerTabVisible,
    ],
  );

  const tabBtnBase =
    "flex size-9 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:outline focus-visible:ring-2 focus-visible:ring-[color:rgba(255,149,0,0.35)]";
  const tabBtnOn =
    "bg-[var(--nav-active-fill)] text-[color:var(--accent)]";
  const tabBtnOff =
    "text-[color:var(--label-secondary)] hover:bg-[var(--nav-active-fill)] hover:text-[color:var(--foreground)]";

  return (
    <div className="relative flex min-h-0 w-full flex-1 flex-col bg-transparent font-sans text-[color:var(--foreground)]">
      {/* ── Slim top bar ───────────────────────────────────────────────── */}
      <header className="chrome-bar z-10 flex h-[58px] flex-shrink-0 items-center justify-end px-5">
        <div className="mr-3">
          <TaskRunningIndicator />
        </div>
        <div
          role="tablist"
          aria-label={t("chat.workspace.railTablistAria")}
          aria-expanded={chatSettingsOpen}
          aria-controls={
            isMdLayout
              ? "chat-settings-panel"
              : "chat-settings-panel-mobile"
          }
          className="flex items-center gap-0.5 rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] p-0.5 shadow-sm"
        >
          {explorerTabVisible ? (
            <button
              type="button"
              role="tab"
              aria-selected={explorerTabSelected}
              aria-label={t("chat.workspace.filesToggleAria")}
              title={t("chat.workspace.filesToggleTitle")}
              onClick={() => onRailTabClick("files")}
              className={`${tabBtnBase} ${explorerTabSelected ? tabBtnOn : tabBtnOff}`}
            >
              <ListTree className="h-5 w-5" strokeWidth={2.25} aria-hidden />
            </button>
          ) : null}
          <button
            type="button"
            role="tab"
            aria-selected={settingsTabSelected}
            aria-label={t("chat.topPanelToggleAria")}
            title={t("chat.topPanelToggleTitle")}
            onClick={() => onRailTabClick("settings")}
            className={`${tabBtnBase} ${settingsTabSelected ? tabBtnOn : tabBtnOff}`}
          >
            <SlidersHorizontal
              className="h-5 w-5"
              strokeWidth={2.25}
              aria-hidden
            />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {messages.length > 0 ? (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[color:var(--separator-subtle)] bg-[var(--shell-bg)]/95 px-5 py-2.5 backdrop-blur-sm">
          <span className="truncate text-xs font-medium text-[color:var(--label-secondary)]">
            {t("chat.sessionActive")}
          </span>
          <ChatNewSessionButton
            onClick={clearSession}
            label={t("chat.newChat")}
            hint={t("chat.newChatHint")}
            disabled={isLoading}
          />
        </div>
      ) : null}
      {/* ── Main Content ───────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto overflow-x-hidden scroll-smooth">
          {messages.length === 0 ? (
            <ChatEmptyHero
              t={t}
              input={input}
              setInput={setInput}
              inputRef={inputRef}
              multimodalRef={multimodalRef}
              attachedFiles={attachedFiles}
              onFilesChange={setAttachedFiles}
              workspaceAttachedPaths={workspaceAttachedPaths}
              onDetachWorkspacePath={detachWorkspacePath}
              placeholder={chatInputPlaceholder}
              onKeyDown={handleKeyDown}
              chatVoiceOn={chatVoiceOn}
              onVoiceToggle={toggleChatVoice}
              isLoading={isLoading}
              canSubmit={!!input.trim() || attachedFiles.length > 0}
              onSubmit={() => handleSubmit()}
              onStop={stopGeneration}
              onApplyPrompt={applyHeroPrompt}
              chatVoiceTip={chatVoiceTip}
              claudePermission={claudePermission}
              claudePermissionBusy={claudePermissionBusy}
              onAllowClaudePermission={() => void respondClaudePermission(true)}
              onDenyClaudePermission={() => void respondClaudePermission(false)}
              moodPermission={moodPermission}
              onMoodPick={(next) => void handleMainMoodPick(next)}
              chatPermOpen={chatPermOpen}
              onChatPermOpenChange={setChatPermOpen}
              chatPermRef={chatPermRef}
            />
          ) : (
        <div className="mx-auto w-full max-w-5xl px-5 py-8 lg:px-8">
          {/* ── Messages ─────────────────────────────────────────────── */}
            <div className="space-y-6 pb-4">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`flex w-full animate-in fade-in slide-in-from-bottom-2 duration-300 ${
                    m.role === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  <div
                    className={`rounded-2xl px-5 py-3.5 ${
                      m.role === "user"
                        ? "max-w-[85%] rounded-br-sm bg-[color:var(--accent)] font-medium text-white shadow-sm sm:max-w-[68%]"
                        : "w-full max-w-none rounded-2xl rounded-bl-sm card-surface text-[color:var(--foreground)] sm:px-6 sm:py-5"
                    }`}
                  >
                    {m.role === "user" ? (
                      <p className="text-sm leading-relaxed">{m.content}</p>
                    ) : (
                      <>
                        {m.modelTag && (
                          <div className="mb-2 flex items-center justify-between gap-2 border-b border-[color:var(--separator-subtle)] pb-2">
                            <span className="rounded-full bg-[var(--chrome-rail-bg)] px-2 py-0.5 font-mono text-[10px] font-semibold text-[color:var(--label-secondary)] ring-1 ring-[color:var(--separator-subtle)]">
                              {m.modelTag}
                            </span>
                            {m.traceId && (
                              <button
                                type="button"
                                onClick={() => openTrace(m.traceId!)}
                                className="rounded-full border border-[color:color-mix(in_srgb,var(--accent)_40%,transparent)] bg-[var(--nav-active-fill)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--accent)] transition-colors hover:opacity-90"
                              >
                                View Trace
                              </button>
                            )}
                          </div>
                        )}
                        <div className="text-[14px] leading-7">
                          {Array.isArray(m.trace) && m.trace.length > 0 && (
                            <details className="mb-4 rounded-2xl border border-[color:var(--separator-subtle)] bg-[color:color-mix(in_srgb,var(--foreground)_2%,transparent)] px-3 py-2">
                              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:var(--label-secondary)] hover:text-[color:var(--foreground)] [&::-webkit-details-marker]:hidden">
                                <span>
                                  Agent Trace · {m.trace.length} steps
                                </span>
                                <span className="rounded-full bg-[var(--card-bg)] px-2 py-0.5 text-[10px] normal-case tracking-normal ring-1 ring-[color:var(--separator-subtle)]">
                                  Debug
                                </span>
                              </summary>
                              <div className="mt-3 grid gap-2">
                                {m.trace.map(
                                  (event: TraceEntry, index: number) => (
                                    <div
                                      key={`${m.id}-trace-${index}`}
                                      className="rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-3 py-2"
                                    >
                                      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[color:var(--label-secondary)]">
                                        {event.title}
                                      </div>
                                      {event.detail ? (
                                        <div className="mt-1 text-xs leading-5 text-[color:var(--foreground)]">
                                          {event.detail}
                                        </div>
                                      ) : null}
                                    </div>
                                  ),
                                )}
                              </div>
                            </details>
                          )}
                          <MediaRenderer content={m.content} />
                          <RecipeResultCards cards={m.recipeCards} />
                          {m.participation && m.participation.length > 0 ? (
                            <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[color:var(--separator-subtle)] pt-3 text-[11px] leading-5 text-[color:var(--label-secondary)]">
                              {m.participation.map((row, i) => (
                                <span key={`${m.id}-part-${i}`} className="inline-flex min-w-0 items-center gap-1.5">
                                  <span className="font-semibold text-[color:var(--foreground)]">
                                    {row.title}
                                  </span>
                                  <span className="truncate">
                                    {row.detail}
                                  </span>
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              ))}

              {isLoading && (
                <div className="flex justify-start items-center gap-3">
                  <div className="flex gap-1">
                    <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-amber-300 [animation-delay:-0.3s]" />
                    <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-orange-400 [animation-delay:-0.15s]" />
                    <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-sky-400" />
                  </div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-[color:var(--label-secondary)]">
                    {t("chat.generating")}
                  </span>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
        </div>
          )}
        </main>

      {/* ── Floating Input (when messages exist) ───────────────────────── */}
      {messages.length > 0 && (
        <footer className="z-20 flex-shrink-0 border-t border-[color:var(--separator-subtle)] bg-[var(--shell-bg)] pb-5 pt-6 px-5">
          <div className="mx-auto w-full max-w-5xl lg:px-8">
            {chatVoiceTip ? (
              <div className="mb-2 rounded-xl border border-amber-400/35 bg-amber-500/10 px-3 py-2 text-center text-xs text-amber-800 dark:text-amber-200">
                {chatVoiceTip}
              </div>
            ) : null}
            <ClaudeCodePermissionBanner
              pending={claudePermission}
              busy={claudePermissionBusy}
              onAllow={() => void respondClaudePermission(true)}
              onDeny={() => void respondClaudePermission(false)}
            />
            <div className="card-surface overflow-visible rounded-[18px] shadow-[0_6px_32px_-8px_rgba(0,0,0,0.07)] ring-1 ring-[color:color-mix(in_srgb,var(--foreground)_08%,transparent)] transition-[box-shadow,ring-color] focus-within:shadow-[0_12px_44px_-10px_rgba(0,0,0,0.1)] focus-within:ring-2 focus-within:ring-[color:rgba(255,149,0,0.28)] dark:shadow-[0_10px_40px_-12px_rgba(0,0,0,0.5)]">
              <WorkspaceAttachedChips
                paths={workspaceAttachedPaths}
                onRemove={detachWorkspacePath}
                label={t("chat.workspace.attachedFilesLabel")}
              />
              <MultimodalInput
                ref={multimodalRef}
                inputRef={inputRef}
                rows={1}
                value={input}
                onChange={setInput}
                onKeyDown={handleKeyDown}
                files={attachedFiles}
                onFilesChange={setAttachedFiles}
                placeholder={
                  workspaceAttachedPaths.length > 0
                    ? chatInputPlaceholder
                    : continuePlaceholder
                }
              />
              <ChatInputToolbar
                multimodalRef={multimodalRef}
                moodPermission={moodPermission}
                onMoodPick={(next) => void handleMainMoodPick(next)}
                chatPermOpen={chatPermOpen}
                onChatPermOpenChange={setChatPermOpen}
                chatPermRef={chatPermRef}
                moodPreferMenuAbove
                chatVoiceOn={chatVoiceOn}
                onVoiceToggle={toggleChatVoice}
                isLoading={isLoading}
                canSubmit={!!input.trim() || attachedFiles.length > 0}
                onSubmit={() => handleSubmit()}
                onStop={stopGeneration}
                submitAriaLabel={t("chat.send")}
                idPrefix="footer"
                t={t}
              />
              <ChatWorkspaceContextStrip />
            </div>
            <p className="mt-3 text-center text-[11px] font-medium text-[color:var(--label-secondary)]">
              {t("chat.footerTagline")}
            </p>
          </div>
        </footer>
      )}
        </div>

        <div className="relative hidden shrink-0 md:block">
          <aside
            id="chat-settings-panel"
            className={`chrome-rail flex h-full flex-col overflow-hidden transition-[width] duration-200 ease-out ${modelPanelOpen ? "chrome-rail-edge-left w-72" : "w-0 border-l-0"}`}
          >
            <div className="flex h-full w-72 flex-col overflow-hidden">
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                {showExplorerPanel ? (
                  <div className="flex min-h-0 flex-1 flex-col px-4 pb-8 pt-3">
                    <ChatWorkspaceFilesPanel
                      attachedPaths={workspaceAttachedPaths}
                      onAttachPath={attachWorkspacePath}
                    />
                  </div>
                ) : (
                  <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-4">
                    <div className="mb-4 flex flex-col gap-3">
                      <div className="min-w-0">
                        <h3 className="text-sm font-semibold tracking-tight text-[color:var(--foreground)]">
                          {t("chat.panelTitle")}
                        </h3>
                        <p className="mt-1 text-[11px] leading-relaxed text-[color:var(--label-secondary)]">
                          {t("chat.panelSubtitle")}
                        </p>
                      </div>
                      <div className="h-px bg-[color:var(--separator-subtle)]" />
                    </div>
                    <div className="flex flex-col gap-5">
                      <ChatConversationPrefsCards />
                      <DefaultLLMProviderSection />
                      <MediaModelSelector panelLayout />
                      <ChatSettingsQuickLinks />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </aside>
        </div>
      </div>

      {mobileModelPanelOpen && (
        <>
          <div
            role="presentation"
            className="fixed inset-0 z-[55] bg-black/20 backdrop-blur-[3px] md:hidden"
            onClick={() => setMobileModelPanelOpen(false)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setMobileModelPanelOpen(false);
            }}
          />
          <aside
            id="chat-settings-panel-mobile"
            className="chrome-rail chrome-rail-edge-left fixed inset-y-0 right-0 z-[60] flex w-[min(18rem,calc(100vw-1.5rem))] flex-col overflow-hidden shadow-[-12px_0_40px_rgba(0,0,0,0.06)] animate-in slide-in-from-right duration-200 md:hidden"
          >
            <div className="flex h-full flex-col overflow-hidden">
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                {showExplorerPanel ? (
                  <div className="flex min-h-0 flex-1 flex-col px-4 pb-8 pt-3">
                    <ChatWorkspaceFilesPanel
                      attachedPaths={workspaceAttachedPaths}
                      onAttachPath={attachWorkspacePath}
                    />
                  </div>
                ) : (
                  <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-4">
                    <div className="mb-4 flex flex-col gap-3">
                      <div className="min-w-0">
                        <h3 className="text-sm font-semibold tracking-tight text-[color:var(--foreground)]">
                          {t("chat.panelTitle")}
                        </h3>
                        <p className="mt-1 text-[11px] leading-relaxed text-[color:var(--label-secondary)]">
                          {t("chat.panelSubtitle")}
                        </p>
                      </div>
                      <div className="h-px bg-[color:var(--separator-subtle)]" />
                    </div>
                    <div className="flex flex-col gap-5">
                      <ChatConversationPrefsCards />
                      <DefaultLLMProviderSection />
                      <MediaModelSelector panelLayout />
                      <ChatSettingsQuickLinks />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </aside>
        </>
      )}

      {activeTraceId && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-slate-950/35 px-4 py-6 backdrop-blur-sm sm:items-center">
          <div className="max-h-[85vh] w-full max-w-3xl overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-2xl shadow-slate-900/20">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 bg-gradient-to-r from-amber-50 via-white to-slate-50 px-5 py-4">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-amber-600">
                  Multi-Agent Trace
                </div>
                <div className="mt-1 font-mono text-xs text-slate-500">
                  {activeTraceId}
                </div>
              </div>
              <button
                type="button"
                onClick={closeTrace}
                className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-800"
              >
                Close
              </button>
            </div>

            <div className="max-h-[calc(85vh-76px)] overflow-y-auto px-5 py-4">
              {traceLoading ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                  {t("chat.traceLoading")}
                </div>
              ) : traceError ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-700">
                  {traceError}
                </div>
              ) : activeTrace ? (
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                        Status
                      </div>
                      <div className="mt-2 text-sm font-semibold text-slate-800">
                        {activeTrace.status}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                        Model
                      </div>
                      <div className="mt-2 text-sm font-semibold text-slate-800">
                        {activeTrace.metadata?.model ||
                          activeTrace.metadata?.provider ||
                          "Unknown"}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                        Mode
                      </div>
                      <div className="mt-2 text-sm font-semibold text-slate-800">
                        {activeTrace.metadata?.mode || "stream"}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                        Events
                      </div>
                      <div className="mt-2 text-sm font-semibold text-slate-800">
                        {activeTrace.events?.length || 0}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                      User Input
                    </div>
                    <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                      {activeTrace.input}
                    </div>
                  </div>

                  {activeTrace.final_response && (
                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 px-4 py-4">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-600">
                        Final Response Snapshot
                      </div>
                      <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                        {summarizeTraceText(activeTrace.final_response, 800)}
                      </div>
                    </div>
                  )}

                  <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3">
                    <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                      Event Timeline
                    </div>
                    <div className="space-y-2">
                      {(activeTrace.events || []).map((event, index) => {
                        const eventSummary =
                          event.detail ||
                          event.guidance ||
                          event.content ||
                          event.response ||
                          event.next_agent ||
                          event.agent_id ||
                          "";

                        return (
                          <div
                            key={`${activeTrace.id}-event-${index}`}
                            className="rounded-xl border border-slate-200 bg-white px-4 py-3"
                          >
                            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                                {event.type}
                              </div>
                              <div className="font-mono text-[11px] text-slate-400">
                                {event.timestamp}
                              </div>
                            </div>
                            {eventSummary ? (
                              <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                                {summarizeTraceText(eventSummary, 400)}
                              </div>
                            ) : null}
                            {event.completed_agents?.length ? (
                              <div className="mt-2 text-xs text-slate-500">
                                Agents: {event.completed_agents.join(" → ")}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
