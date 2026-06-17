"use client";

import { MarkdownSummaryPreview } from "@/components/MarkdownSummaryPreview";
import {
  CsTopicGroup,
  CsWorkspace,
  WorkspaceConfigPanel,
  WorkspaceSwitcher,
} from "@/components/customer-service/WorkspaceConfigPanel";
import {
  ArrowLeft,
  BookOpen,
  Menu,
  MessageSquarePlus,
  PanelLeftClose,
  SendHorizontal,
  Square,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import "../app/customer-service/customer-service.css";

const API_PREFIX = "/api/v1/ai-customer-service";
const CHAT_STREAM = `${API_PREFIX}/chat/stream`;
const LS_ACTIVE_WS = "ai_cs_active_workspace_id";
const MODE_PATH = `${API_PREFIX}/config/mode`;

type ChatMode = "agent" | "faq_only";

type Msg = {
  role: "user" | "assistant";
  text: string;
  turnIndex?: number;
  confidence?: number;
  userQuestion?: string;
};

function sessionKey(workspaceId: string) {
  return `ai_cs_session_${workspaceId || "default"}`;
}

function readSessionId(workspaceId: string): string {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(sessionKey(workspaceId))?.trim() ?? "";
  } catch {
    return "";
  }
}

function writeSessionId(workspaceId: string, id: string) {
  try {
    if (id) localStorage.setItem(sessionKey(workspaceId), id);
    else localStorage.removeItem(sessionKey(workspaceId));
  } catch {
    /* ignore */
  }
}

function readActiveWorkspaceId(): string {
  try {
    return localStorage.getItem(LS_ACTIVE_WS)?.trim() ?? "";
  } catch {
    return "";
  }
}

function writeActiveWorkspaceId(id: string) {
  try {
    if (id) localStorage.setItem(LS_ACTIVE_WS, id);
    else localStorage.removeItem(LS_ACTIVE_WS);
  } catch {
    /* ignore */
  }
}

function consumeNamedSse(buffer: string): {
  events: Array<{ event: string; data: Record<string, unknown> }>;
  rest: string;
} {
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  for (const block of parts) {
    let eventType = "message";
    let dataRaw = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) eventType = line.slice(6).trim();
      else if (line.startsWith("data:")) dataRaw = line.slice(5).trim();
    }
    if (!dataRaw) continue;
    try {
      events.push({
        event: eventType,
        data: JSON.parse(dataRaw) as Record<string, unknown>,
      });
    } catch {
      /* ignore */
    }
  }
  return { events, rest };
}

function mapHistoryMessages(raw: Array<Record<string, unknown>>): Msg[] {
  const out: Msg[] = [];
  let lastUser = "";
  for (let i = 0; i < raw.length; i++) {
    const row = raw[i];
    const role = row.role === "user" ? "user" : "assistant";
    const text = String(row.content ?? "");
    if (role === "user") {
      lastUser = text;
      out.push({ role: "user", text });
      continue;
    }
    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    out.push({
      role: "assistant",
      text,
      turnIndex: typeof row.turn_index === "number" ? row.turn_index : i,
      confidence: typeof meta.confidence === "number" ? meta.confidence : undefined,
      userQuestion: lastUser,
    });
  }
  return out;
}

function confidenceLabel(score?: number): { text: string; className: string } | null {
  if (score == null) return null;
  if (score >= 0.78) return { text: "高匹配", className: "customer-confidence--high" };
  if (score >= 0.55) return { text: "中等匹配", className: "customer-confidence--mid" };
  return { text: "参考回答", className: "" };
}

