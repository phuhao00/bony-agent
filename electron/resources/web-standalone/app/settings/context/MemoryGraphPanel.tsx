"use client";

/**
 * MemoryGraphPanel — 记忆网图，力导向图谱视图
 *
 * 实现方案与 OpenHuman MemoryGraph.tsx 完全一致：
 *   - 纯 SVG，无外部图形库
 *   - 自定义力导向模拟（库仑斥力 + 弹簧引力 + 向心力），useMemo 运行一次
 *   - 干净的白色/深色主题（bg-white dark:bg-neutral-900）
 *   - hover 节点 → 底部 tooltip bar 显示详情
 *   - 四种模式：memory / topic / usage / dream
 *
 * 数据来自 GET /api/context/memory-graph?mode=<mode>
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { navigateToMemory } from "@/lib/contextNavigation";
import { loadContextSettings } from "@/lib/contextSettings";
import { useTranslation } from "@/hooks/useTranslation";

// ─── 数据类型 ────────────────────────────────────────────────────────────────

export type MemGraphMode = "memories" | "topics" | "usage" | "dreams";

export interface MemNodeData {
  id: string;
  label: string;
  type: string;   // "memory" | "topic" | "usage" | "dream" | ...
  size?: number;
  score?: number;
}

export interface MemLinkData {
  source: string;
  target: string;
  relation?: string;
  weight?: number;
}

export interface MemGraphResponse {
  nodes: MemNodeData[];
  links: MemLinkData[];
  mode: string;
  snapshot_at?: string;
  error?: string;
}

// ─── 颜色 & 尺寸 ─────────────────────────────────────────────────────────────

const NODE_COLOR: Record<string, string> = {
  memory:     "#4A83DD",
  topic:      "#f59e0b",
  usage:      "#10b981",
  dream:      "#a78bfa",
  dream_card: "#a78bfa",
};

function legendItems(t: (key: string) => string): { type: string; label: string; color: string }[] {
  return [
    { type: "memory", label: t("settings.context.memGraph.legendMemory"), color: NODE_COLOR.memory },
    { type: "topic", label: t("settings.context.memGraph.legendTopic"), color: NODE_COLOR.topic },
    { type: "usage", label: t("settings.context.memGraph.legendUsage"), color: NODE_COLOR.usage },
    { type: "dream", label: t("settings.context.memGraph.legendDream"), color: NODE_COLOR.dream },
    { type: "dream_card", label: t("settings.context.memGraph.legendDream"), color: NODE_COLOR.dream_card },
  ];
}

function graphModes(t: (key: string) => string): { key: MemGraphMode; label: string }[] {
  return [
    { key: "memories", label: t("settings.context.memGraph.modeMemories") },
    { key: "topics", label: t("settings.context.memGraph.modeTopics") },
    { key: "usage", label: t("settings.context.memGraph.modeUsage") },
    { key: "dreams", label: t("settings.context.memGraph.modeDreams") },
  ];
}

function nodeColor(n: MemNodeData): string {
  return NODE_COLOR[n.type] ?? "#94a3b8";
}

function nodeRadius(n: MemNodeData): number {
  // size 越大、score 越高的节点略大
  const base = n.type === "topic" ? 8 : n.type === "dream" ? 7 : 5;
  const bonus = n.size != null ? Math.min(n.size * 0.3, 4) : 0;
  return base + bonus;
}

import { computeGraphLayout, VIEWPORT_H, VIEWPORT_W } from "./memoryGraphLayout";

const FETCH_TIMEOUT_MS = 15_000;

interface SimNode extends MemNodeData {
  x: number;
  y: number;
}

// ─── 主组件 ──────────────────────────────────────────────────────────────────

export function MemoryGraphPanel({
  highlightMemoryId,
  onHighlightConsumed,
  initialMode = "memories",
  visible = true,
}: {
  highlightMemoryId?: string;
  onHighlightConsumed?: () => void;
  initialMode?: MemGraphMode;
  visible?: boolean;
}) {
  const { t } = useTranslation();
  const modes = useMemo(() => graphModes(t), [t]);
  const [mode, setMode] = useState<MemGraphMode>(initialMode);
  const [data, setData] = useState<MemGraphResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [layoutLoading, setLayoutLoading] = useState(false);
  const [sim, setSim] = useState<{ nodes: SimNode[]; edges: Array<[number, number]> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hovered, setHovered] = useState<MemNodeData | null>(null);
  const [selected, setSelected] = useState<MemNodeData | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    if (initialMode) setMode(initialMode);
  }, [initialMode]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!highlightMemoryId || !data?.nodes) return;
    const node = data.nodes.find((n) => n.id === highlightMemoryId);
    if (!node) return;
    setHovered(node);
    setSelected(node);
    const timer = setTimeout(() => onHighlightConsumed?.(), 1200);
    return () => clearTimeout(timer);
  }, [highlightMemoryId, data, onHighlightConsumed]);

  const fetchGraph = useCallback(async (m: MemGraphMode) => {
    if (!mountedRef.current) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/context/memory-graph?mode=${m}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: MemGraphResponse = await res.json();
      if (json.error) throw new Error(json.error);
      if (!mountedRef.current) return;
      setData(json);
    } catch (e: unknown) {
      if (!mountedRef.current) return;
      if (e instanceof DOMException && e.name === "TimeoutError") {
        setError(t("settings.context.memGraph.timeout") || "Request timed out");
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!visible) return;
    void fetchGraph(mode);
  }, [fetchGraph, mode, visible]);

  const handleMode = (m: MemGraphMode) => {
    setMode(m);
  };

  useEffect(() => {
    if (!visible) return;
    const sec = loadContextSettings().graphAutoRefreshSec;
    if (!sec || sec <= 0) return;
    const id = setInterval(() => void fetchGraph(mode), sec * 1000);
    return () => clearInterval(id);
  }, [mode, fetchGraph, visible]);

  useEffect(() => {
    if (!data || data.nodes.length === 0) {
      setSim(null);
      setLayoutLoading(false);
      return;
    }

    setLayoutLoading(true);
    let cancelled = false;
    let worker: Worker | null = null;

    const applyLayout = (result: { nodes: SimNode[]; edges: Array<[number, number]> }) => {
      if (!cancelled && mountedRef.current) {
        setSim(result);
        setLayoutLoading(false);
      }
    };

    try {
      worker = new Worker(new URL("./memoryGraphLayout.worker.ts", import.meta.url));
      worker.onmessage = (event: MessageEvent<{ nodes: SimNode[]; edges: Array<[number, number]> }>) => {
        applyLayout(event.data);
        worker?.terminate();
      };
      worker.onerror = () => {
        applyLayout(computeGraphLayout(data.nodes, data.links) as {
          nodes: SimNode[];
          edges: Array<[number, number]>;
        });
        worker?.terminate();
      };
      worker.postMessage({ nodes: data.nodes, links: data.links });
    } catch {
      applyLayout(computeGraphLayout(data.nodes, data.links) as {
        nodes: SimNode[];
        edges: Array<[number, number]>;
      });
    }

    return () => {
      cancelled = true;
      worker?.terminate();
    };
  }, [data]);

  const busy = loading || layoutLoading;

  // ── 空状态 ──
  if (!loading && !error && data && data.nodes.length === 0) {
    return (
      <div className="space-y-3">
        <ModeSwitcher modes={modes} mode={mode} onMode={handleMode} onRefresh={() => void fetchGraph(mode)} loading={busy} t={t} />
        <div
          className="flex h-[600px] items-center justify-center rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--nav-active-fill)] text-sm text-[color:var(--label-secondary)]"
          data-testid="memory-graph-empty"
        >
          {t("settings.context.memGraph.empty")}
        </div>
      </div>
    );
  }

  // ── 加载 / 错误 ──
  if (busy && !sim) {
    return (
      <div className="space-y-3">
        <ModeSwitcher modes={modes} mode={mode} onMode={handleMode} onRefresh={() => void fetchGraph(mode)} loading={busy} t={t} />
        <div className="flex h-[600px] items-center justify-center rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] text-sm text-[color:var(--label-secondary)]">
          {t("settings.context.memGraph.loading")}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-3">
        <ModeSwitcher modes={modes} mode={mode} onMode={handleMode} onRefresh={() => void fetchGraph(mode)} loading={busy} t={t} />
        <div className="flex h-[600px] items-center justify-center rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] text-sm text-red-500">
          {error}
        </div>
      </div>
    );
  }

  if (!sim) return null;

  // ── 图例（只显示当前数据中存在的类型）──
  const presentTypes = new Set(data!.nodes.map(n => n.type));
  const legend = legendItems(t).filter(l => presentTypes.has(l.type));

  return (
    <div className="space-y-3">
      <ModeSwitcher modes={modes} mode={mode} onMode={handleMode} onRefresh={() => void fetchGraph(mode)} loading={busy} t={t} />

      <div className="memory-graph rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--card-bg)]">
        <div className="flex items-center justify-between gap-4 border-b border-[color:var(--separator-subtle)] px-4 py-2">
          <div className="flex items-center gap-3 text-xs text-[color:var(--label-secondary)]">
            <span>{t("settings.context.memGraph.nodeCount", { count: sim.nodes.length })}</span>
            <span className="text-[color:var(--separator-subtle)]">·</span>
            <span>{t("settings.context.memGraph.edgeCount", { count: sim.edges.length })}</span>
          </div>
          <div className="flex items-center gap-3">
            {legend.map(item => (
              <span
                key={item.type}
                className="flex items-center gap-1.5 text-xs text-[color:var(--foreground)]"
              >
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: item.color }}
                />
                {item.label}
              </span>
            ))}
          </div>
        </div>

        {/* SVG 力导向图 */}
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VIEWPORT_W} ${VIEWPORT_H}`}
          className="block w-full"
          style={{ height: "min(600px, calc(100vh - 22rem))", cursor: "default" }}
          data-testid="memory-graph-svg"
        >
          {/* 连边层 */}
          <g stroke="#cbd5e1" strokeWidth={0.6} opacity={0.7}>
            {sim.edges.map(([ai, bi], idx) => {
              const a = sim.nodes[ai];
              const b = sim.nodes[bi];
              return <line key={idx} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
            })}
          </g>

          {/* 节点层 */}
          <g>
            {sim.nodes.map(n => {
              const r       = nodeRadius(n);
              const fill    = nodeColor(n);
              const isHover = hovered?.id === n.id || selected?.id === n.id;
              return (
                <circle
                  key={n.id}
                  cx={n.x}
                  cy={n.y}
                  r={isHover ? r + 2 : r}
                  fill={fill}
                  stroke={isHover ? "#0f172a" : "#ffffff"}
                  strokeWidth={isHover ? 1.4 : 0.8}
                  style={{ cursor: "pointer", transition: "r 120ms ease" }}
                  onMouseEnter={() => setHovered(n)}
                  onMouseLeave={() =>
                    setHovered(prev => (prev?.id === n.id ? null : prev))
                  }
                  onClick={() => {
                    setSelected(n);
                    if (n.type === "memory" || n.type === "dream" || n.type === "dream_card") {
                      navigateToMemory(n.id, "browser");
                    }
                  }}
                  data-testid={`memory-graph-node-${n.id}`}
                >
                  <title>{tooltipText(n, t)}</title>
                </circle>
              );
            })}
          </g>
        </svg>

        {/* 底部 tooltip bar */}
        {(hovered || selected) && (
          <div
            className="flex items-center justify-between border-t border-[color:var(--separator-subtle)] bg-[var(--nav-active-fill)] px-4 py-2 text-xs text-[color:var(--foreground)]"
            data-testid="memory-graph-tooltip"
          >
            <TooltipBar node={(hovered || selected)!} t={t} />
            {(hovered || selected)?.type === "memory" ? (
              <button
                type="button"
                onClick={() => navigateToMemory((hovered || selected)!.id, "browser")}
                className="shrink-0 rounded-md bg-[color:var(--accent)] px-2 py-1 text-[10px] font-medium text-white"
              >
                {t("settings.context.viewInBrowser")}
              </button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── 子组件 ──────────────────────────────────────────────────────────────────

function ModeSwitcher({
  modes,
  mode,
  onMode,
  onRefresh,
  loading,
  t,
}: {
  modes: { key: MemGraphMode; label: string }[];
  mode: MemGraphMode;
  onMode: (m: MemGraphMode) => void;
  onRefresh: () => void;
  loading: boolean;
  t: (key: string) => string;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex gap-1 rounded-lg bg-[var(--nav-active-fill)] p-1">
        {modes.map(m => (
          <button
            key={m.key}
            onClick={() => onMode(m.key)}
            className={[
              "rounded-md px-3 py-1 text-xs font-medium transition-colors",
              mode === m.key
                ? "bg-[var(--card-bg)] text-[color:var(--foreground)] shadow-sm"
                : "text-[color:var(--label-secondary)] hover:text-[color:var(--foreground)]",
            ].join(" ")}
          >
            {m.label}
          </button>
        ))}
      </div>
      <button
        onClick={onRefresh}
        disabled={loading}
        title={t("settings.context.memGraph.refresh")}
        className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-[color:var(--label-secondary)] hover:text-[color:var(--foreground)] hover:bg-[var(--nav-active-fill)] transition-colors disabled:opacity-40"
      >
        <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
        {t("settings.context.memGraph.refresh")}
      </button>
    </div>
  );
}

function TooltipBar({
  node,
  t,
}: {
  node: MemNodeData;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const typeLabel: Record<string, string> = {
    memory: t("settings.context.memGraph.typeMemory"),
    topic: t("settings.context.memGraph.typeTopic"),
    usage: t("settings.context.memGraph.typeUsage"),
    dream: t("settings.context.memGraph.typeDream"),
    dream_card: t("settings.context.memGraph.typeDream"),
  };
  return (
    <>
      <span className="font-medium">{node.label}</span>
      <span className="mx-2 text-[color:var(--label-secondary)]">·</span>
      <span className="capitalize text-[color:var(--label-secondary)]">
        {typeLabel[node.type] ?? node.type}
      </span>
      {node.size != null && (
        <>
          <span className="mx-2 text-[color:var(--label-secondary)]">·</span>
          <span className="text-[color:var(--label-secondary)]">
            {t("settings.context.memGraph.weight", { value: node.size.toFixed(2) })}
          </span>
        </>
      )}
      {node.score != null && (
        <>
          <span className="mx-2 text-[color:var(--label-secondary)]">·</span>
          <span className="text-[color:var(--label-secondary)]">
            {t("settings.context.memGraph.score", { value: node.score.toFixed(2) })}
          </span>
        </>
      )}
    </>
  );
}

function tooltipText(
  n: MemNodeData,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  const parts = [n.label, n.type];
  if (n.size != null) {
    parts.push(t("settings.context.memGraph.weight", { value: n.size.toFixed(2) }));
  }
  return parts.join(" · ");
}

export default MemoryGraphPanel;
