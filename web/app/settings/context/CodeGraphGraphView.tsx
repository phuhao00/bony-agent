"use client";

import { RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "@/hooks/useTranslation";

export type CGEdgeMode = "calls" | "imports" | "contains";

export interface CGNode {
  id: string;
  label: string;
  kind: string;
  name: string;
  filePath?: string;
  line?: number;
  isCenter?: boolean;
}

export interface CGLink {
  source: string;
  target: string;
  relation?: string;
}

export interface CGGraphResponse {
  nodes: CGNode[];
  links: CGLink[];
  center?: string;
  edgeKinds?: string[];
  hops?: number;
  nodeCount?: number;
  edgeCount?: number;
  error?: string;
}

const VIEWPORT_W = 1100;
const VIEWPORT_H = 560;

const NODE_COLOR: Record<string, string> = {
  function: "#4A83DD",
  method: "#10b981",
  class: "#f59e0b",
  interface: "#38bdf8",
  struct: "#a78bfa",
  file: "#94a3b8",
  constant: "#cbd5e1",
  variable: "#e2e8f0",
};

interface SimNode extends CGNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

function relaxLayout(
  nodes: SimNode[],
  edges: Array<[number, number]>,
  iterations = 240,
): void {
  const n = nodes.length;
  const REPULSION = Math.max(2800, n * 70);
  const SPRING_K = 0.02;
  const SPRING_LEN = Math.max(80, 180 - n);
  const CENTER_K = 0.0012;
  const FRICTION = 0.82;
  const cx = VIEWPORT_W / 2;
  const cy = VIEWPORT_H / 2;

  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist2 = dx * dx + dy * dy + 0.01;
        const force = REPULSION / dist2;
        const dist = Math.sqrt(dist2);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      }
    }
    for (const [ai, bi] of edges) {
      const a = nodes[ai];
      const b = nodes[bi];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) + 0.01;
      const delta = dist - SPRING_LEN;
      const fx = (dx / dist) * delta * SPRING_K;
      const fy = (dy / dist) * delta * SPRING_K;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }
    for (const node of nodes) {
      node.vx += (cx - node.x) * CENTER_K;
      node.vy += (cy - node.y) * CENTER_K;
      node.vx *= FRICTION;
      node.vy *= FRICTION;
      node.x += node.vx;
      node.y += node.vy;
    }
  }
}

function nodeRadius(n: CGNode): number {
  if (n.isCenter) return 9;
  if (n.kind === "class") return 8;
  if (n.kind === "file") return 7;
  return 6;
}

function nodeColor(n: CGNode): string {
  return NODE_COLOR[n.kind] ?? "#64748b";
}

function shortLabel(n: CGNode): string {
  const label = n.label || n.name;
  return label.length > 22 ? `${label.slice(0, 20)}…` : label;
}

