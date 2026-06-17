"use client";

import {
  ArrowUp,
  Network,
  RefreshCw,
  Settings,
  Trash2,
  Users,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

type AvItem = { state: string; label: string; reason?: string };

interface Node {
  id: string;
  name: string;
  url: string;
  type: "local" | "remote";
  role?: string;
  avatar?: string;
  personality?: string;
  methods?: string[];
  online?: boolean;
}

type ChatMessage = { role: "user" | "assistant"; content: string };
type ChatMode = "direct" | "group";

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

function buildClusterSummary(nodes: Node[]): AvItem {
  const onlineCount = nodes.filter((n) => n.online).length;
  if (!nodes.length) {
    return { state: "missing", label: "无节点", reason: "请先配置 OpenClaw 节点" };
  }
  if (onlineCount === 0) {
    return {
      state: "unavailable",
      label: "不可用",
      reason: `${nodes.length} 个节点均离线`,
    };
  }
  if (onlineCount < nodes.length) {
    return {
      state: "partial",
      label: "部分可用",
      reason: `${onlineCount}/${nodes.length} 节点在线`,
    };
  }
  return {
    state: "ready",
    label: "集群就绪",
    reason: `${onlineCount} 个节点在线`,
  };
}

function matchNodeForMessage(msg: string, nodes: Node[]): Node | undefined {
  return nodes.find(
    (n) =>
      (n.avatar && msg.includes(n.avatar)) ||
      msg.includes(`**${n.name}**`) ||
      msg.includes(`${n.name}:`),
  );
}

function parseGroupReplies(content: string, nodes: Node[]) {
  const lines = content.split("\n").filter((l) => l.includes(":") && !l.includes("---"));
  return lines
    .map((line) => {
      const node = matchNodeForMessage(line, nodes);
      const text = line.split(":").slice(1).join(":").trim();
      if (!text || text.includes("节点离线")) return null;
      return { node, text };
    })
    .filter(Boolean) as { node?: Node; text: string }[];
}

export default function OpenClawPage() {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [clusterSummary, setClusterSummary] = useState<AvItem>({
    state: "muted",
    label: "检测中",
  });
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatMode, setChatMode] = useState<ChatMode>("direct");
  const [selectedNode, setSelectedNode] = useState<string>("auto");
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [toast, setToast] = useState("");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const loadNodes = useCallback(async () => {
    setLoadingStatus(true);
    try {
      const res = await fetch(`/api/lobster/nodes?_=${Date.now()}`, { cache: "no-store" });
      const data = await res.json();
      if (data.success) {
        const list: Node[] = data.nodes || [];
        setNodes(list);
        setClusterSummary(buildClusterSummary(list));
      } else {
        setNodes([]);
        setClusterSummary({ state: "error", label: "检测失败" });
      }
    } catch {
      setNodes([]);
      setClusterSummary({ state: "error", label: "检测失败" });
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  useEffect(() => {
    loadNodes();
  }, [loadNodes]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, chatLoading]);

  const onlineNodes = nodes.filter((n) => n.online);
  const chatReady = onlineNodes.length > 0;
  const clusterTone = tone(clusterSummary.state);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 4000);
  };

  const targetLabel =
    chatMode === "group"
      ? "全部节点"
      : selectedNode === "auto"
        ? "自动路由"
        : nodes.find((n) => n.id === selectedNode)?.name || selectedNode;

  const handleSend = async () => {
    const text = input.trim();
    if (!text || chatLoading) return;

    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setInput("");
    setChatLoading(true);

    try {
      const endpoint = chatMode === "group" ? "/api/lobster/group-chat" : "/api/lobster/chat";
      const payload =
        chatMode === "group"
          ? { message: text }
          : { message: text, node_id: selectedNode };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        setMessages((prev) => [...prev, { role: "assistant", content: String(data.reply || "") }]);
      } else {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `出错：${data.error || "未知错误"}` },
        ]);
      }
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `请求失败：${e instanceof Error ? e.message : String(e)}`,
        },
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

  const actionBtn =
    "w-full rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] px-4 py-3 text-left text-sm font-medium text-[color:var(--foreground)] transition-colors hover:bg-[var(--nav-active-fill)] disabled:opacity-50";

  const modeBtn = (active: boolean, accent: "solo" | "party") =>
    `inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
      active
        ? accent === "solo"
          ? "bg-orange-500 text-white shadow-sm"
          : "bg-violet-600 text-white shadow-sm"
        : "text-[color:var(--label-secondary)] hover:bg-[var(--nav-active-fill)]"
    }`;

  const renderMessage = (m: ChatMessage, idx: number) => {
    if (m.role === "user") {
      return (
        <div key={idx} className="flex justify-end">
          <div className="max-w-[85%] rounded-2xl bg-orange-500 px-4 py-3 text-[15px] leading-relaxed text-white">
            <p className="whitespace-pre-wrap break-words">{m.content}</p>
          </div>
        </div>
      );
    }

    const isA2A = m.content.includes("--- **NPC 见解录入** ---");
    if (isA2A) {
      const replies = parseGroupReplies(m.content, nodes);
      if (replies.length) {
        return (
          <div key={idx} className="space-y-3">
            {replies.map((r, ri) => (
              <div key={`${idx}-${ri}`} className="flex justify-start">
                <div className="max-w-[85%] rounded-2xl bg-[var(--chrome-rail-bg)] px-4 py-3 text-[15px] leading-relaxed text-[color:var(--foreground)]">
                  <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-[color:var(--label-secondary)]">
                    <span>{r.node?.avatar || "🤖"}</span>
                    <span>{r.node?.name || "Agent"}</span>
                    {r.node?.role ? (
                      <span className="rounded-md bg-violet-500/15 px-1.5 py-0.5 text-[10px] text-violet-600 dark:text-violet-300">
                        {r.node.role}
                      </span>
                    ) : null}
                  </div>
                  <p className="whitespace-pre-wrap break-words">{r.text}</p>
                </div>
              </div>
            ))}
          </div>
        );
      }
    }

    const node = matchNodeForMessage(m.content, nodes);
    return (
      <div key={idx} className="flex justify-start">
        <div className="max-w-[85%] rounded-2xl bg-[var(--chrome-rail-bg)] px-4 py-3 text-[15px] leading-relaxed text-[color:var(--foreground)]">
          {node ? (
            <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-[color:var(--label-secondary)]">
              <span>{node.avatar || "🤖"}</span>
              <span>{node.name}</span>
            </div>
          ) : null}
          <p className="whitespace-pre-wrap break-words">{m.content}</p>
        </div>
      </div>
    );
  };

  return (
    <div className="page-canvas flex min-h-[calc(100vh-4rem)] flex-col bg-[var(--shell-bg)]">
      <header className="shrink-0 border-b border-[color:var(--separator-subtle)] px-6 py-4">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-orange-500 to-red-600 text-xl shadow-sm">
              🦞
            </div>
            <div>
              <h1 className="text-lg font-semibold text-[color:var(--foreground)]">OpenClaw</h1>
              <p className="text-sm text-[color:var(--label-secondary)]">
                分布式 Agent 集群 · {nodes.length} 节点
                {onlineNodes.length > 0 ? ` · ${onlineNodes.length} 在线` : ""}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={loadNodes}
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
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--separator-subtle)] px-5 py-3">
            <div>
              <h2 className="text-base font-semibold text-[color:var(--foreground)]">集群对话</h2>
              <p className={`mt-0.5 text-sm ${chatReady ? toneText.ok : toneText.bad}`}>
                {chatReady
                  ? `${chatMode === "group" ? "集群会议" : "单节点"} · 目标：${targetLabel}`
                  : clusterSummary.reason || "暂无可用节点"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setChatMode("direct")}
                className={modeBtn(chatMode === "direct", "solo")}
              >
                <Zap className="h-3.5 w-3.5" />
                单节点
              </button>
              <button
                type="button"
                onClick={() => setChatMode("group")}
                className={modeBtn(chatMode === "group", "party")}
              >
                <Users className="h-3.5 w-3.5" />
                集群会议
              </button>
              <div className="mx-1 h-5 w-px bg-[color:var(--separator-subtle)]" />
              <button
                type="button"
                onClick={() => setMessages([])}
                className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-[color:var(--label-secondary)] hover:bg-[var(--nav-active-fill)]"
              >
                <Trash2 className="h-4 w-4" />
                清空
              </button>
            </div>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
            {messages.length === 0 && !chatLoading && (
              <div className="flex h-full min-h-[200px] flex-col items-center justify-center text-center">
                <span className="mb-3 text-4xl opacity-40">🦞</span>
                <p className="text-base text-[color:var(--label-secondary)]">
                  {chatReady
                    ? chatMode === "group"
                      ? "向全部节点广播指令，开启集群协作"
                      : "选择目标节点，委托分布式 Agent 执行任务"
                    : "请先在右侧配置并连接 OpenClaw 节点"}
                </p>
              </div>
            )}
            {messages.map((m, i) => renderMessage(m, i))}
            {chatLoading && (
              <div className="flex justify-start">
                <div className="rounded-2xl bg-[var(--chrome-rail-bg)] px-4 py-3 text-sm text-[color:var(--label-secondary)]">
                  {chatMode === "group" ? "集群节点协作中…" : "节点处理中…"}
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
                disabled={chatLoading || !chatReady}
                placeholder={
                  chatReady
                    ? chatMode === "group"
                      ? "向集群广播指令，Enter 发送"
                      : "输入任务，Enter 发送，Shift+Enter 换行"
                    : "暂无可用节点，请先配置右侧节点"
                }
                className="w-full resize-none rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] px-4 py-3 pr-14 text-[15px] leading-relaxed text-[color:var(--foreground)] placeholder:text-[color:var(--label-secondary)] focus:border-[color:color-mix(in_srgb,#f97316_50%,transparent)] focus:outline-none focus:ring-2 focus:ring-[color:color-mix(in_srgb,#f97316_25%,transparent)] disabled:opacity-60"
              />
              <button
                type="button"
                onClick={handleSend}
                disabled={chatLoading || !input.trim() || !chatReady}
                className="absolute bottom-3 right-3 flex h-9 w-9 items-center justify-center rounded-lg bg-orange-500 text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                aria-label="发送"
              >
                <ArrowUp className="h-5 w-5" />
              </button>
            </div>
          </div>
        </section>

        <aside className="flex w-full shrink-0 flex-col gap-4 lg:w-[340px]">
          <div className="card-surface rounded-2xl p-4">
            <div className="mb-1 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-base font-semibold text-[color:var(--foreground)]">
                <Network className="h-4 w-4 text-orange-500" />
                集群状态
              </h3>
              <span className={`text-sm font-medium ${toneText[clusterTone]}`}>
                {clusterSummary.label}
              </span>
            </div>
            {clusterSummary.reason ? (
              <p className="mb-2 text-xs text-[color:var(--label-secondary)]">
                {clusterSummary.reason}
              </p>
            ) : null}
            {loadingStatus && !nodes.length ? (
              <p className="py-4 text-sm text-[color:var(--label-secondary)]">检测中…</p>
            ) : nodes.length > 0 ? (
              <div className="divide-y divide-[color:var(--separator-subtle)]">
                <StatusRow
                  name="在线节点"
                  item={{
                    state: onlineNodes.length === nodes.length ? "ready" : onlineNodes.length ? "partial" : "unavailable",
                    label: `${onlineNodes.length}/${nodes.length}`,
                  }}
                />
                <StatusRow
                  name="对话模式"
                  item={{
                    state: chatReady ? "ready" : "unavailable",
                    label: chatMode === "group" ? "集群会议" : "单节点",
                  }}
                />
              </div>
            ) : (
              <p className="py-2 text-sm text-[color:var(--label-secondary)]">暂无配置的节点</p>
            )}
          </div>

          {chatMode === "direct" && nodes.length > 0 ? (
            <div className="card-surface rounded-2xl p-4">
              <h3 className="mb-3 text-base font-semibold text-[color:var(--foreground)]">目标节点</h3>
              <div className="space-y-1.5">
                <button
                  type="button"
                  onClick={() => setSelectedNode("auto")}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${
                    selectedNode === "auto"
                      ? "bg-orange-500/15 font-medium text-orange-600 dark:text-orange-300"
                      : "text-[color:var(--foreground)] hover:bg-[var(--nav-active-fill)]"
                  }`}
                >
                  <span className="text-lg">🎯</span>
                  <div>
                    <p className="font-medium">自动路由</p>
                    <p className="text-xs text-[color:var(--label-secondary)]">由集群智能选择节点</p>
                  </div>
                </button>
                {nodes.map((node) => {
                  const online = !!node.online;
                  const active = selectedNode === node.id;
                  return (
                    <button
                      key={node.id}
                      type="button"
                      disabled={!online}
                      onClick={() => setSelectedNode(node.id)}
                      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors disabled:opacity-40 ${
                        active
                          ? "bg-orange-500/15 font-medium text-orange-600 dark:text-orange-300"
                          : "text-[color:var(--foreground)] hover:bg-[var(--nav-active-fill)]"
                      }`}
                    >
                      <span className="text-lg">{node.avatar || "🤖"}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{node.name}</p>
                        <p className="truncate text-xs text-[color:var(--label-secondary)]">
                          {node.role || node.type}
                          {node.methods?.length ? ` · ${node.methods.join(", ")}` : ""}
                        </p>
                      </div>
                      <span
                        className={`inline-flex shrink-0 items-center gap-1 text-xs font-medium ${
                          online ? toneText.ok : toneText.bad
                        }`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${online ? toneDot.ok : toneDot.bad}`} />
                        {online ? "在线" : "离线"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {chatMode === "group" && nodes.length > 0 ? (
            <div className="card-surface rounded-2xl p-4">
              <h3 className="mb-3 text-base font-semibold text-[color:var(--foreground)]">参会节点</h3>
              <div className="divide-y divide-[color:var(--separator-subtle)]">
                {nodes.map((node) => {
                  const online = !!node.online;
                  return (
                    <div key={node.id} className="flex items-start justify-between gap-3 py-2.5">
                      <div className="flex min-w-0 items-center gap-2">
                        <span>{node.avatar || "🤖"}</span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-[color:var(--foreground)]">
                            {node.name}
                          </p>
                          {node.role ? (
                            <p className="text-xs text-[color:var(--label-secondary)]">{node.role}</p>
                          ) : null}
                        </div>
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
            </div>
          ) : null}

          <div className="card-surface rounded-2xl p-4">
            <h3 className="mb-3 text-sm font-semibold text-[color:var(--foreground)]">快捷操作</h3>
            <div className="space-y-2">
              <button
                type="button"
                className={`${actionBtn} inline-flex items-center gap-2`}
                onClick={() => setShowConfigModal(true)}
              >
                <Settings className="h-4 w-4 shrink-0 text-orange-500" />
                节点配置
              </button>
              <Link href="/hermes-agent" className={`${actionBtn} block`}>
                打开 Hermes Agent →
              </Link>
            </div>
          </div>
        </aside>
      </div>

      {showConfigModal ? (
        <NodeConfigModal
          nodes={nodes}
          onSave={async (newNodes) => {
            const res = await fetch("/api/lobster/config", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(newNodes),
            });
            if (res.ok) {
              await loadNodes();
              setShowConfigModal(false);
              showToast("节点配置已保存");
            } else {
              showToast("保存失败，请稍后重试");
            }
          }}
          onClose={() => setShowConfigModal(false)}
        />
      ) : null}

      {toast ? (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-[var(--foreground)] px-5 py-2.5 text-sm font-medium text-[var(--shell-bg)] shadow-lg">
          {toast}
        </div>
      ) : null}
    </div>
  );
}

function NodeConfigModal({
  nodes,
  onSave,
  onClose,
}: {
  nodes: Node[];
  onSave: (nodes: Node[]) => void;
  onClose: () => void;
}) {
  const [localNodes, setLocalNodes] = useState<Node[]>([...nodes]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [discoveredNodes, setDiscoveredNodes] = useState<Node[]>([]);

  const handleScan = async () => {
    setIsScanning(true);
    try {
      const res = await fetch("/api/lobster/detect");
      const data = await res.json();
      if (data.success) {
        setDiscoveredNodes(data.nodes);
      }
    } catch {
      /* ignore */
    } finally {
      setIsScanning(false);
    }
  };

  const addDiscovered = (node: Node) => {
    if (localNodes.some((n) => n.url === node.url)) return;
    setLocalNodes([...localNodes, node]);
    setDiscoveredNodes(discoveredNodes.filter((n) => n.url !== node.url));
  };

  const addNode = () => {
    const newNode: Node = {
      id: `node_${Date.now()}`,
      name: "New OpenClaw",
      url: "http://127.0.0.1:18789",
      type: "local",
      role: "Assistant",
      avatar: "🤖",
      personality: "Helpful",
      online: false,
    };
    setLocalNodes([...localNodes, newNode]);
    setEditingIndex(localNodes.length);
  };

  const removeNode = (index: number) => {
    const newNodes = [...localNodes];
    newNodes.splice(index, 1);
    setLocalNodes(newNodes);
    setEditingIndex(null);
  };

  const updateNode = (index: number, field: keyof Node, value: string) => {
    const newNodes = [...localNodes];
    newNodes[index] = { ...newNodes[index], [field]: value };
    setLocalNodes(newNodes);
  };

  const inputClass =
    "w-full rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] p-3 text-sm text-[color:var(--foreground)] focus:border-[color:color-mix(in_srgb,#f97316_50%,transparent)] focus:outline-none focus:ring-2 focus:ring-[color:color-mix(in_srgb,#f97316_20%,transparent)]";

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="card-surface flex max-h-[80vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between border-b border-[color:var(--separator-subtle)] px-6 py-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-[color:var(--foreground)]">
            <span className="text-xl">🦞</span>
            OpenClaw 节点配置
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-[color:var(--label-secondary)] hover:bg-[var(--nav-active-fill)]"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          <div className="w-64 shrink-0 overflow-y-auto border-r border-[color:var(--separator-subtle)] p-4">
            <div className="space-y-2">
              {localNodes.map((node, idx) => (
                <button
                  key={node.id}
                  type="button"
                  onClick={() => setEditingIndex(idx)}
                  className={`flex w-full items-center gap-3 rounded-xl p-3 text-left transition-colors ${
                    editingIndex === idx
                      ? "bg-orange-500/15 text-orange-600 dark:text-orange-300"
                      : "text-[color:var(--foreground)] hover:bg-[var(--nav-active-fill)]"
                  }`}
                >
                  <span className="text-xl">{node.avatar || "🤖"}</span>
                  <div className="min-w-0 flex-1 truncate">
                    <div className="text-xs font-semibold">{node.name}</div>
                    <div className="text-[10px] text-[color:var(--label-secondary)]">{node.type}</div>
                  </div>
                </button>
              ))}
              <button
                type="button"
                onClick={addNode}
                className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[color:var(--separator-subtle)] p-3 text-xs font-semibold text-[color:var(--label-secondary)] hover:border-orange-500/40 hover:text-orange-500"
              >
                + 添加节点
              </button>
            </div>

            <div className="mt-4 space-y-2 border-t border-[color:var(--separator-subtle)] pt-4">
              <button
                type="button"
                onClick={handleScan}
                disabled={isScanning}
                className="w-full rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] px-3 py-2.5 text-xs font-semibold text-[color:var(--foreground)] hover:bg-[var(--nav-active-fill)] disabled:opacity-50"
              >
                {isScanning ? "侦测中…" : "自动侦测本地节点"}
              </button>
              {discoveredNodes.map((node) => (
                <div
                  key={node.url}
                  className="flex items-center justify-between gap-2 rounded-lg border border-[color:var(--separator-subtle)] p-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[10px] font-semibold text-[color:var(--foreground)]">
                      {node.name}
                    </div>
                    <div className="truncate text-[9px] text-[color:var(--label-secondary)]">{node.url}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => addDiscovered(node)}
                    className="shrink-0 rounded-md bg-orange-500/15 px-2 py-1 text-[10px] font-bold text-orange-600 dark:text-orange-300"
                  >
                    添加
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            {editingIndex !== null ? (
              <div className="space-y-5">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[color:var(--label-secondary)]">节点名称</label>
                    <input
                      value={localNodes[editingIndex].name}
                      onChange={(e) => updateNode(editingIndex, "name", e.target.value)}
                      className={inputClass}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[color:var(--label-secondary)]">头像 Emoji</label>
                    <input
                      value={localNodes[editingIndex].avatar || ""}
                      onChange={(e) => updateNode(editingIndex, "avatar", e.target.value)}
                      className={inputClass}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[color:var(--label-secondary)]">角色</label>
                  <input
                    value={localNodes[editingIndex].role || ""}
                    onChange={(e) => updateNode(editingIndex, "role", e.target.value)}
                    className={inputClass}
                    placeholder="如：Researcher、Coder"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[color:var(--label-secondary)]">API Endpoint</label>
                  <input
                    value={localNodes[editingIndex].url}
                    onChange={(e) => updateNode(editingIndex, "url", e.target.value)}
                    className={`${inputClass} font-mono`}
                    placeholder="http://127.0.0.1:18789"
                  />
                </div>
                <div className="flex justify-between border-t border-[color:var(--separator-subtle)] pt-4">
                  <button
                    type="button"
                    onClick={() => removeNode(editingIndex)}
                    className="rounded-xl px-4 py-2 text-xs font-semibold text-red-500 hover:bg-red-500/10"
                  >
                    删除节点
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex h-full min-h-[240px] flex-col items-center justify-center text-center text-[color:var(--label-secondary)]">
                <span className="mb-3 text-4xl opacity-30">🦞</span>
                <p className="text-sm">选择左侧节点进行编辑，或添加新节点</p>
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t border-[color:var(--separator-subtle)] px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-[color:var(--separator-subtle)] px-5 py-2.5 text-sm font-medium text-[color:var(--foreground)] hover:bg-[var(--nav-active-fill)]"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => onSave(localNodes)}
            className="rounded-xl bg-orange-500 px-6 py-2.5 text-sm font-semibold text-white hover:opacity-90"
          >
            保存配置
          </button>
        </div>
      </div>
    </div>
  );
}
