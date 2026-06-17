"use client";

import { parseJsonResponse } from "@/lib/apiJson";
import {
  analyzeBugFromMedia,
  askTapdAI,
  buildBugGenerateSystemPrompt,
  buildBugPolishSystemPrompt,
  fetchMergedChatMembers,
  formatFileSize,
  isAllowedAttachment,
  isFeishuCliNoiseError,
  isHarAttachment,
  MAX_TAPD_ATTACHMENT_BYTES,
  MAX_TAPD_ATTACHMENTS,
  parseManualChatIds,
  type FeishuMember,
  type TapdBugPriority,
} from "@/app/lark-cli/tapd-bug-utils";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type TapdStatus = {
  configured?: boolean;
  workspace_id?: string;
  web_base?: string;
};

type FeishuChat = { chat_id: string; name: string };

type PendingAttachment = {
  id: string;
  file: File;
  previewUrl: string | null;
};

const PRIORITY_OPTIONS = [
  { value: "urgent", label: "紧急", color: "bg-red-100 text-red-800 ring-red-200" },
  { value: "high", label: "高", color: "bg-orange-100 text-orange-800 ring-orange-200" },
  { value: "medium", label: "中", color: "bg-blue-100 text-blue-800 ring-blue-200" },
  { value: "low", label: "低", color: "bg-slate-100 text-slate-600 ring-slate-200" },
] as const;

const CONTENT_CLASS = "mx-auto w-full max-w-7xl";

