"use client";

import {
    NODE_TYPE_REGISTRY,
    NodeRunStatus,
    NodeType,
    WorkflowSSEEvent,
    WorkflowSSEEventType,
} from "@/types/workflow";
import { useCallback, useRef, useState } from "react";

interface RunPanelProps {
  workflowId: string;
  onNodeStatusChange: (
    nodeId: string,
    status: NodeRunStatus,
    error?: string,
  ) => void;
  onClose: () => void;
}

interface NodeStep {
  nodeId: string;
  nodeType?: NodeType;
  label: string;
  status: NodeRunStatus;
  error?: string;
  output?: string;
  startedAt?: number;
  finishedAt?: number;
  expanded: boolean;
}

const STATUS_META: Record<
  NodeRunStatus,
  { icon: string; color: string; pulse: boolean }
> = {
  pending: { icon: "○", color: "#3f3f46", pulse: false },
  running: { icon: "◌", color: "#60a5fa", pulse: true },
  completed: { icon: "✓", color: "#00c37f", pulse: false },
  failed: { icon: "✕", color: "#f87171", pulse: false },
  skipped: { icon: "—", color: "#3f3f46", pulse: false },
};

/**
 * 从节点输出中提取可读文本。
 * 后端返回格式可能是多层嵌套：
 *   '{"output": "{\"output\": \"实际文本\"}"}'
 * 或 LangGraph state repr：
 *   "{'messages': [AIMessage(content='实际文本', ...)]}"
 */