export function CodeGraphGraphView({
  ready,
  defaultSymbol,
  defaultScope = "backend/services",
}: {
  ready: boolean;
  defaultSymbol?: string;
  defaultScope?: string;
}) {
  const { t } = useTranslation();
  const searchWrapRef = useRef<HTMLDivElement>(null);
  const initialSymbol = defaultSymbol ?? "";
  const [inputQuery, setInputQuery] = useState(initialSymbol);
  const [activeSymbol, setActiveSymbol] = useState(initialSymbol);
  const [scope, setScope] = useState(defaultScope);
  const [edgeMode, setEdgeMode] = useState<CGEdgeMode>("calls");
  const [hops, setHops] = useState(1);
  const [data, setData] = useState<CGGraphResponse | null>(null);
  const [suggestions, setSuggestions] = useState<CGNode[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hovered, setHovered] = useState<CGNode | null>(null);
  const [selected, setSelected] = useState<CGNode | null>(null);

  const closePicker = useCallback(() => {
    setPickerOpen(false);
    setSuggestions([]);
  }, []);

  const applySymbol = useCallback((symbol: string, opts?: { clearScope?: boolean }) => {
    const trimmed = symbol.trim();
    setInputQuery(trimmed);
    setActiveSymbol(trimmed);
    if (opts?.clearScope) setScope("");
    closePicker();
  }, [closePicker]);

  const fetchGraph = useCallback(
    async (symbol: string, scopePath: string) => {
      if (!ready) return;
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          hops: String(hops),
          max_nodes: "72",
          edge_kinds: edgeMode,
        });
        if (symbol.trim()) params.set("symbol", symbol.trim());
        else params.set("scope", scopePath.trim() || defaultScope);

        const res = await fetch(`/api/context/codegraph/graph?${params}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: CGGraphResponse = await res.json();
        if (json.error && !json.nodes?.length) {
          throw new Error(json.error);
        }
        setData(json);
      } catch (e) {
        setError(e instanceof Error ? e.message : "load failed");
      } finally {
        setLoading(false);
      }
    },
    [ready, hops, edgeMode, defaultScope],
  );

  useEffect(() => {
    if (!ready) return;
    void fetchGraph(activeSymbol, scope);
  }, [ready, fetchGraph, activeSymbol, scope, hops, edgeMode]);

  const showPicker =
    pickerOpen &&
    inputQuery.trim().length >= 2 &&
    inputQuery.trim() !== activeSymbol.trim() &&
    suggestions.length > 0;

  useEffect(() => {
    if (!ready || !pickerOpen || inputQuery.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    if (inputQuery.trim() === activeSymbol.trim()) {
      setSuggestions([]);
      return;
    }
    const timer = setTimeout(() => {
      void fetch(`/api/context/codegraph/search?q=${encodeURIComponent(inputQuery)}&limit=6`)
        .then((r) => r.json())
        .then((rows: CGNode[]) => setSuggestions(Array.isArray(rows) ? rows : []))
        .catch(() => setSuggestions([]));
    }, 280);
    return () => clearTimeout(timer);
  }, [inputQuery, pickerOpen, activeSymbol, ready]);

  useEffect(() => {
    if (!pickerOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (searchWrapRef.current?.contains(e.target as Node)) return;
      closePicker();
      setInputQuery(activeSymbol);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [pickerOpen, activeSymbol, closePicker]);

  const sim = useMemo(() => {
    if (!data?.nodes?.length) return null;
    const idIndex = new Map<string, number>();
    data.nodes.forEach((n, i) => idIndex.set(n.id, i));

    const simNodes: SimNode[] = data.nodes.map((n, i) => {
      const angle = (i / data.nodes.length) * Math.PI * 2;
      const r = n.isCenter ? 40 : 160 + (i % 9) * 14;
      return {
        ...n,
        x: VIEWPORT_W / 2 + Math.cos(angle) * r,
        y: VIEWPORT_H / 2 + Math.sin(angle) * r,
        vx: 0,
        vy: 0,
      };
    });

    const MAX_EDGES = 4;
    const edgeCount = new Array<number>(data.nodes.length).fill(0);
    const sorted = [...data.links].sort(
      (a, b) =>
        Number(data.nodes[idIndex.get(b.source) ?? 0]?.isCenter) -
        Number(data.nodes[idIndex.get(a.source) ?? 0]?.isCenter),
    );
    const edgeIndices: Array<[number, number]> = [];
    for (const e of sorted) {
      const a = idIndex.get(e.source);
      const b = idIndex.get(e.target);
      if (a == null || b == null) continue;
      if (edgeCount[a] >= MAX_EDGES || edgeCount[b] >= MAX_EDGES) continue;
      edgeIndices.push([a, b]);
      edgeCount[a]++;
      edgeCount[b]++;
    }

    relaxLayout(simNodes, edgeIndices);
    return { nodes: simNodes, edges: edgeIndices };
  }, [data]);

  const presentKinds = useMemo(() => {
    const set = new Set<string>();
    data?.nodes?.forEach((n) => set.add(n.kind));
    return [...set];
  }, [data]);

  if (!ready) {
    return (
      <div className="flex h-[420px] items-center justify-center rounded-2xl border border-dashed border-[color:var(--separator-subtle)] bg-[var(--nav-active-fill)] text-[13px] text-[color:var(--label-secondary)]">
        {t("settings.context.codegraphGraph.indexFirst")}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="card-surface flex flex-col gap-3 rounded-2xl px-4 py-3 lg:flex-row lg:items-center">
        <div ref={searchWrapRef} className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--label-secondary)]" />
          <input
            value={inputQuery}
            onChange={(e) => {
              setInputQuery(e.target.value);
              setPickerOpen(true);
            }}
            onFocus={() => setPickerOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applySymbol(inputQuery, { clearScope: Boolean(inputQuery.trim()) });
              } else if (e.key === "Escape") {
                e.preventDefault();
                setInputQuery(activeSymbol);
                closePicker();
              }
            }}
            placeholder={t("settings.context.codegraphGraph.searchPlaceholder")}
            className="w-full rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] py-2 pl-10 pr-3 text-[13px] text-[color:var(--foreground)] outline-none placeholder:text-[color:var(--label-secondary)] focus:border-[color:var(--accent)] focus:ring-2 focus:ring-[color:color-mix(in_srgb,var(--accent)_30%,transparent)]"
            autoComplete="off"
            aria-expanded={showPicker}
            aria-autocomplete="list"
          />
          {showPicker ? (
            <ul
              role="listbox"
              className="absolute z-20 mt-1 max-h-44 w-full overflow-auto rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] py-1 shadow-lg"
            >
              {suggestions.map((s) => (
                <li key={s.id} role="option">
                  <button
                    type="button"
                    className="flex w-full flex-col px-3 py-2 text-left text-[12px] hover:bg-[var(--nav-active-fill)]"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => applySymbol(s.name, { clearScope: true })}
                  >
                    <span className="font-medium text-[color:var(--foreground)]">{s.name}</span>
                    <span className="truncate text-[color:var(--label-secondary)]">
                      {s.kind} · {s.filePath}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            placeholder={t("settings.context.codegraphGraph.scopePlaceholder")}
            className="w-44 rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] px-3 py-2 text-[12px] text-[color:var(--foreground)] outline-none focus:border-[color:var(--accent)]"
          />
          <select
            value={edgeMode}
            onChange={(e) => setEdgeMode(e.target.value as CGEdgeMode)}
            className="rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] px-3 py-2 text-[12px] text-[color:var(--foreground)]"
          >
            <option value="calls">{t("settings.context.codegraphGraph.edgeCalls")}</option>
            <option value="imports">{t("settings.context.codegraphGraph.edgeImports")}</option>
            <option value="contains">{t("settings.context.codegraphGraph.edgeContains")}</option>
          </select>
          <select
            value={hops}
            onChange={(e) => setHops(Number(e.target.value))}
            className="rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] px-3 py-2 text-[12px] text-[color:var(--foreground)]"
          >
            <option value={0}>{t("settings.context.codegraphGraph.hops0")}</option>
            <option value={1}>{t("settings.context.codegraphGraph.hops1")}</option>
            <option value={2}>{t("settings.context.codegraphGraph.hops2")}</option>
          </select>
          <button
            type="button"
            onClick={() => void fetchGraph(activeSymbol, scope)}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[color:var(--separator-subtle)] px-3 py-2 text-[12px] text-[color:var(--label-secondary)] hover:bg-[var(--nav-active-fill)] disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            {t("settings.context.statusRefresh")}
          </button>
        </div>
      </div>

      <p className="text-[12px] leading-relaxed text-[color:var(--label-secondary)]">
        {t("settings.context.codegraphGraph.hint")}
      </p>

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50/50 p-4 text-[13px] text-red-600 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300">
          {error}
        </div>
      ) : null}

      <div className="codegraph-graph rounded-2xl border border-[color:var(--separator-subtle)] bg-[var(--card-bg)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--separator-subtle)] px-4 py-2">
          <div className="flex items-center gap-2 text-xs text-[color:var(--label-secondary)]">
            <span>
              {t("settings.context.codegraphGraph.nodeCount", {
                count: sim?.nodes.length ?? 0,
              })}
            </span>
            <span>·</span>
            <span>
              {t("settings.context.codegraphGraph.edgeCount", {
                count: sim?.edges.length ?? 0,
              })}
            </span>
            {data?.center ? (
              <>
                <span>·</span>
                <span className="font-mono text-[color:var(--foreground)]">{data.center}</span>
              </>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {presentKinds.map((kind) => (
              <span
                key={kind}
                className="flex items-center gap-1 text-[11px] text-[color:var(--foreground)]"
              >
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: NODE_COLOR[kind] ?? "#64748b" }}
                />
                {kind}
              </span>
            ))}
          </div>
        </div>

        {loading && !sim ? (
          <div className="flex h-[480px] items-center justify-center text-[13px] text-[color:var(--label-secondary)]">
            {t("settings.context.codegraphGraph.loading")}
          </div>
        ) : !sim ? (
          <div className="flex h-[480px] items-center justify-center text-[13px] text-[color:var(--label-secondary)]">
            {t("settings.context.codegraphGraph.empty")}
          </div>
        ) : (
          <svg
            viewBox={`0 0 ${VIEWPORT_W} ${VIEWPORT_H}`}
            className="block w-full"
            style={{ height: "min(520px, calc(100vh - 20rem))" }}
          >
            <g stroke="#cbd5e1" strokeWidth={0.7} opacity={0.75}>
              {sim.edges.map(([ai, bi], idx) => {
                const a = sim.nodes[ai];
                const b = sim.nodes[bi];
                return (
                  <line
                    key={idx}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    markerEnd="url(#cg-arrow)"
                  />
                );
              })}
            </g>
            <defs>
              <marker
                id="cg-arrow"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="5"
                markerHeight="5"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8" />
              </marker>
            </defs>
            <g>
              {sim.nodes.map((n) => {
                const r = nodeRadius(n);
                const fill = nodeColor(n);
                const hot = hovered?.id === n.id || selected?.id === n.id;
                return (
                  <g key={n.id}>
                    <circle
                      cx={n.x}
                      cy={n.y}
                      r={hot ? r + 2 : r}
                      fill={fill}
                      stroke={n.isCenter ? "#0f172a" : hot ? "#334155" : "#fff"}
                      strokeWidth={n.isCenter ? 2 : hot ? 1.5 : 0.8}
                      style={{ cursor: "pointer" }}
                      onMouseEnter={() => setHovered(n)}
                      onMouseLeave={() =>
                        setHovered((prev) => (prev?.id === n.id ? null : prev))
                      }
                      onClick={() => {
                        setSelected(n);
                        applySymbol(n.name, { clearScope: true });
                      }}
                    />
                    <text
                      x={n.x}
                      y={n.y + r + 11}
                      textAnchor="middle"
                      fontSize={10}
                      fill="var(--foreground, #0f172a)"
                      stroke="#fff"
                      strokeWidth={2}
                      paintOrder="stroke"
                      pointerEvents="none"
                    >
                      {shortLabel(n)}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
        )}

        {(hovered || selected) && (
          <div className="flex flex-wrap items-center gap-2 border-t border-[color:var(--separator-subtle)] bg-[var(--nav-active-fill)] px-4 py-2 text-[12px] text-[color:var(--foreground)]">
            <span className="font-semibold">{(hovered || selected)!.name}</span>
            <span className="text-[color:var(--label-secondary)]">
              {(hovered || selected)!.kind}
            </span>
            {(hovered || selected)!.filePath ? (
              <span className="truncate font-mono text-[11px] text-[color:var(--label-secondary)]">
                {(hovered || selected)!.filePath}
                {(hovered || selected)!.line ? `:${(hovered || selected)!.line}` : ""}
              </span>
            ) : null}
            <button
              type="button"
              className="ml-auto rounded-md bg-[color:var(--accent)] px-2 py-1 text-[10px] font-medium text-white"
              onClick={() => {
                const n = hovered || selected;
                if (!n) return;
                applySymbol(n.name, { clearScope: true });
              }}
            >
              {t("settings.context.codegraphGraph.expand")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default CodeGraphGraphView;