export default function CustomerServiceChat() {
  const [workspaces, setWorkspaces] = useState<CsWorkspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState("");
  const [topicGroups, setTopicGroups] = useState<CsTopicGroup[]>([]);
  const [configOpen, setConfigOpen] = useState(false);
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<string | null>(null);

  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState("");
  const [backendOk, setBackendOk] = useState<boolean | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [chatMode, setChatMode] = useState<ChatMode>("agent");
  const [modeLoading, setModeLoading] = useState(false);
  const [feedbackIdx, setFeedbackIdx] = useState<number | null>(null);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [feedbackOk, setFeedbackOk] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [asideOpen, setAsideOpen] = useState(false);

  const activeWorkspace = useMemo(
    () => workspaces.find((w) => w.id === activeWorkspaceId) ?? workspaces[0] ?? null,
    [workspaces, activeWorkspaceId],
  );

  const canSend = useMemo(() => input.trim().length > 0 && !busy, [input, busy]);

  const resizeComposer = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, []);

  const loadWorkspaces = useCallback(async () => {
    const r = await fetch(`${API_PREFIX}/workspaces`, { cache: "no-store" });
    if (!r.ok) {
      setBackendOk(false);
      return null;
    }
    const data = (await r.json()) as {
      workspaces?: CsWorkspace[];
      active_workspace_id?: string;
    };
    const rows = Array.isArray(data.workspaces) ? data.workspaces : [];
    setWorkspaces(rows);
    setBackendOk(true);
    const stored = readActiveWorkspaceId();
    const nextId =
      (stored && rows.some((w) => w.id === stored) ? stored : "") ||
      data.active_workspace_id ||
      rows.find((w) => w.is_default)?.id ||
      rows[0]?.id ||
      "";
    return { rows, nextId };
  }, []);

  const loadSuggestions = useCallback(async (workspaceId: string) => {
    if (!workspaceId) {
      setTopicGroups([]);
      return;
    }
    const r = await fetch(
      `${API_PREFIX}/workspaces/${encodeURIComponent(workspaceId)}/suggestions`,
      { cache: "no-store" },
    );
    if (!r.ok) return;
    const data = (await r.json()) as { topic_groups?: CsTopicGroup[] };
    setTopicGroups(Array.isArray(data.topic_groups) ? data.topic_groups : []);
  }, []);

  const activateWorkspace = useCallback(
    async (workspaceId: string, options?: { resetChat?: boolean }) => {
      const resetChat = options?.resetChat ?? true;
      if (!workspaceId) return;
      await fetch(`${API_PREFIX}/config/active-workspace`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace_id: workspaceId }),
      }).catch(() => undefined);
      writeActiveWorkspaceId(workspaceId);
      setActiveWorkspaceId(workspaceId);
      await loadSuggestions(workspaceId);
      if (resetChat) {
        abortRef.current?.abort();
        setMessages([]);
        setStreamingText("");
        setErr(null);
        setInput("");
        setFeedbackIdx(null);
        setFeedbackText("");
        setFeedbackOk(null);
        const sid = readSessionId(workspaceId);
        setSessionId(sid);
        if (sid) {
          setHistoryLoading(true);
          fetch(`${API_PREFIX}/sessions/${encodeURIComponent(sid)}/history`, {
            cache: "no-store",
          })
            .then((r) => (r.ok ? r.json() : null))
            .then((data: { messages?: Array<Record<string, unknown>> } | null) => {
              const rows = Array.isArray(data?.messages) ? data.messages : [];
              if (rows.length > 0) setMessages(mapHistoryMessages(rows));
            })
            .catch(() => undefined)
            .finally(() => setHistoryLoading(false));
        } else {
          setHistoryLoading(false);
        }
      }
    },
    [loadSuggestions],
  );

  useEffect(() => {
    void (async () => {
      const result = await loadWorkspaces();
      if (!result) return;
      const { nextId } = result;
      if (nextId) await activateWorkspace(nextId, { resetChat: true });
      fetch(MODE_PATH)
        .then((r) => r.json())
        .then((d: { mode: string }) => {
          if (d.mode === "faq_only" || d.mode === "agent") setChatMode(d.mode);
        })
        .catch(() => undefined);
    })();
  }, [activateWorkspace, loadWorkspaces]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText, busy]);

  useEffect(() => {
    resizeComposer();
  }, [input, resizeComposer]);

  const setMode = useCallback(
    async (next: ChatMode) => {
      if (next === chatMode || modeLoading) return;
      setModeLoading(true);
      try {
        const r = await fetch(MODE_PATH, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: next }),
        });
        const d = (await r.json()) as { mode: string };
        if (d.mode === "faq_only" || d.mode === "agent") setChatMode(d.mode);
      } catch {
        setChatMode(next);
      } finally {
        setModeLoading(false);
      }
    },
    [chatMode, modeLoading],
  );

  const sendStream = useCallback(
    async (text: string, ac: AbortController, sid: string, workspaceId: string) => {
      const res = await fetch(CHAT_STREAM, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          workspace_id: workspaceId,
          structured_intent: false,
          use_llm: chatMode === "agent",
          ...(sid ? { session_id: sid } : {}),
        }),
        signal: ac.signal,
      });

      if (!res.ok || !res.body) {
        setErr(
          res.status >= 500
            ? "服务暂时繁忙，请稍后再试。"
            : `暂时无法连接客服（${res.status}）`,
        );
        return null;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let assistant = "";
      let streamError: string | null = null;
      let newSessionId = sid;
      let confidence: number | undefined;
      let turnIndex: number | undefined;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const { events, rest } = consumeNamedSse(buf);
        buf = rest;

        for (const ev of events) {
          if (ev.event === "metadata") {
            const metaSid = ev.data.session_id;
            if (typeof metaSid === "string" && metaSid) newSessionId = metaSid;
          } else if (ev.event === "token") {
            const token = ev.data.token;
            if (typeof token === "string") {
              assistant += token;
              setStreamingText(assistant);
            }
          } else if (ev.event === "reply_replace") {
            const reply = ev.data.reply;
            if (typeof reply === "string") {
              assistant = reply;
              setStreamingText(assistant);
            }
          } else if (ev.event === "reply_done") {
            if (assistant.trim()) setBusy(false);
          } else if (ev.event === "error") {
            streamError = String(ev.data.error ?? "出了点问题，请重试。");
          } else if (ev.event === "done") {
            const doneSid = ev.data.session_id;
            if (typeof doneSid === "string" && doneSid) newSessionId = doneSid;
            if (typeof ev.data.confidence === "number") confidence = ev.data.confidence;
            if (typeof ev.data.conversation_len === "number") {
              turnIndex = ev.data.conversation_len - 1;
            }
          }
        }
      }

      setStreamingText("");
      if (streamError) {
        setErr(streamError);
        if (assistant.trim()) {
          return { text: assistant.trim(), sessionId: newSessionId, confidence, turnIndex };
        }
        return null;
      }

      return {
        text: assistant.trim() || "抱歉，暂时没有生成回复，请换个说法试试。",
        sessionId: newSessionId,
        confidence,
        turnIndex,
      };
    },
    [chatMode],
  );

  const send = useCallback(
    async (raw?: string) => {
      const text = (raw ?? input).trim();
      if (!text || busy || !activeWorkspaceId) return;

      setAsideOpen(false);
      setErr(null);
      setFeedbackOk(null);
      setStreamingText("");
      setMessages((m) => [...m, { role: "user", text }]);
      if (!raw) setInput("");
      setBusy(true);

      const ac = new AbortController();
      abortRef.current = ac;

      try {
        const result = await sendStream(text, ac, sessionId, activeWorkspaceId);
        if (result) {
          if (result.sessionId && result.sessionId !== sessionId) {
            setSessionId(result.sessionId);
            writeSessionId(activeWorkspaceId, result.sessionId);
          }
          setMessages((m) => [
            ...m,
            {
              role: "assistant",
              text: result.text,
              turnIndex: result.turnIndex,
              confidence: result.confidence,
              userQuestion: text,
            },
          ]);
        }
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setErr("网络异常，请检查连接后重试。");
      } finally {
        setBusy(false);
        abortRef.current = null;
      }
    },
    [activeWorkspaceId, busy, input, sendStream, sessionId],
  );

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    setStreamingText("");
  }, []);

  const clearChat = useCallback(() => {
    if (!activeWorkspaceId) return;
    stopGeneration();
    setMessages([]);
    setErr(null);
    setInput("");
    setFeedbackIdx(null);
    setFeedbackText("");
    setFeedbackOk(null);
    setSessionId("");
    writeSessionId(activeWorkspaceId, "");
  }, [activeWorkspaceId, stopGeneration]);

  const copyMessage = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* ignore */
    }
  }, []);

  const submitFeedback = useCallback(async () => {
    const idx = feedbackIdx;
    if (idx == null || !sessionId) return;
    const msg = messages[idx];
    if (!msg || msg.role !== "assistant") return;
    const correction = feedbackText.trim();
    if (!correction) {
      setErr("请填写你认为正确的答案或说明");
      return;
    }
    setFeedbackBusy(true);
    setErr(null);
    try {
      const res = await fetch(
        `${API_PREFIX}/sessions/${encodeURIComponent(sessionId)}/feedback`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_message: msg.userQuestion ?? "",
            correction,
            turn_index: msg.turnIndex,
          }),
        },
      );
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setErr(data.error ?? "反馈提交失败");
        return;
      }
      setFeedbackOk("感谢反馈，我们会审核后更新知识库。");
      setFeedbackIdx(null);
      setFeedbackText("");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setFeedbackBusy(false);
    }
  }, [feedbackIdx, feedbackText, messages, sessionId]);

  const refreshAfterConfig = useCallback(async () => {
    const result = await loadWorkspaces();
    if (!result) return;
    const id = activeWorkspaceId || result.nextId;
    if (id) await activateWorkspace(id, { resetChat: false });
  }, [activeWorkspaceId, activateWorkspace, loadWorkspaces]);

  const showWelcome = messages.length === 0 && !busy && !historyLoading;
  const wsIcon = activeWorkspace?.icon || "✦";
  const wsName = activeWorkspace?.name || "客服助手";
  const wsDesc =
    activeWorkspace?.description ||
    activeWorkspace?.welcome_message ||
    "绑定知识库后即可服务对应领域。";

  const modeHint =
    chatMode === "faq_only"
      ? "FAQ 模式：匹配 FAQ 与已绑定文档正文，响应更快"
      : "Agent 模式：知识库检索 + 大模型组织回答";

  const composerPlaceholder = activeWorkspace?.domain
    ? `描述你的${activeWorkspace.domain}问题…`
    : "描述你的问题…";

  return (
    <div className="customer-app">
      {asideOpen && (
        <button
          type="button"
          className="customer-overlay-backdrop"
          aria-label="关闭侧栏"
          onClick={() => setAsideOpen(false)}
        />
      )}

      <aside className={`customer-aside${asideOpen ? " is-open" : ""}`}>
        <div className="customer-aside__scroll">
          <div className="customer-aside__top">
            <Link href="/workbench" className="customer-back">
              <ArrowLeft size={16} aria-hidden />
              工作台
            </Link>
            <button
              type="button"
              className="customer-icon-btn customer-mobile-toggle"
              aria-label="关闭菜单"
              onClick={() => setAsideOpen(false)}
            >
              <PanelLeftClose size={16} />
            </button>
          </div>

          <WorkspaceSwitcher
            workspaces={workspaces}
            activeId={activeWorkspaceId}
            onSelect={(id) => void activateWorkspace(id)}
            onCreate={() => {
              setEditingWorkspaceId(null);
              setConfigOpen(true);
            }}
            onConfigure={(id) => {
              setEditingWorkspaceId(id);
              setConfigOpen(true);
            }}
          />

          <div className="customer-brand-block">
            <div className="customer-brand-logo" aria-hidden>
              {wsIcon}
            </div>
            <div>
              <h1>{wsName}</h1>
              <p>{wsDesc}</p>
            </div>
          </div>

          <div className="customer-status">
            <span
              className={`customer-status-pill${backendOk === false ? " customer-status-pill--warn" : " customer-status-pill--ok"}`}
            >
              <span className="customer-status-dot" aria-hidden />
              {backendOk === false ? "后端未连接" : "服务在线"}
            </span>
            {(activeWorkspace?.faq_item_count ?? 0) > 0 && (
              <span className="customer-status-pill">
                知识库 {activeWorkspace?.faq_item_count} 条
              </span>
            )}
          </div>

          <section>
            <p className="customer-section-title">回答方式</p>
            <div className="customer-mode-cards">
              <button
                type="button"
                className={`customer-mode-card${chatMode === "agent" ? " is-active" : ""}`}
                disabled={modeLoading}
                onClick={() => void setMode("agent")}
              >
                <span className="customer-mode-card__icon" aria-hidden>
                  🤖
                </span>
                <span className="customer-mode-card__body">
                  <strong>智能 Agent</strong>
                  <span>结合知识库与大模型，适合复杂问题与追问</span>
                </span>
              </button>
              <button
                type="button"
                className={`customer-mode-card${chatMode === "faq_only" ? " is-active" : ""}`}
                disabled={modeLoading}
                onClick={() => void setMode("faq_only")}
              >
                <span className="customer-mode-card__icon" aria-hidden>
                  📚
                </span>
                <span className="customer-mode-card__body">
                  <strong>快速 FAQ</strong>
                  <span>直接匹配知识库，响应更快、结果更稳定</span>
                </span>
              </button>
            </div>
          </section>

          {topicGroups.length > 0 && (
            <section>
              <p className="customer-section-title">常见问题</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {topicGroups.map((group) => (
                  <div key={group.id} className="customer-topic-group">
                    <div className="customer-topic-head">
                      <span aria-hidden>{group.icon}</span>
                      {group.title}
                    </div>
                    {group.questions.map((q) => (
                      <button
                        key={q}
                        type="button"
                        className="customer-topic-q"
                        disabled={busy}
                        onClick={() => void send(q)}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="customer-aside__foot">
          <Link href="/knowledge" className="customer-aside-link">
            <BookOpen size={16} aria-hidden />
            管理知识库
          </Link>
          <button
            type="button"
            className="customer-aside-link customer-aside-link--ghost"
            onClick={clearChat}
          >
            <MessageSquarePlus size={16} aria-hidden />
            开始新对话
          </button>
        </div>
      </aside>

      <div className="customer-main">
        <header className="customer-main__header">
          <div>
            <h2>{wsName}</h2>
            <p>
              {modeHint}
              {activeWorkspace?.domain ? ` · ${activeWorkspace.domain}` : ""}
            </p>
          </div>
          <div className="customer-header-actions">
            <button
              type="button"
              className="customer-icon-btn customer-mobile-toggle"
              aria-label="打开菜单"
              onClick={() => setAsideOpen(true)}
            >
              <Menu size={16} />
            </button>
            <button
              type="button"
              className="customer-icon-btn"
              onClick={() => {
                setEditingWorkspaceId(activeWorkspaceId || null);
                setConfigOpen(true);
              }}
            >
              配置实例
            </button>
            <button
              type="button"
              className="customer-icon-btn"
              onClick={clearChat}
              disabled={busy && messages.length === 0}
            >
              新对话
            </button>
          </div>
        </header>

        {backendOk === false && (
          <div className="customer-banner customer-banner--error" role="alert">
            AI 客服后端未连接。请确认主项目后端已启动（默认 http://127.0.0.1:8000），或检查
            BACKEND_URL 环境变量。
          </div>
        )}

        {feedbackOk && (
          <div className="customer-banner customer-banner--success">{feedbackOk}</div>
        )}
        {err && <div className="customer-banner customer-banner--error">{err}</div>}

        <div className="customer-messages">
          <div className="customer-messages-inner">
            {showWelcome && (
              <div className="customer-hero">
                <div className="customer-hero__badge">
                  {chatMode === "faq_only" ? "📚 FAQ 快速匹配" : `${wsIcon} ${wsName}`}
                </div>
                <h2>{activeWorkspace?.welcome_message || "你好，需要什么帮助？"}</h2>
                <p>{wsDesc}</p>
                {topicGroups.length > 0 && (
                  <div className="customer-hero-grid">
                    {topicGroups.map((group) => (
                      <button
                        key={group.id}
                        type="button"
                        className="customer-hero-card"
                        disabled={busy}
                        onClick={() => void send(group.questions[0])}
                      >
                        <div className="customer-hero-card__head">
                          <span aria-hidden>{group.icon}</span>
                          {group.title}
                        </div>
                        <ul>
                          {group.questions.slice(0, 2).map((q) => (
                            <li key={q}>· {q}</li>
                          ))}
                        </ul>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {messages.map((m, i) => {
              const conf = m.role === "assistant" ? confidenceLabel(m.confidence) : null;
              return (
                <div
                  key={`${i}-${m.role}`}
                  className={`customer-msg${m.role === "user" ? " customer-msg--user" : ""}`}
                >
                  <div
                    className={`customer-msg-avatar${m.role === "assistant" ? " customer-msg-avatar--bot" : " customer-msg-avatar--user"}`}
                    aria-hidden
                  >
                    {m.role === "assistant" ? wsIcon : "你"}
                  </div>
                  <div className="customer-msg-body">
                    <div
                      className={`customer-msg-bubble customer-msg-bubble--${m.role === "user" ? "user" : "assistant"}`}
                    >
                      {m.role === "assistant" ? (
                        <MarkdownSummaryPreview markdown={m.text} />
                      ) : (
                        m.text
                      )}
                    </div>
                    {m.role === "assistant" && (
                      <div className="customer-msg-meta">
                        {conf && (
                          <span className={`customer-confidence ${conf.className}`}>
                            {conf.text}
                          </span>
                        )}
                        <div className="customer-msg-actions">
                          <button
                            type="button"
                            className="customer-msg-action"
                            onClick={() => void copyMessage(m.text)}
                          >
                            复制
                          </button>
                          <button
                            type="button"
                            className="customer-msg-action"
                            onClick={() => {
                              setFeedbackIdx(i);
                              setFeedbackText("");
                              setFeedbackOk(null);
                            }}
                          >
                            纠正回答
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {busy && streamingText && (
              <div className="customer-msg">
                <div className="customer-msg-avatar customer-msg-avatar--bot" aria-hidden>
                  {wsIcon}
                </div>
                <div className="customer-msg-body">
                  <div className="customer-msg-bubble customer-msg-bubble--assistant">
                    <MarkdownSummaryPreview markdown={streamingText} />
                  </div>
                </div>
              </div>
            )}

            {busy && !streamingText && messages.length > 0 && (
              <div className="customer-msg">
                <div className="customer-msg-avatar customer-msg-avatar--bot" aria-hidden>
                  {wsIcon}
                </div>
                <div className="customer-typing" aria-live="polite" aria-label="正在回复">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        </div>

        <div className="customer-composer-dock">
          <div className="customer-composer-panel">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={composerPlaceholder}
              disabled={busy || !activeWorkspaceId}
              rows={1}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <div className="customer-composer-btns">
              {busy ? (
                <button
                  type="button"
                  className="customer-stop-btn"
                  aria-label="停止生成"
                  onClick={stopGeneration}
                >
                  <Square size={16} fill="currentColor" />
                </button>
              ) : (
                <button
                  type="button"
                  className="customer-send-btn"
                  disabled={!canSend}
                  aria-label="发送"
                  onClick={() => void send()}
                >
                  <SendHorizontal size={20} />
                </button>
              )}
            </div>
          </div>
          <p className="customer-composer-hint">
            Enter 发送 · Shift+Enter 换行 · 左侧可切换客服实例与 FAQ / Agent 模式
          </p>
        </div>
      </div>

      <WorkspaceConfigPanel
        open={configOpen}
        editingId={editingWorkspaceId}
        workspaces={workspaces}
        onClose={() => setConfigOpen(false)}
        onSaved={() => void refreshAfterConfig()}
        onDeleted={(id) => {
          if (id === activeWorkspaceId) {
            void loadWorkspaces().then((r) => {
              if (r?.nextId) void activateWorkspace(r.nextId);
            });
          } else {
            void refreshAfterConfig();
          }
        }}
      />

      {feedbackIdx != null && (
        <div
          className="customer-feedback-sheet"
          role="dialog"
          aria-modal="true"
          onClick={() => !feedbackBusy && setFeedbackIdx(null)}
        >
          <div
            className="customer-feedback-sheet__panel"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>帮我纠正这条回答</h3>
            <p>你的补充会进入审核队列，通过后写入知识库，帮助后续用户。</p>
            <textarea
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
              placeholder="例如：会员可在 设置 → 订阅管理 中关闭自动续费…"
              disabled={feedbackBusy}
            />
            <div className="customer-feedback-sheet__actions">
              <button
                type="button"
                className="customer-icon-btn"
                disabled={feedbackBusy}
                onClick={() => setFeedbackIdx(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="customer-icon-btn"
                disabled={feedbackBusy || !feedbackText.trim()}
                onClick={() => void submitFeedback()}
                style={{
                  background: "var(--cs-accent)",
                  color: "#fff",
                  borderColor: "transparent",
                }}
              >
                {feedbackBusy ? "提交中…" : "提交反馈"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
