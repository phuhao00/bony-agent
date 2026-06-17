"use client";

import { ArrowUp, RefreshCw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

type AvItem = { state: string; label: string; reason?: string };

type HermesHealth = {
  installed?: boolean;
  model?: string;
  provider?: string;
  availability?: {
    summary: AvItem;
    install: AvItem;
    cli: AvItem;
    gateway: AvItem;
    chat: AvItem;
  };
  runtime_state?: { last_error?: string };
};

type OpenClawNode = {
  id: string;
  name: string;
  online?: boolean;
  methods?: string[];
  url?: string;
};

function tone(state: string): "ok" | "warn" | "bad" | "muted" {
  if (state === "ready") return "ok";
  if (state === "partial" || state === "stopped" || state === "unconfigured") return "warn";
  if (state === "missing" || state === "error" || state === "unavailable") return "bad";
  return "muted";
}

const toneDot: Record<ReturnType<typeof tone>, string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  bad: "bg-red-500",
  muted: "bg-[color:var(--label-secondary)]",
};

const toneText: Record<ReturnType<typeof tone>, string> = {
  ok: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-700 dark:text-amber-300",
  bad: "text-red-600 dark:text-red-400",
  muted: "text-[color:var(--label-secondary)]",
};

function StatusRow({ name, item }: { name: string; item: AvItem }) {
  const t = tone(item.state);
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <span className="text-sm text-[color:var(--label-secondary)]">{name}</span>
      <div className="text-right">
        <span className={`inline-flex items-center gap-2 text-sm font-medium ${toneText[t]}`}>
          <span className={`h-2 w-2 rounded-full ${toneDot[t]}`} />
          {item.label}
        </span>
        {item.reason ? (
          <p className="mt-0.5 max-w-[200px] text-xs leading-snug text-[color:var(--label-secondary)]">
            {item.reason}
          </p>
        ) : null}
      </div>
    </div>
  );
}

type ChatMessage = { role: "user" | "assistant"; content: string };