function Section({
  step,
  title,
  hint,
  children,
  className = "",
}: {
  step: number;
  title: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-xl border border-slate-100 bg-white p-4 sm:p-5 lg:p-6 ${className}`}
    >
      <div className="mb-4 flex items-start gap-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">
          {step}
        </span>
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-semibold text-slate-900">{title}</h4>
          {hint ? (
            <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{hint}</p>
          ) : null}
        </div>
      </div>
      {children}
    </section>
  );
}

function Chip({
  label,
  onRemove,
  disabled,
}: {
  label: string;
  onRemove?: () => void;
  disabled?: boolean;
}) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-900">
      <span className="truncate">{label}</span>
      {onRemove ? (
        <button
          type="button"
          disabled={disabled}
          onClick={onRemove}
          className="ml-0.5 rounded-full p-0.5 text-indigo-400 hover:bg-indigo-100 hover:text-indigo-700 disabled:opacity-40"
          aria-label={`移除 ${label}`}
        >
          ×
        </button>
      ) : null}
    </span>
  );
}

function FieldLabel({
  children,
  required,
}: {
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <span className="mb-1.5 block text-xs font-medium text-slate-700">
      {children}
      {required ? <span className="ml-0.5 text-red-500">*</span> : null}
    </span>
  );
}

export default function TapdBugPanel() {
  const [tapdStatus, setTapdStatus] = useState<TapdStatus | null>(null);
  const [chats, setChats] = useState<FeishuChat[]>([]);
  const [selectedChatIds, setSelectedChatIds] = useState<string[]>([]);
  const [manualChatInput, setManualChatInput] = useState("");
  const [chatQuery, setChatQuery] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("medium");
  const [reporterName, setReporterName] = useState("");
  const [mentionMembers, setMentionMembers] = useState<FeishuMember[]>([]);
  const [allMembers, setAllMembers] = useState<FeishuMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [memberQuery, setMemberQuery] = useState("");
  const [showMemberBrowse, setShowMemberBrowse] = useState(false);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [autoPolish, setAutoPolish] = useState(true);
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [descBeforePolish, setDescBeforePolish] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<{
    tone: "info" | "ok" | "warn" | "err";
    title: string;
    body?: string;
    url?: string;
  } | null>(null);

  const disabled = busy || aiBusy;
  const inputClass =
    "w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50 lg:text-[15px]";

  const loadMeta = useCallback(async () => {
    try {
      const [tapdRes, chatRes] = await Promise.all([
        fetch("/api/tapd/status", { cache: "no-store" }),
        fetch("/api/meal/feishu/chats", { cache: "no-store" }),
      ]);
      const tapd = await parseJsonResponse<TapdStatus & { ok?: boolean }>(tapdRes);
      setTapdStatus(tapd);
      const chatData = await parseJsonResponse<{
        ok?: boolean;
        chats?: FeishuChat[];
      }>(chatRes);
      const list = chatData.chats || [];
      setChats(list);
      setSelectedChatIds((prev) => {
        if (prev.length) return prev;
        return list.length === 1 ? [list[0].chat_id] : prev;
      });
    } catch {
      setTapdStatus({ configured: false });
    }
  }, []);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    return () => {
      attachments.forEach((a) => {
        if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
      });
    };
  }, [attachments]);

  const effectiveChatIds = useMemo(() => {
    const fromList = selectedChatIds.filter((id) => id.startsWith("oc_"));
    if (fromList.length) return fromList;
    return parseManualChatIds(manualChatInput);
  }, [selectedChatIds, manualChatInput]);

  const chatNameMap = useMemo(
    () => new Map(chats.map((c) => [c.chat_id, c.name || c.chat_id])),
    [chats],
  );

  const loadMembers = useCallback(async () => {
    if (!effectiveChatIds.length) {
      setAllMembers([]);
      return;
    }
    setMembersLoading(true);
    try {
      setAllMembers(await fetchMergedChatMembers(effectiveChatIds));
    } catch {
      setAllMembers([]);
    } finally {
      setMembersLoading(false);
    }
  }, [effectiveChatIds]);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  const availableChats = useMemo(() => {
    const q = chatQuery.trim().toLowerCase();
    return chats.filter((c) => {
      if (selectedChatIds.includes(c.chat_id)) return false;
      if (!q) return true;
      return (
        (c.name || "").toLowerCase().includes(q) ||
        c.chat_id.toLowerCase().includes(q)
      );
    });
  }, [chats, chatQuery, selectedChatIds]);

  const memberSuggestions = useMemo(() => {
    const q = memberQuery.trim().toLowerCase();
    const selected = new Set(mentionMembers.map((m) => m.open_id));
    return allMembers
      .filter((m) => !selected.has(m.open_id))
      .filter((m) => {
        if (!q) return true;
        return (
          m.name.toLowerCase().includes(q) ||
          m.open_id.toLowerCase().includes(q)
        );
      })
      .slice(0, 8);
  }, [allMembers, memberQuery, mentionMembers]);

  const browseMembers = useMemo(() => {
    const q = memberQuery.trim().toLowerCase();
    if (!q) return allMembers;
    return allMembers.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.open_id.toLowerCase().includes(q),
    );
  }, [allMembers, memberQuery]);

  const addChat = (chatId: string) => {
    setSelectedChatIds((prev) =>
      prev.includes(chatId) ? prev : [...prev, chatId],
    );
    setChatQuery("");
  };

  const removeChat = (chatId: string) => {
    setSelectedChatIds((prev) => prev.filter((id) => id !== chatId));
  };

  const addMember = (member: FeishuMember) => {
    setMentionMembers((prev) =>
      prev.some((m) => m.open_id === member.open_id)
        ? prev
        : [...prev, member],
    );
    setMemberQuery("");
  };

  const removeMember = (openId: string) => {
    setMentionMembers((prev) => prev.filter((m) => m.open_id !== openId));
  };

  const addFiles = (files: FileList | File[]) => {
    const incoming = Array.from(files);
    const errors: string[] = [];
    setAttachments((prev) => {
      const next = [...prev];
      for (const file of incoming) {
        if (next.length >= MAX_TAPD_ATTACHMENTS) {
          errors.push(`最多 ${MAX_TAPD_ATTACHMENTS} 个附件`);
          break;
        }
        if (!isAllowedAttachment(file)) {
          errors.push(`${file.name}：仅支持图片、视频或 HAR`);
          continue;
        }
        if (file.size > MAX_TAPD_ATTACHMENT_BYTES) {
          errors.push(`${file.name}：超过 ${formatFileSize(MAX_TAPD_ATTACHMENT_BYTES)}`);
          continue;
        }
        next.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          file,
          previewUrl: file.type.startsWith("image/")
            ? URL.createObjectURL(file)
            : null,
        });
      }
      return next;
    });
    if (errors.length) {
      setStatus({ tone: "warn", title: "部分文件未添加", body: errors.join("\n") });
    }
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => {
      const row = prev.find((a) => a.id === id);
      if (row?.previewUrl) URL.revokeObjectURL(row.previewUrl);
      return prev.filter((a) => a.id !== id);
    });
  };

  const canSubmit =
    !disabled &&
    title.trim().length > 0 &&
    effectiveChatIds.length > 0 &&
    tapdStatus?.configured;

  const tapdCreateUrl = useMemo(() => {
    const ws = tapdStatus?.workspace_id;
    if (!ws) return "";
    const base = (tapdStatus?.web_base || "https://www.tapd.cn").replace(/\/$/, "");
    return `${base}/${ws}/bugtrace/bugs/add`;
  }, [tapdStatus]);

  const runPolish = async (mode: "polish" | "generate") => {
    if (disabled) return;
    const t = title.trim();
    const d = description.trim();
    if (!t && !d) {
      setStatus({ tone: "warn", title: "请先填写标题或描述要点" });
      return;
    }
    setAiBusy(true);
    setStatus({
      tone: "info",
      title: mode === "polish" ? "AI 正在润色…" : "AI 正在生成描述…",
    });
    try {
      if (d) setDescBeforePolish(d);
      const system =
        mode === "polish" || d
          ? buildBugPolishSystemPrompt()
          : buildBugGenerateSystemPrompt();
      const userBlock = [
        t ? `缺陷标题：${t}` : "",
        reporterName.trim() ? `提交人：${reporterName.trim()}` : "",
        d ? `\n待润色内容：\n${d}` : "\n请根据标题生成完整缺陷描述。",
      ]
        .filter(Boolean)
        .join("\n");
      setDescription(await askTapdAI(system, userBlock));
      setStatus({
        tone: "ok",
        title: mode === "polish" ? "润色完成" : "描述已生成",
        body: "可继续微调，或点「还原」撤销",
      });
    } catch (e) {
      setStatus({
        tone: "err",
        title: "AI 处理失败",
        body: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setAiBusy(false);
    }
  };

  const restoreDescription = () => {
    if (!descBeforePolish.trim()) return;
    setDescription(descBeforePolish);
    setDescBeforePolish("");
  };

  const runAnalyzeFromMedia = async () => {
    if (disabled || attachments.length === 0) return;
    setAiBusy(true);
    setStatus({
      tone: "info",
      title: "正在智能分析…",
      body: "AI 正在分析截图/录屏/抓包并填充表单",
    });
    try {
      const prevDesc = description.trim();
      const prevTitle = title.trim();
      if (prevDesc || prevTitle) {
        setDescBeforePolish(prevDesc || prevTitle);
      }

      const result = await analyzeBugFromMedia(attachments.map((a) => a.file));
      if (result.title?.trim()) {
        setTitle(result.title.trim());
      }
      if (result.description?.trim()) {
        setDescription(result.description.trim());
      }
      if (result.priority) {
        const p = result.priority as TapdBugPriority;
        if (PRIORITY_OPTIONS.some((o) => o.value === p)) {
          setPriority(p);
        }
      }

      const analyzedCount = result.analyzed?.length ?? attachments.length;
      const harStats = (result.analyzed || [])
        .filter((a) => a.kind === "har" && a.entries != null)
        .map(
          (a) =>
            `${a.filename || "HAR"}：${a.entries} 条接口${a.errors != null ? ` / ${a.errors} 条异常` : ""}`,
        );
      const partialNote =
        result.partial_errors?.filter(Boolean).join("\n") || undefined;
      setStatus({
        tone: "ok",
        title: "分析完成，请确认后提交",
        body: [
          `已分析 ${analyzedCount} 个附件`,
          harStats.length ? harStats.join("\n") : null,
          result.confidence != null
            ? `置信度 ${Math.round(result.confidence * 100)}%`
            : null,
          partialNote ? `部分附件未识别：\n${partialNote}` : null,
        ]
          .filter(Boolean)
          .join("\n"),
      });
    } catch (e) {
      setStatus({
        tone: "err",
        title: "智能分析失败",
        body: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setAiBusy(false);
    }
  };

  const polishIfNeeded = async (): Promise<string> => {
    const d = description.trim();
    if (!autoPolish || (!title.trim() && !d)) return d;
    const system = d ? buildBugPolishSystemPrompt() : buildBugGenerateSystemPrompt();
    const userBlock = [
      `缺陷标题：${title.trim()}`,
      reporterName.trim() ? `提交人：${reporterName.trim()}` : "",
      d ? `\n待润色内容：\n${d}` : "\n请根据标题生成完整缺陷描述。",
    ]
      .filter(Boolean)
      .join("\n");
    const polished = await askTapdAI(system, userBlock);
    setDescription(polished);
    if (d) setDescBeforePolish(d);
    return polished;
  };

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setStatus({ tone: "info", title: "正在提交…", body: "创建 TAPD 缺陷并发送飞书通知" });
    try {
      let finalDescription = description.trim();
      if (autoPolish) {
        setAiBusy(true);
        try {
          finalDescription = await polishIfNeeded();
        } finally {
          setAiBusy(false);
        }
      }

      const fd = new FormData();
      fd.append("title", title.trim());
      fd.append("description", finalDescription);
      fd.append("chat_ids", JSON.stringify(effectiveChatIds));
      fd.append("priority_label", priority);
      fd.append("reporter_name", reporterName.trim());
      fd.append(
        "mentions",
        JSON.stringify(
          mentionMembers.map((m) => ({ open_id: m.open_id, name: m.name })),
        ),
      );
      for (const a of attachments) {
        fd.append("attachments", a.file, a.file.name);
      }

      const res = await fetch("/api/tapd/bugs/create", {
        method: "POST",
        body: fd,
      });
      const d = await parseJsonResponse<{
        ok?: boolean;
        error?: string;
        detail?: string;
        bug?: { id?: string; url?: string; title?: string };
        feishu?: {
          ok?: boolean;
          sent?: number;
          total?: number;
          results?: Array<{ chat_id?: string; ok?: boolean; error?: string }>;
        };
        attachments?: { uploaded?: number; errors?: string[] | null };
      }>(res);

      if (!d.ok) {
        setStatus({
          tone: "err",
          title: "提交失败",
          body: d.error || d.detail || "未知错误",
        });
        return;
      }

      const feishuResults = d.feishu?.results ?? [];
      const feishuSent =
        feishuResults.length > 0
          ? feishuResults.filter(
              (r) => r.ok || isFeishuCliNoiseError(r.error),
            ).length
          : (d.feishu?.sent ?? 0);
      const feishuTotal = feishuResults.length || d.feishu?.total || 0;
      const realFeishuFailures = feishuResults.filter(
        (r) => !r.ok && !isFeishuCliNoiseError(r.error),
      );
      const attErr = d.attachments?.errors?.filter(Boolean) ?? [];
      const partialFail = realFeishuFailures.length > 0 || attErr.length > 0;

      const notes = [
        feishuTotal > 0 ? `已通知 ${feishuSent} 个群` : "",
        mentionMembers.length ? `@ ${mentionMembers.length} 人` : "",
        d.attachments?.uploaded ? `${d.attachments.uploaded} 个附件已上传` : "",
        realFeishuFailures.length
          ? realFeishuFailures
              .map(
                (r) =>
                  `${chatNameMap.get(r.chat_id || "") || r.chat_id}: ${r.error || "失败"}`,
              )
              .join("\n")
          : "",
        attErr.length ? attErr.join("\n") : "",
        d.bug?.id ? `#${d.bug.id}` : "",
      ].filter(Boolean);

      setStatus({
        tone: partialFail ? "warn" : "ok",
        title: partialFail ? "已创建，部分通知未送达" : "提交成功",
        body: notes.join(" · "),
        url: d.bug?.url,
      });

      setTitle("");
      setDescription("");
      setDescBeforePolish("");
      setMentionMembers([]);
      setMemberQuery("");
      setChatQuery("");
      attachments.forEach((a) => {
        if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
      });
      setAttachments([]);
    } catch (e) {
      setStatus({
        tone: "err",
        title: "提交失败",
        body: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  };

  const submitSummary = [
    effectiveChatIds.length
      ? `${effectiveChatIds.length} 个群`
      : "未选群",
    mentionMembers.length ? `@${mentionMembers.length} 人` : "不 @ 人",
    attachments.length ? `${attachments.length} 个附件` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 顶栏 */}
      <div className="shrink-0 border-b border-slate-100 bg-white py-3">
        <div className={`${CONTENT_CLASS} flex items-center justify-between gap-3 px-4 sm:px-6 lg:px-8`}>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-slate-900">提交缺陷</h2>
            <p className="text-xs text-slate-500">填写问题 → 选择通知对象 → 一键提交</p>
          </div>
          {tapdStatus?.configured && tapdStatus.workspace_id ? (
            <div className="flex shrink-0 items-center gap-2">
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                项目 {tapdStatus.workspace_id}
              </span>
              {tapdCreateUrl ? (
                <a
                  href={tapdCreateUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-indigo-600 hover:underline"
                >
                  TAPD ↗
                </a>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {/* 状态条 */}
      {status ? (
        <div
          className={`shrink-0 border-b px-4 py-3 sm:px-6 ${
            status.tone === "ok"
              ? "border-emerald-100 bg-emerald-50"
              : status.tone === "warn"
                ? "border-amber-100 bg-amber-50"
                : status.tone === "err"
                  ? "border-red-100 bg-red-50"
                  : "border-blue-100 bg-blue-50"
          }`}
        >
          <div className={`${CONTENT_CLASS} px-4 sm:px-6 lg:px-8`}>
            <p
              className={`text-sm font-medium ${
                status.tone === "ok"
                  ? "text-emerald-900"
                  : status.tone === "warn"
                    ? "text-amber-900"
                    : status.tone === "err"
                      ? "text-red-900"
                      : "text-blue-900"
              }`}
            >
              {status.title}
            </p>
            {status.body ? (
              <p className="mt-0.5 text-xs opacity-80">{status.body}</p>
            ) : null}
            {status.url ? (
              <a
                href={status.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-indigo-700 hover:underline"
              >
                在 TAPD 中查看 →
              </a>
            ) : null}
          </div>
        </div>
      ) : null}

      {!tapdStatus?.configured && tapdStatus !== null ? (
        <div className="shrink-0 border-b border-amber-100 bg-amber-50 py-2.5">
          <p className={`${CONTENT_CLASS} px-4 text-xs text-amber-900 sm:px-6 lg:px-8`}>
            TAPD 未配置，请在 backend/.env 设置 TAPD_WORKSPACE_ID 与凭据。
          </p>
        </div>
      ) : null}

      {/* 主表单：宽屏双栏 */}
      <div className="min-h-0 flex-1 overflow-y-auto py-5 lg:py-6">
        <div
          className={`${CONTENT_CLASS} grid gap-5 px-4 pb-28 sm:px-6 lg:grid-cols-12 lg:gap-6 lg:px-8`}
        >
          {/* 左栏：问题描述 */}
          <div className="lg:col-span-7 xl:col-span-8">
          <Section step={1} title="描述问题" hint="标题必填；描述可只写要点，交给 AI 润色" className="h-full">
            <div className="space-y-4">
              <div>
                <FieldLabel required>缺陷标题</FieldLabel>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={disabled}
                  placeholder="例如：登录页点击提交后白屏"
                  className={inputClass}
                />
              </div>

              <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
                <div className="flex-1">
                  <FieldLabel>优先级</FieldLabel>
                  <div className="flex flex-wrap gap-2">
                    {PRIORITY_OPTIONS.map((p) => (
                      <button
                        key={p.value}
                        type="button"
                        disabled={disabled}
                        onClick={() => setPriority(p.value)}
                        className={`rounded-full px-4 py-1.5 text-sm font-medium ring-1 transition ${
                          priority === p.value
                            ? `${p.color} ring-current`
                            : "bg-white text-slate-500 ring-slate-200 hover:bg-slate-50"
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="lg:w-44">
                  <FieldLabel>提交人</FieldLabel>
                  <input
                    value={reporterName}
                    onChange={(e) => setReporterName(e.target.value)}
                    disabled={disabled}
                    placeholder="可选"
                    className={inputClass}
                  />
                </div>
              </div>

              <div>
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                  <FieldLabel>详细描述</FieldLabel>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1.5 text-[11px] text-slate-500">
                      <input
                        type="checkbox"
                        checked={autoPolish}
                        onChange={(e) => setAutoPolish(e.target.checked)}
                        disabled={disabled}
                        className="rounded border-slate-300"
                      />
                      提交时自动润色
                    </label>
                    <button
                      type="button"
                      disabled={disabled || (!title.trim() && !description.trim())}
                      onClick={() =>
                        void runPolish(description.trim() ? "polish" : "generate")
                      }
                      className="text-[11px] font-medium text-indigo-600 hover:text-indigo-800 disabled:opacity-40"
                    >
                      {aiBusy ? "处理中…" : description.trim() ? "✨ 润色" : "✨ 生成"}
                    </button>
                    {descBeforePolish.trim() ? (
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={restoreDescription}
                        className="text-[11px] text-slate-500 hover:text-slate-700"
                      >
                        还原
                      </button>
                    ) : null}
                  </div>
                </div>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={disabled}
                  rows={8}
                  placeholder={"复现步骤、实际结果、期望结果…\n只写关键词也可以，点「润色」或开启自动润色"}
                  className={`${inputClass} min-h-[180px] resize-y leading-relaxed lg:min-h-[220px]`}
                />
              </div>

              <div>
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                  <FieldLabel>截图 / 录屏 / 抓包</FieldLabel>
                  <button
                    type="button"
                    disabled={disabled || attachments.length === 0}
                    onClick={() => void runAnalyzeFromMedia()}
                    className="rounded-lg bg-indigo-600 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
                  >
                    {aiBusy ? "分析中…" : "智能分析"}
                  </button>
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*,video/*,.har"
                  multiple
                  className="hidden"
                  disabled={disabled}
                  onChange={(e) => {
                    if (e.target.files?.length) addFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
              <div className="lg:flex lg:gap-4">
                <div
                  role="button"
                  tabIndex={0}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
                  }}
                  onClick={() => !disabled && fileRef.current?.click()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") fileRef.current?.click();
                  }}
                  className={`flex-1 cursor-pointer rounded-xl border-2 border-dashed px-4 py-8 text-center transition lg:py-10 ${
                    dragOver
                      ? "border-indigo-400 bg-indigo-50/50"
                      : "border-slate-200 bg-slate-50/40 hover:border-indigo-300 hover:bg-indigo-50/30"
                  } ${disabled ? "pointer-events-none opacity-50" : ""}`}
                >
                  <p className="text-sm text-slate-600">
                    拖拽图片/视频/HAR 到此处，或<span className="text-indigo-600">点击上传</span>
                  </p>
                  <p className="mt-1 text-[11px] text-slate-400">
                    支持 HAR 抓包 · 最多 {MAX_TAPD_ATTACHMENTS} 个 · 单个 ≤{" "}
                    {formatFileSize(MAX_TAPD_ATTACHMENT_BYTES)}
                  </p>
                </div>
                {attachments.length > 0 ? (
                  <ul className="mt-3 flex flex-wrap gap-2 lg:mt-0 lg:max-w-[280px] lg:content-start">
                    {attachments.map((a) => (
                      <li
                        key={a.id}
                        className="group relative overflow-hidden rounded-lg border border-slate-200 bg-white"
                      >
                        {a.previewUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={a.previewUrl}
                            alt=""
                            className="h-24 w-24 object-cover lg:h-28 lg:w-28"
                          />
                        ) : (
                          <div className="flex h-24 w-24 items-center justify-center bg-slate-100 text-2xl lg:h-28 lg:w-28">
                            {isHarAttachment(a.file) ? "🌐" : "🎬"}
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeAttachment(a.id);
                          }}
                          className="absolute right-1 top-1 rounded-full bg-black/50 px-1.5 text-[10px] text-white opacity-0 transition group-hover:opacity-100"
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              </div>
            </div>
          </Section>
          </div>

          {/* 右栏：飞书通知（宽屏 sticky） */}
          <div className="lg:col-span-5 xl:col-span-4">
            <div className="lg:sticky lg:top-4">
          <Section
            step={2}
            title="通知到飞书"
            hint="选择群聊并 @ 相关同事；机器人须已加入所选群"
          >
            <div className="space-y-5">
              {/* 群聊 */}
              <div>
                <FieldLabel required>群聊</FieldLabel>
                {selectedChatIds.length > 0 ? (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {selectedChatIds.map((id) => (
                      <Chip
                        key={id}
                        label={chatNameMap.get(id) || id.slice(0, 12) + "…"}
                        onRemove={() => removeChat(id)}
                        disabled={disabled}
                      />
                    ))}
                  </div>
                ) : null}

                {chats.length > 0 ? (
                  <>
                    <input
                      value={chatQuery}
                      onChange={(e) => setChatQuery(e.target.value)}
                      disabled={disabled}
                      placeholder="搜索群名，点击添加"
                      className={inputClass}
                    />
                    {availableChats.length > 0 ? (
                      <ul className="mt-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                        {availableChats.slice(0, 6).map((c) => (
                          <li key={c.chat_id}>
                            <button
                              type="button"
                              disabled={disabled}
                              onClick={() => addChat(c.chat_id)}
                              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-indigo-50"
                            >
                              <span className="text-base opacity-60">💬</span>
                              <span className="truncate font-medium">
                                {c.name || c.chat_id}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : chatQuery.trim() ? (
                      <p className="mt-1.5 text-xs text-slate-400">没有匹配的群</p>
                    ) : selectedChatIds.length === chats.length ? (
                      <p className="mt-1.5 text-xs text-slate-400">已选择全部群聊</p>
                    ) : null}
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => setSelectedChatIds(chats.map((c) => c.chat_id))}
                      className="mt-1.5 text-[11px] text-indigo-600 hover:underline disabled:opacity-40"
                    >
                      选择全部 {chats.length} 个群
                    </button>
                  </>
                ) : (
                  <textarea
                    value={manualChatInput}
                    onChange={(e) => setManualChatInput(e.target.value)}
                    disabled={disabled}
                    rows={2}
                    placeholder="输入 oc_ 开头的 chat_id，多个用逗号分隔"
                    className={`${inputClass} font-mono text-xs`}
                  />
                )}
              </div>

              {/* 成员 */}
              <div>
                <FieldLabel>@ 成员（可选）</FieldLabel>
                {effectiveChatIds.length === 0 ? (
                  <p className="rounded-lg bg-slate-50 px-3 py-3 text-xs text-slate-500">
                    先选择群聊，再搜索要 @ 的同事
                  </p>
                ) : (
                  <>
                    {mentionMembers.length > 0 ? (
                      <div className="mb-2 flex flex-wrap gap-1.5">
                        {mentionMembers.map((m) => (
                          <Chip
                            key={m.open_id}
                            label={`@${m.name}`}
                            onRemove={() => removeMember(m.open_id)}
                            disabled={disabled}
                          />
                        ))}
                      </div>
                    ) : null}

                    <div className="relative">
                      <input
                        value={memberQuery}
                        onChange={(e) => setMemberQuery(e.target.value)}
                        disabled={disabled || membersLoading}
                        placeholder={
                          membersLoading ? "加载成员中…" : "输入姓名搜索并添加"
                        }
                        className={inputClass}
                      />
                      {memberSuggestions.length > 0 && memberQuery.trim() ? (
                        <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
                          {memberSuggestions.map((m) => (
                            <li key={m.open_id}>
                              <button
                                type="button"
                                disabled={disabled}
                                onClick={() => addMember(m)}
                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-indigo-50"
                              >
                                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-700">
                                  {m.name.slice(-1)}
                                </span>
                                {m.name}
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>

                    <button
                      type="button"
                      disabled={disabled || membersLoading || !allMembers.length}
                      onClick={() => setShowMemberBrowse((v) => !v)}
                      className="mt-2 flex items-center gap-1 text-[11px] text-slate-500 hover:text-indigo-600"
                    >
                      <span
                        className={`inline-block transition ${showMemberBrowse ? "rotate-90" : ""}`}
                      >
                        ▸
                      </span>
                      浏览全部成员（{allMembers.length}）
                    </button>

                    {showMemberBrowse ? (
                      <div className="mt-2 max-h-36 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50/50 p-1">
                        {browseMembers.length === 0 ? (
                          <p className="px-3 py-2 text-xs text-slate-400">暂无成员</p>
                        ) : (
                          browseMembers.map((m) => {
                            const checked = mentionMembers.some(
                              (x) => x.open_id === m.open_id,
                            );
                            return (
                              <button
                                key={m.open_id}
                                type="button"
                                disabled={disabled}
                                onClick={() =>
                                  checked ? removeMember(m.open_id) : addMember(m)
                                }
                                className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs transition ${
                                  checked
                                    ? "bg-indigo-100 text-indigo-900"
                                    : "hover:bg-white text-slate-700"
                                }`}
                              >
                                <span
                                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${
                                    checked
                                      ? "border-indigo-500 bg-indigo-500 text-white"
                                      : "border-slate-300 bg-white"
                                  }`}
                                >
                                  {checked ? "✓" : ""}
                                </span>
                                {m.name}
                              </button>
                            );
                          })
                        )}
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          </Section>
            </div>
          </div>
        </div>
      </div>

      {/* 底部固定提交栏 */}
      <div className="shrink-0 border-t border-slate-200 bg-white/95 py-3 backdrop-blur">
        <div className={`${CONTENT_CLASS} flex items-center gap-4 px-4 sm:px-6 lg:px-8`}>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-slate-600">{submitSummary}</p>
            {!canSubmit && !disabled ? (
              <p className="text-xs text-amber-600">
                {!title.trim()
                  ? "请填写标题"
                  : !effectiveChatIds.length
                    ? "请选择至少一个群"
                    : ""}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => void submit()}
            className="shrink-0 rounded-xl bg-indigo-600 px-8 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
          >
            {busy ? "提交中…" : "提交缺陷"}
          </button>
        </div>
      </div>
    </div>
  );
}