function extractOutputText(raw: string): string {
  if (!raw) return "";
  // 尝试递归解析 JSON，取最内层 output/result/content 字段
  let current: string = raw.trim();
  for (let depth = 0; depth < 5; depth++) {
    try {
      const parsed = JSON.parse(current);
      if (typeof parsed === "string") {
        current = parsed;
        continue;
      }
      if (typeof parsed === "object" && parsed !== null) {
        const text =
          parsed.output ?? parsed.result ?? parsed.content ?? parsed.text;
        if (typeof text === "string") {
          current = text;
          continue;
        }
      }
      // parsed 是 object 但没有上述字段，序列化为 JSON 返回
      return JSON.stringify(parsed, null, 2);
    } catch {
      break;
    }
  }
  // Python repr 降级处理：AIMessage(content='xxx', ...)
  const m = current.match(/content='([\s\S]*?)(?:',\s*additional_kwargs|'\))/);
  if (m) return m[1].replace(/\\n/g, "\n").replace(/\\'/g, "'");
  return current;
}

// ── Rich result renderer ──────────────────────────────────────────

/** Extract unique URLs from a string */
function extractUrls(text: string): string[] {
  const seen = new Set<string>();
  const results: string[] = [];
  for (const m of text.matchAll(/https?:\/\/[^\s\)\]'"]+/g)) {
    const url = m[0].replace(/[.,;!?]+$/, "");
    if (!seen.has(url)) {
      seen.add(url);
      results.push(url);
    }
  }
  return results;
}

function isVideoUrl(url: string) {
  return (
    /\.(mp4|webm|mov|m3u8)/i.test(url) ||
    url.includes("dashscope") ||
    url.includes("cogvideo")
  );
}

function isImageUrl(url: string) {
  return /\.(jpg|jpeg|png|gif|webp|svg)/i.test(url);
}

/** Parse text into segments: text | video-url | image-url | link-url */
type Segment =
  | { type: "text"; content: string }
  | { type: "video"; url: string }
  | { type: "image"; url: string }
  | { type: "link"; url: string; label: string };

function RichResult({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const [activeVideo, setActiveVideo] = useState(0);
  const [activeImage, setActiveImage] = useState(0);

  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const allUrls = extractUrls(text);
  const videoUrls = allUrls.filter(isVideoUrl);
  const imageUrls = allUrls.filter((u) => isImageUrl(u) && !isVideoUrl(u));

  // Extract clean text paragraphs (strip markdown media syntax + bare media URLs)
  const cleanText = text
    .replace(/\[!\[([^\]]*)\]\(([^)]+)\)\]\(([^)]+)\)/g, "")
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/https?:\/\/[^\s]+/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const paragraphs = cleanText.split(/\n\n+/).filter((p) => p.trim());

  return (
    <div className="flex flex-col h-full">
      {/* ── Video carousel ────────────────────────────── */}
      {videoUrls.length > 0 && (
        <div className="flex-1 min-h-0 bg-black flex flex-col">
          {/* Main video */}
          <div className="relative group flex-1 min-h-0 flex flex-col">
            <video
              key={videoUrls[activeVideo]}
              src={videoUrls[activeVideo]}
              controls
              autoPlay={false}
              className="w-full flex-1 min-h-0 object-contain"
              preload="metadata"
            />
            {/* Gradient overlay at bottom */}
            <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-black/70 to-transparent pointer-events-none" />
            {/* Floating actions */}
            <div className="absolute bottom-2 right-2 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <a
                href={videoUrls[activeVideo]}
                download
                className="flex items-center gap-1 text-[10px] font-medium px-2.5 py-1 rounded-full bg-white/10 backdrop-blur-sm text-white hover:bg-white/20 transition-colors border border-white/20"
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                下载
              </a>
              <a
                href={videoUrls[activeVideo]}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-[10px] font-medium px-2.5 py-1 rounded-full bg-white/10 backdrop-blur-sm text-white hover:bg-white/20 transition-colors border border-white/20"
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
                新窗口
              </a>
            </div>
          </div>
          {/* Thumbnail strip (if multiple) */}
          {videoUrls.length > 1 && (
            <div className="flex gap-1.5 px-3 py-2 overflow-x-auto bg-black/80">
              {videoUrls.map((url, i) => (
                <button
                  key={i}
                  onClick={() => setActiveVideo(i)}
                  className={`flex-shrink-0 w-14 h-9 rounded overflow-hidden border-2 transition-all ${
                    i === activeVideo
                      ? "border-[#ff9500] scale-105"
                      : "border-white/20 opacity-60 hover:opacity-80"
                  }`}
                >
                  <video
                    src={url}
                    className="w-full h-full object-cover"
                    muted
                    preload="metadata"
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Image grid ──────────────────────────────── */}
      {imageUrls.length > 0 && (
        <div
          className={`${videoUrls.length > 0 ? "flex-shrink-0" : "flex-1 min-h-0"} ${imageUrls.length === 1 ? "" : "p-2"}`}
        >
          {imageUrls.length === 1 ? (
            <div className="relative group h-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageUrls[0]}
                alt="生成图片"
                className="w-full h-full object-contain bg-black"
              />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
              <a
                href={imageUrls[0]}
                target="_blank"
                rel="noopener noreferrer"
                className="absolute bottom-2 right-2 flex items-center gap-1 text-[10px] font-medium px-2.5 py-1 rounded-full bg-black/50 backdrop-blur-sm text-white opacity-0 group-hover:opacity-100 transition-opacity border border-white/20"
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  <line x1="11" y1="8" x2="11" y2="14" />
                  <line x1="8" y1="11" x2="14" y2="11" />
                </svg>
                查看原图
              </a>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-1.5">
              {imageUrls.map((url, i) => (
                <a
                  key={i}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="relative group aspect-square rounded-lg overflow-hidden bg-black border border-[var(--separator-subtle)]"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors" />
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Text content ────────────────────────────── */}
      {paragraphs.length > 0 && (
        <div className="flex-shrink-0 max-h-28 overflow-y-auto px-4 py-3 space-y-2.5 [&::-webkit-scrollbar]:w-[3px] [&::-webkit-scrollbar-thumb]:bg-[var(--separator)]">
          {paragraphs.map((para, pi) => {
            const lines = para.split("\n");
            return (
              <p
                key={pi}
                className="text-[12.5px] text-[var(--foreground)] leading-relaxed break-words"
              >
                {lines.map((line, li) => (
                  <span key={li}>
                    {li > 0 && <br />}
                    {line}
                  </span>
                ))}
              </p>
            );
          })}
        </div>
      )}

      {/* ── Footer ──────────────────────────────────── */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-t border-[var(--separator-subtle)]">
        <span className="text-[10px] text-[var(--label-secondary)]">
          {videoUrls.length > 0 && `${videoUrls.length} 个视频`}
          {videoUrls.length > 0 && imageUrls.length > 0 && " · "}
          {imageUrls.length > 0 && `${imageUrls.length} 张图片`}
        </span>
        <button
          onClick={copy}
          className="flex items-center gap-1.5 text-[10px] px-2.5 py-1 rounded-full border border-[var(--separator-subtle)] text-[var(--label-secondary)] hover:text-[var(--foreground)] hover:border-[var(--separator)] transition-all"
        >
          {copied ? (
            <>
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
              已复制
            </>
          ) : (
            <>
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              复制全文
            </>
          )}
        </button>
      </div>
    </div>
  );
}

export function RunPanel({
  workflowId,
  onNodeStatusChange,
  onClose,
}: RunPanelProps) {
  const [isRunning, setIsRunning] = useState(false);
  const [steps, setSteps] = useState<NodeStep[]>([]);
  const [runStatus, setRunStatus] = useState<
    "idle" | "running" | "done" | "error"
  >("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [logLines, setLogLines] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<"log" | "result">("log");
  const [finalOutput, setFinalOutput] = useState<string>("");
  const [panelHeight, setPanelHeight] = useState(384);
  const abortRef = useRef<AbortController | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef<number | null>(null);
  const dragStartH = useRef(384);

  function onDragHandlePointerDown(e: React.PointerEvent) {
    e.preventDefault();
    dragStartY.current = e.clientY;
    dragStartH.current = panelHeight;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
  }

  function onDragHandlePointerMove(e: React.PointerEvent) {
    if (dragStartY.current === null) return;
    const delta = dragStartY.current - e.clientY;
    const next = Math.min(
      Math.max(dragStartH.current + delta, 160),
      window.innerHeight * 0.85,
    );
    setPanelHeight(next);
  }

  function onDragHandlePointerUp(e: React.PointerEvent) {
    dragStartY.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  }

  const addLog = useCallback((line: string) => {
    setLogLines((p) => [...p.slice(-600), line]);
    setTimeout(
      () => logEndRef.current?.scrollIntoView({ behavior: "smooth" }),
      30,
    );
  }, []);

  const upsertStep = useCallback(
    (nodeId: string, update: Partial<NodeStep>) => {
      setSteps((prev) => {
        const idx = prev.findIndex((s) => s.nodeId === nodeId);
        if (idx === -1) {
          return [
            ...prev,
            {
              nodeId,
              label: nodeId.slice(0, 10),
              status: "pending",
              expanded: false,
              ...update,
            },
          ];
        }
        const next = [...prev];
        next[idx] = { ...next[idx], ...update };
        return next;
      });
      if (update.status)
        onNodeStatusChange(nodeId, update.status, update.error);
    },
    [onNodeStatusChange],
  );

  async function startRun() {
    setIsRunning(true);
    setRunStatus("running");
    setSteps([]);
    setLogLines([]);
    setErrorMsg("");
    setFinalOutput("");
    setActiveTab("log");
    addLog("● 工作流开始执行");

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const resp = await fetch(`/api/workflows/${workflowId}/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initial_variables: {} }),
        signal: ctrl.signal,
      });
      if (!resp.body) throw new Error("No response body");

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        let eventType: string | null = null;
        let dataLine: string | null = null;

        for (const line of lines) {
          if (line.startsWith("event:")) {
            eventType = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            dataLine = line.slice(5).trim();
          } else if (line === "" && eventType && dataLine) {
            try {
              const ev = JSON.parse(dataLine) as WorkflowSSEEvent;
              const et = eventType as WorkflowSSEEventType;
              const nodeInfo = ev.node_type
                ? NODE_TYPE_REGISTRY[ev.node_type as NodeType]
                : null;
              const nodeLabel =
                nodeInfo?.label ?? ev.node_id?.slice(0, 14) ?? "unknown";

              if (et === "step_start" && ev.node_id) {
                upsertStep(ev.node_id, {
                  nodeType: ev.node_type as NodeType,
                  label: nodeLabel,
                  status: "running",
                  startedAt: ev.ts,
                });
                addLog(`▶ ${nodeLabel}`);
              } else if (et === "step_done" && ev.node_id) {
                const raw = ev.data?.result
                  ? String(ev.data.result)
                  : ev.data
                    ? JSON.stringify(ev.data)
                    : "";
                upsertStep(ev.node_id, {
                  status: "completed",
                  finishedAt: ev.ts,
                  output: raw.slice(0, 800),
                });
                // 解析嵌套 JSON，提取最内层 output 字符串
                const clean = extractOutputText(raw);
                if (clean.trim()) setFinalOutput(clean);
                addLog(`✓ ${nodeLabel}`);
              } else if (et === "step_error" && ev.node_id) {
                const err = (ev.data?.error as string) ?? "未知错误";
                upsertStep(ev.node_id, {
                  status: "failed",
                  finishedAt: ev.ts,
                  error: err,
                });
                addLog(`✕ ${nodeLabel}: ${err.slice(0, 100)}`);
              } else if (et === "workflow_done") {
                setRunStatus("done");
                addLog("● 工作流执行完成");
                setActiveTab((t) => (t === "log" ? "result" : t));
              } else if (et === "workflow_error") {
                setRunStatus("error");
                const msg = (ev.data?.error as string) ?? "工作流执行失败";
                setErrorMsg(msg);
                addLog(`✕ 错误: ${msg}`);
              }
            } catch {
              /* ignore malformed events */
            }
            eventType = null;
            dataLine = null;
          }
        }
      }
    } catch (err: unknown) {
      if ((err as Error).name !== "AbortError") {
        setRunStatus("error");
        const msg = String(err);
        setErrorMsg(msg);
        addLog(`✕ 连接错误: ${msg}`);
      }
    } finally {
      setIsRunning(false);
      if (abortRef.current === ctrl) abortRef.current = null;
    }
  }

  function cancelRun() {
    abortRef.current?.abort();
    setIsRunning(false);
    setRunStatus("idle");
    addLog("◼ 已手动停止");
  }

  function toggleStep(nodeId: string) {
    setSteps((p) =>
      p.map((s) => (s.nodeId === nodeId ? { ...s, expanded: !s.expanded } : s)),
    );
  }

  const runMeta = {
    idle: { color: "#52525b", label: "待运行", dot: "#3f3f46", anim: false },
    running: { color: "#60a5fa", label: "运行中…", dot: "#3b82f6", anim: true },
    done: { color: "#00c37f", label: "运行完成", dot: "#00c37f", anim: false },
    error: { color: "#f87171", label: "运行失败", dot: "#ef4444", anim: false },
  }[runStatus];

  return (
    <div
      style={{ height: panelHeight }}
      className="bg-[var(--shell-bg)] border-t border-[var(--separator-subtle)] flex flex-col shrink-0"
    >
      {/* ── Drag handle ─────────────────────────────────────── */}
      <div
        className="group flex-shrink-0 flex items-center justify-center h-[14px] cursor-ns-resize select-none hover:bg-[var(--separator-subtle)] transition-colors"
        onPointerDown={onDragHandlePointerDown}
        onPointerMove={onDragHandlePointerMove}
        onPointerUp={onDragHandlePointerUp}
        onPointerCancel={onDragHandlePointerUp}
        title="拖拽调整高度"
      >
        <div className="w-8 h-[3px] rounded-full bg-[var(--separator)] group-hover:bg-[var(--label-secondary)] transition-colors" />
      </div>
      {/* ── Toolbar ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-[var(--separator-subtle)] shrink-0">
        <div className="flex items-center gap-2">
          <span
            style={{ backgroundColor: runMeta.dot }}
            className={`w-2 h-2 rounded-full shrink-0 ${runMeta.anim ? "animate-pulse" : ""}`}
          />
          <span
            style={{ color: runMeta.color }}
            className="text-[11px] font-semibold"
          >
            {runMeta.label}
          </span>
        </div>

        {errorMsg && (
          <span className="text-[10px] text-red-400 truncate max-w-[280px] bg-red-500/10 border border-red-500/20 px-2 py-0.5 rounded">
            {errorMsg}
          </span>
        )}

        <div className="flex-1" />

        {!isRunning ? (
          <button
            onClick={startRun}
            className="text-[11px] bg-[#00c37f] hover:bg-[#00a86b] text-black font-bold px-3.5 py-1.5 rounded-lg transition-colors flex items-center gap-1.5"
          >
            <span>▶</span> 运行
          </button>
        ) : (
          <button
            onClick={cancelRun}
            className="text-[11px] bg-red-600/80 hover:bg-red-600 text-white font-semibold px-3.5 py-1.5 rounded-lg transition-colors flex items-center gap-1.5"
          >
            <span>■</span> 停止
          </button>
        )}

        <button
          onClick={onClose}
          className="text-[var(--label-secondary)] hover:text-[var(--foreground)] text-lg leading-none w-6 h-6 flex items-center justify-center rounded hover:bg-[var(--separator-subtle)] transition-all"
        >
          ×
        </button>
      </div>

      {/* ── Content area ────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0">
        {/* Steps / execution trace */}
        <div className="w-52 border-r border-[var(--separator-subtle)] overflow-y-auto shrink-0 py-1.5 [&::-webkit-scrollbar]:w-[3px] [&::-webkit-scrollbar-thumb]:bg-[var(--separator)]">
          {steps.length === 0 && (
            <p className="text-[10px] text-[var(--label-secondary)] opacity-50 text-center py-8 italic">
              暂无执行记录
            </p>
          )}

          {steps.map((s) => {
            const sm = STATUS_META[s.status];
            const dur =
              s.startedAt && s.finishedAt
                ? `${((s.finishedAt - s.startedAt) / 1000).toFixed(1)}s`
                : s.startedAt
                  ? "…"
                  : "";
            const hasDetail = !!(s.output || s.error);

            return (
              <div key={s.nodeId}>
                <button
                  onClick={() => hasDetail && toggleStep(s.nodeId)}
                  className="w-full flex items-center gap-2.5 px-3 py-1.5 hover:bg-[var(--separator-subtle)] transition-colors text-left group"
                >
                  <span
                    style={{ color: sm.color }}
                    className={`text-[11px] w-4 shrink-0 font-mono ${sm.pulse ? "animate-pulse" : ""}`}
                  >
                    {sm.icon}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-medium text-[var(--foreground)] truncate">
                      {s.label}
                    </p>
                    {dur && (
                      <p className="text-[9px] text-[var(--label-secondary)]">
                        {dur}
                      </p>
                    )}
                  </div>
                  {hasDetail && (
                    <span className="text-[10px] text-[var(--label-secondary)] group-hover:text-[var(--foreground)] transition-colors">
                      {s.expanded ? "⌄" : "›"}
                    </span>
                  )}
                </button>

                {s.expanded && s.output && (
                  <div className="mx-3 mb-1.5 bg-[var(--background)] rounded-lg border border-[var(--separator-subtle)] p-2 max-h-[80px] overflow-y-auto [&::-webkit-scrollbar]:w-[2px] [&::-webkit-scrollbar-thumb]:bg-[var(--separator)]">
                    <p className="text-[9px] font-mono text-[var(--label-secondary)] leading-relaxed whitespace-pre-wrap break-words">
                      {s.output}
                    </p>
                  </div>
                )}

                {s.expanded && s.error && (
                  <div className="mx-3 mb-1.5 bg-red-500/10 rounded-lg border border-red-500/20 p-2">
                    <p className="text-[9px] font-mono text-red-400 leading-relaxed break-words">
                      {s.error}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Right: tabbed log / result */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          {/* Tab bar */}
          <div className="flex items-center border-b border-[var(--separator-subtle)] px-3 shrink-0">
            {(["log", "result"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`text-[11px] font-medium px-2 py-1.5 mr-1 border-b-2 transition-colors ${
                  activeTab === tab
                    ? "border-[#ff9500] text-[var(--foreground)]"
                    : "border-transparent text-[var(--label-secondary)] hover:text-[var(--foreground)]"
                }`}
              >
                {tab === "log" ? "日志" : "结果"}
                {tab === "result" && finalOutput && (
                  <span className="ml-1 w-1.5 h-1.5 rounded-full bg-[#00c37f] inline-block" />
                )}
              </button>
            ))}
          </div>

          {/* Log tab */}
          {activeTab === "log" && (
            <div className="flex-1 overflow-y-auto px-3 py-2 font-mono [&::-webkit-scrollbar]:w-[3px] [&::-webkit-scrollbar-thumb]:bg-[var(--separator)]">
              {logLines.length === 0 && (
                <p className="text-[10px] text-[var(--label-secondary)] opacity-50 italic pt-2">
                  点击「运行」开始执行工作流…
                </p>
              )}
              {logLines.map((line, i) => {
                const color = line.startsWith("✓")
                  ? "#4ade80"
                  : line.startsWith("✕")
                    ? "#f87171"
                    : line.startsWith("▶")
                      ? "#60a5fa"
                      : line.startsWith("●")
                        ? "#ff9500"
                        : line.startsWith("◼")
                          ? "#71717a"
                          : "var(--label-secondary)";
                return (
                  <p
                    key={i}
                    style={{ color }}
                    className="text-[10px] leading-[1.7]"
                  >
                    {line}
                  </p>
                );
              })}
              <div ref={logEndRef} />
            </div>
          )}

          {/* Result tab */}
          {activeTab === "result" && (
            <div className="flex-1 flex flex-col overflow-hidden">
              {finalOutput ? (
                <RichResult text={finalOutput} />
              ) : runStatus === "done" ? (
                <div className="flex flex-col items-center justify-center h-full gap-2 opacity-50">
                  <span className="text-2xl">📭</span>
                  <p className="text-[11px] text-[var(--label-secondary)]">
                    节点未返回输出内容
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full gap-2 opacity-40">
                  <span className="text-2xl">⏳</span>
                  <p className="text-[11px] text-[var(--label-secondary)]">
                    等待运行完成…
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