export default function HermesAgentPage() {
  const [health, setHealth] = useState<HermesHealth | null>(null);
  const [openclawNodes, setOpenclawNodes] = useState<OpenClawNode[]>([]);
  const [openclawSummary, setOpenclawSummary] = useState<AvItem>({
    state: "muted",
    label: "检测中",
  });
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [syncing, setSyncing] = useState<"" | "import" | "export">("");
  const [toast, setToast] = useState("");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const loadStatus = useCallback(async () => {
    setLoadingStatus(true);
    try {
      const [hermesRes, nodesRes] = await Promise.all([
        fetch("/api/hermes/status", { cache: "no-store" }),
        fetch("/api/lobster/nodes", { cache: "no-store" }),
      ]);
      const hermesData = await hermesRes.json();
      setHealth(hermesData.hermes ?? null);

      const nodesData = await nodesRes.json();
      const nodes: OpenClawNode[] = nodesData.success ? nodesData.nodes || [] : [];
      setOpenclawNodes(nodes);
      const onlineCount = nodes.filter((n) => n.online).length;
      if (!nodes.length) {
        setOpenclawSummary({ state: "missing", label: "无节点", reason: "未配置 OpenClaw 节点" });
      } else if (onlineCount === 0) {
        setOpenclawSummary({
          state: "unavailable",
          label: "不可用",
          reason: `${nodes.length} 个节点均离线`,
        });
      } else if (onlineCount < nodes.length) {
        setOpenclawSummary({
          state: "partial",
          label: "部分可用",
          reason: `${onlineCount}/${nodes.length} 节点在线`,
        });
      } else {
        setOpenclawSummary({
          state: "ready",
          label: "可用",
          reason: `${onlineCount} 个节点在线`,
        });
      }
    } catch {
      setHealth(null);
      setOpenclawNodes([]);
      setOpenclawSummary({ state: "error", label: "检测失败" });
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, chatLoading]);

  const av = health?.availability;
  const chatReady = av?.chat?.state === "ready";
  const chatReason = av?.chat?.reason || health?.runtime_state?.last_error || "";

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 4000);
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || chatLoading) return;

    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setInput("");
    setChatLoading(true);

    try {
      const res = await fetch("/api/hermes/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json();
      if (data.success) {
        const reply = String(data.reply || "").replace(/^\*\*Hermes[^*]*\*\*\s*/i, "");
        setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
      } else {
        const err = String(data.error || "未知错误");
        setMessages((prev) => [...prev, { role: "assistant", content: `出错：${err}` }]);
        if (err.includes("401") || err.includes("API key") || err.includes("invalid_api_key")) {
          loadStatus();
        }
      }
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `请求失败：${e instanceof Error ? e.message : String(e)}` },
      ]);
    } finally {
      setChatLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const runSkillSync = async (direction: "from_hermes" | "to_hermes") => {
    setSyncing(direction === "from_hermes" ? "import" : "export");
    try {
      const res = await fetch("/api/hermes/skills/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direction, dry_run: false }),
      });
      const data = await res.json();
      const block = direction === "from_hermes" ? data.from_hermes : data.to_hermes;
      const count =
        direction === "from_hermes"
          ? (block?.imported?.length ?? 0)
          : (block?.exported?.length ?? 0);
      showToast(direction === "from_hermes" ? `已导入 ${count} 个 Skill` : `已导出 ${count} 个 Skill`);
    } catch {
      showToast("同步失败，请稍后重试");
    } finally {
      setSyncing("");
    }
  };

  const actionBtn =
    "w-full rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] px-4 py-3 text-left text-sm font-medium text-[color:var(--foreground)] transition-colors hover:bg-[var(--nav-active-fill)] disabled:opacity-50";

  const summaryTone = tone(av?.summary?.state || "muted");

  return (
    <div className="page-canvas flex min-h-[calc(100vh-4rem)] flex-col bg-[var(--shell-bg)]">
      <header className="shrink-0 border-b border-[color:var(--separator-subtle)] px-6 py-4">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--accent)] text-lg text-white">
              ☤
            </div>
            <div>
              <h1 className="text-lg font-semibold text-[color:var(--foreground)]">Hermes Agent</h1>
              <p className="text-sm text-[color:var(--label-secondary)]">
                {health?.model || "—"}
                {health?.provider ? ` · ${health.provider}` : ""}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={loadStatus}
            disabled={loadingStatus}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--separator-subtle)] px-3 py-2 text-sm text-[color:var(--foreground)] hover:bg-[var(--nav-active-fill)]"
          >
            <RefreshCw className={`h-4 w-4 ${loadingStatus ? "animate-spin" : ""}`} />
            刷新状态
          </button>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-6 py-6 lg:flex-row lg:gap-8">
        <section className="card-surface flex min-h-[480px] flex-1 flex-col overflow-hidden rounded-2xl lg:min-h-[calc(100vh-12rem)]">
          <div className="flex items-center justify-between border-b border-[color:var(--separator-subtle)] px-5 py-3">
            <div>
              <h2 className="text-base font-semibold text-[color:var(--foreground)]">对话测试</h2>
              {av?.chat ? (
                <p className={`mt-0.5 text-sm ${toneText[tone(av.chat.state)]}`}>
                  Hermes 对话 · {av.chat.label}
                  {av.chat.reason ? ` — ${av.chat.reason}` : ""}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => setMessages([])}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-[color:var(--label-secondary)] hover:bg-[var(--nav-active-fill)]"
            >
              <Trash2 className="h-4 w-4" />
              清空
            </button>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
            {messages.length === 0 && !chatLoading && (
              <div className="flex h-full min-h-[200px] flex-col items-center justify-center text-center">
                <p className="text-base text-[color:var(--label-secondary)]">
                  {chatReady ? "输入任务，委托本地 Hermes 执行" : "请先完成右侧状态检查后再对话"}
                </p>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 text-[15px] leading-relaxed ${
                    m.role === "user"
                      ? "bg-[var(--accent)] text-white"
                      : "bg-[var(--chrome-rail-bg)] text-[color:var(--foreground)]"
                  }`}
                >
                  <p className="whitespace-pre-wrap break-words">{m.content}</p>
                </div>
              </div>
            ))}
            {chatLoading && (
              <div className="flex justify-start">
                <div className="rounded-2xl bg-[var(--chrome-rail-bg)] px-4 py-3 text-sm text-[color:var(--label-secondary)]">
                  Hermes 思考中…
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="border-t border-[color:var(--separator-subtle)] p-4">
            <div className="relative">
              <textarea
                ref={inputRef}
                rows={2}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={chatLoading}
                placeholder={
                  chatReady
                    ? "输入任务，Enter 发送，Shift+Enter 换行"
                    : chatReason || "Hermes 对话暂不可用，请查看右侧状态"
                }
                className="w-full resize-none rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] px-4 py-3 pr-14 text-[15px] leading-relaxed text-[color:var(--foreground)] placeholder:text-[color:var(--label-secondary)] focus:border-[color:color-mix(in_srgb,var(--accent)_50%,transparent)] focus:outline-none focus:ring-2 focus:ring-[color:color-mix(in_srgb,var(--accent)_25%,transparent)] disabled:opacity-60"
              />
              <button
                type="button"
                onClick={handleSend}
                disabled={chatLoading || !input.trim()}
                className="absolute bottom-3 right-3 flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--accent)] text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                aria-label="发送"
              >
                <ArrowUp className="h-5 w-5" />
              </button>
            </div>
          </div>
        </section>

        <aside className="flex w-full shrink-0 flex-col gap-4 lg:w-[340px]">
          {/* Hermes 状态 */}
          <div className="card-surface rounded-2xl p-4">
            <div className="mb-1 flex items-center justify-between">
              <h3 className="text-base font-semibold text-[color:var(--foreground)]">Hermes</h3>
              {av?.summary ? (
                <span className={`text-sm font-medium ${toneText[summaryTone]}`}>
                  {av.summary.label}
                </span>
              ) : null}
            </div>
            {loadingStatus && !av ? (
              <p className="py-4 text-sm text-[color:var(--label-secondary)]">检测中…</p>
            ) : av ? (
              <div className="divide-y divide-[color:var(--separator-subtle)]">
                <StatusRow name="安装" item={av.install} />
                <StatusRow name="CLI" item={av.cli} />
                <StatusRow name="Gateway" item={av.gateway} />
                <StatusRow name="对话" item={av.chat} />
              </div>
            ) : (
              <p className="py-4 text-sm text-red-500">无法获取 Hermes 状态</p>
            )}
            {av?.gateway?.state === "stopped" && av.install.state === "ready" ? (
              <code className="mt-3 block rounded-lg bg-[var(--chrome-rail-bg)] px-3 py-2 font-mono text-xs text-[color:var(--foreground)]">
                hermes gateway start
              </code>
            ) : null}
          </div>

          {/* OpenClaw 状态 */}
          <div className="card-surface rounded-2xl p-4">
            <div className="mb-1 flex items-center justify-between">
              <h3 className="text-base font-semibold text-[color:var(--foreground)]">OpenClaw</h3>
              <span className={`text-sm font-medium ${toneText[tone(openclawSummary.state)]}`}>
                {openclawSummary.label}
              </span>
            </div>
            {openclawSummary.reason ? (
              <p className="mb-2 text-xs text-[color:var(--label-secondary)]">{openclawSummary.reason}</p>
            ) : null}
            {openclawNodes.length > 0 ? (
              <div className="divide-y divide-[color:var(--separator-subtle)]">
                {openclawNodes.map((node) => {
                  const online = !!node.online;
                  return (
                    <div key={node.id} className="flex items-start justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-[color:var(--foreground)]">
                          {node.name || node.id}
                        </p>
                        {node.methods?.length ? (
                          <p className="text-xs text-[color:var(--label-secondary)]">
                            {node.methods.join(" · ")}
                          </p>
                        ) : null}
                      </div>
                      <span
                        className={`inline-flex shrink-0 items-center gap-1.5 text-sm font-medium ${
                          online ? toneText.ok : toneText.bad
                        }`}
                      >
                        <span className={`h-2 w-2 rounded-full ${online ? toneDot.ok : toneDot.bad}`} />
                        {online ? "在线" : "离线"}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="py-2 text-sm text-[color:var(--label-secondary)]">暂无配置的节点</p>
            )}
            <Link
              href="/openclaw"
              className="mt-3 block text-center text-sm font-medium text-[color:var(--accent)] hover:underline"
            >
              打开 OpenClaw 控制台 →
            </Link>
          </div>

          {/* 快捷操作 */}
          <div className="card-surface rounded-2xl p-4">
            <h3 className="mb-3 text-sm font-semibold text-[color:var(--foreground)]">快捷操作</h3>
            <div className="space-y-2">
              <Link href="/settings/capabilities" className={`${actionBtn} block`}>
                MCP 连接配置
              </Link>
              <button
                type="button"
                className={actionBtn}
                disabled={!!syncing}
                onClick={() => runSkillSync("from_hermes")}
              >
                {syncing === "import" ? "导入中…" : "从 Hermes 导入 Skill"}
              </button>
              <button
                type="button"
                className={actionBtn}
                disabled={!!syncing}
                onClick={() => runSkillSync("to_hermes")}
              >
                {syncing === "export" ? "导出中…" : "导出 Skill 到 Hermes"}
              </button>
            </div>
          </div>
        </aside>
      </div>

      {toast ? (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-[var(--foreground)] px-5 py-2.5 text-sm font-medium text-[var(--shell-bg)] shadow-lg">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
