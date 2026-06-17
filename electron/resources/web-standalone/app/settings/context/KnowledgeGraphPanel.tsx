"use client";

import { RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    ENTITY_LEGEND,
    KNOWLEDGE_GRAPH_SEED,
    colorForType,
    computePageRank,
    legendCounts,
    normalizeEntityType,
    type EntityType,
    type KGLinkData,
    type KGNodeData,
} from "./mockKnowledgeGraph";
import {
    chordTrimmedEndpoints,
    fitViewTransform,
    layoutKnowledgeGraphStatic,
    linkPathSeed,
    synapsePathWithBend,
    type LaidOutNode,
} from "./staticGraphLayout";

function stableUndirectedEdgeKey(source: string, target: string): string {
  return source < target ? `${source}\0${target}` : `${target}\0${source}`;
}

function neighborFilter(rootId: string, links: KGLinkData[]) {
  const set = new Set<string>([rootId]);
  links.forEach((l) => {
    if (l.source === rootId) set.add(l.target);
    if (l.target === rootId) set.add(l.source);
  });
  return set;
}

function clientToGraphCoords(
  clientX: number,
  clientY: number,
  svg: SVGSVGElement,
  view: { tx: number; ty: number; s: number },
) {
  const r = svg.getBoundingClientRect();
  const ux = clientX - r.left;
  const uy = clientY - r.top;
  return {
    gx: (ux - view.tx) / view.s,
    gy: (uy - view.ty) / view.s,
  };
}

function stableDepthFromId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 9899) / 9899;
}

/** 星座视图：近大远小（围绕节点中心缩放，不改变布局坐标，便于拖拽与命中）。 */
function depthScaleForNode(
  n: Pick<KGNodeData, "id" | "rank">,
  sizeMode: "pagerank" | "uniform",
  rankMin: number,
  rankMax: number,
): number {
  let z: number;
  if (sizeMode === "pagerank" && rankMax > rankMin) {
    z = (n.rank - rankMin) / (rankMax - rankMin);
  } else {
    z = stableDepthFromId(n.id);
  }
  const clamped = Math.min(1, Math.max(0, z));
  return 0.44 + 0.56 * clamped;
}

function seededStars(
  w: number,
  h: number,
  count: number,
  seed: number,
): { x: number; y: number; r: number; o: number }[] {
  const out: { x: number; y: number; r: number; o: number }[] = [];
  let s = seed >>> 0;
  const rnd = () => {
    s = Math.imul(s ^ (s << 13), 1597334677);
    return (s >>> 0) / 4294967296;
  };
  for (let i = 0; i < count; i++) {
    out.push({
      x: rnd() * w,
      y: rnd() * h,
      r: 0.35 + rnd() * 1.15,
      o: 0.14 + rnd() * 0.5,
    });
  }
  return out;
}

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace("#", "").trim();
  if (h.length === 3)
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return [148, 163, 184];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** 连线颜色：两端实体类型的混合，便于呈现「化学梯度」般的突触色差。 */
function mixEdgeRgb(ca: string, cb: string, alpha: number): string {
  const [ar, ag, ab] = hexToRgb(ca);
  const [br, bg, bb] = hexToRgb(cb);
  const r = Math.round(ar * 0.52 + br * 0.48);
  const g = Math.round(ag * 0.52 + bg * 0.48);
  const b = Math.round(ab * 0.52 + bb * 0.48);
  return `rgba(${r},${g},${b},${alpha})`;
}

export default function KnowledgeGraphPanel() {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef({ s: 1, tx: 0, ty: 0 });
  const lastTapRef = useRef<{ id: string; at: number } | null>(null);
  const panRef = useRef<{
    pid: number | null;
    sx: number;
    sy: number;
    tx0: number;
    ty0: number;
    s0: number;
  }>({ pid: null, sx: 0, sy: 0, tx0: 0, ty0: 0, s0: 1 });

  const positionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const nodeDragRef = useRef<{
    id: string | null;
    pid: number | null;
    grabDx: number;
    grabDy: number;
    startX: number;
    startY: number;
    moved: boolean;
  }>({
    id: null,
    pid: null,
    grabDx: 0,
    grabDy: 0,
    startX: 0,
    startY: 0,
    moved: false,
  });
  const positionedNodesRef = useRef<LaidOutNode[]>([]);

  const edgeBendRef = useRef<Map<string, { dx: number; dy: number }>>(
    new Map(),
  );
  const edgeDragRef = useRef<{
    key: string | null;
    pid: number | null;
    lastGx: number;
    lastGy: number;
  }>({ key: null, pid: null, lastGx: 0, lastGy: 0 });

  /** 多点触控：存储每个 pointerId 最新屏幕坐标，用于双指捏合缩放 */
  const pointerCacheRef = useRef<Map<number, { x: number; y: number }>>(
    new Map(),
  );
  const pinchRef = useRef<{
    id1: number;
    id2: number;
    midX: number;
    midY: number;
    startDist: number;
    s0: number;
    tx0: number;
    ty0: number;
  } | null>(null);

  const [dragTick, setDragTick] = useState(0);
  const [edgeDragTick, setEdgeDragTick] = useState(0);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [draggingEdgeKey, setDraggingEdgeKey] = useState<string | null>(null);

  const [dims, setDims] = useState({ w: 320, h: 480 });

  const [graphData, setGraphData] = useState<{
    nodes: KGNodeData[];
    links: KGLinkData[];
  }>({ nodes: [], links: [] });
  const [loadState, setLoadState] = useState<"idle" | "loading" | "done">(
    "idle",
  );
  const [usingFallback, setUsingFallback] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [visibleTypes, setVisibleTypes] = useState<Set<EntityType>>(
    () => new Set(ENTITY_LEGEND.map((e) => e.type)),
  );
  const [query, setQuery] = useState("");
  const [sizeMode, setSizeMode] = useState<"pagerank" | "uniform">("pagerank");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [layoutSalt, setLayoutSalt] = useState(0);
  const [view, setView] = useState({ s: 1, tx: 0, ty: 0 });

  viewRef.current = view;

  const dimsRef = useRef(dims);
  dimsRef.current = dims;

  const loadGraph = useCallback(async () => {
    setLoadState("loading");
    setLoadError(null);
    try {
      const res = await fetch("/api/context/knowledge-graph");
      const data = (await res.json()) as {
        success?: boolean;
        nodes?: { id: string; name?: string; type?: string }[];
        links?: KGLinkData[];
        error?: string;
      };
      if (
        !res.ok ||
        data.success === false ||
        !Array.isArray(data.nodes) ||
        !Array.isArray(data.links)
      ) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const links = data.links.map((l) => ({
        source: String(l.source),
        target: String(l.target),
      }));
      const nodesRaw: KGNodeData[] = data.nodes.map((n) => ({
        id: String(n.id),
        name: String(n.name ?? n.id),
        type: normalizeEntityType(String(n.type ?? "defined_term")),
        rank: 0.01,
      }));
      const ranks = computePageRank(
        nodesRaw.map((n) => n.id),
        links,
      );
      const nodes = nodesRaw.map((n) => ({
        ...n,
        rank: ranks.get(n.id) ?? 0.01,
      }));
      setGraphData({ nodes, links });
      setUsingFallback(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLoadError(msg);
      setGraphData({
        nodes: KNOWLEDGE_GRAPH_SEED.nodes.map((n) => ({ ...n })),
        links: KNOWLEDGE_GRAPH_SEED.links.map((l) => ({ ...l })),
      });
      setUsingFallback(true);
    } finally {
      setLoadState("done");
    }
  }, []);

  useEffect(() => {
    void loadGraph();
  }, [loadGraph]);

  const counts = useMemo(
    () => legendCounts(graphData.nodes),
    [graphData.nodes],
  );

  const rankBounds = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const n of graphData.nodes) {
      min = Math.min(min, n.rank);
      max = Math.max(max, n.rank);
    }
    if (!Number.isFinite(min) || !Number.isFinite(max))
      return { min: 0, max: 1 };
    return { min, max };
  }, [graphData.nodes]);

  const filteredGraph = useMemo(() => {
    const nodes = graphData.nodes
      .filter((n) => visibleTypes.has(n.type))
      .map((n) => ({ ...n }));
    const idSet = new Set(nodes.map((n) => n.id));
    const links = graphData.links
      .filter((l) => idSet.has(l.source) && idSet.has(l.target))
      .map((l) => ({ ...l }));
    return { nodes, links };
  }, [graphData, visibleTypes]);

  /** 仅保留真实存在的边（后端列表），并按无向去重，避免出现重复突触。同时过滤掉孤立节点与纯叶节点（只有1条连线的节点）。 */
  const layoutGraph = useMemo(() => {
    const seen = new Set<string>();
    const links: KGLinkData[] = [];
    for (const l of filteredGraph.links) {
      if (l.source === l.target) continue;
      const k = stableUndirectedEdgeKey(l.source, l.target);
      if (seen.has(k)) continue;
      seen.add(k);
      const [s, t] =
        l.source < l.target ? [l.source, l.target] : [l.target, l.source];
      links.push({ source: s, target: t });
    }
    // 计算每个节点的度数
    const degree = new Map<string, number>();
    for (const l of links) {
      degree.set(l.source, (degree.get(l.source) ?? 0) + 1);
      degree.set(l.target, (degree.get(l.target) ?? 0) + 1);
    }
    // 只保留度数 ≥ 2 的节点（即至少有两条边），以及 hub 节点（id 以 "hub-" 开头）
    const meaningfulIds = new Set<string>();
    for (const [id, deg] of degree) {
      if (deg >= 2 || id.startsWith("hub-")) meaningfulIds.add(id);
    }
    // 移除两端都不在有意义节点中的边，但保留至少一端是 hub 且另一端度数 ≥ 2 的边
    const finalLinks = links.filter(
      (l) => meaningfulIds.has(l.source) && meaningfulIds.has(l.target),
    );
    const connectedIds = new Set<string>();
    for (const l of finalLinks) {
      connectedIds.add(l.source);
      connectedIds.add(l.target);
    }
    const nodes = filteredGraph.nodes.filter((n) => connectedIds.has(n.id));
    return { nodes, links: finalLinks };
  }, [filteredGraph.nodes, filteredGraph.links]);

  const laidOut = useMemo(() => {
    if (!layoutGraph.nodes.length) return [] as LaidOutNode[];
    return layoutKnowledgeGraphStatic(
      layoutGraph.nodes,
      layoutGraph.links,
      sizeMode,
      layoutSalt,
    );
  }, [layoutGraph, sizeMode, layoutSalt]);

  const layoutRevision = useMemo(
    () =>
      `${layoutSalt}\0${sizeMode}\0${layoutGraph.nodes
        .map((n) => n.id)
        .sort()
        .join("|")}\0${layoutGraph.links
        .map((l) => `${l.source}->${l.target}`)
        .sort()
        .join("|")}`,
    [layoutGraph, layoutSalt, sizeMode],
  );

  useEffect(() => {
    positionsRef.current.clear();
    laidOut.forEach((n) => {
      positionsRef.current.set(n.id, { x: n.x, y: n.y });
    });
    edgeBendRef.current.clear();
    setDragTick((t) => t + 1);
    setEdgeDragTick((t) => t + 1);
  }, [layoutRevision, laidOut]);

  const positionedNodes = useMemo(() => {
    void dragTick;
    void edgeDragTick;
    return laidOut.map((n) => {
      const o = positionsRef.current.get(n.id);
      return o ? { ...n, x: o.x, y: o.y } : { ...n };
    });
  }, [laidOut, dragTick, edgeDragTick]);

  positionedNodesRef.current = positionedNodes;

  const VIEW_PAD = 56;

  useEffect(() => {
    const d = dimsRef.current;
    if (!laidOut.length || d.w <= 80 || d.h <= 80) return;
    setView(fitViewTransform(laidOut, d.w, d.h, VIEW_PAD));
  }, [layoutRevision, laidOut]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      const d = dimsRef.current;
      const nodes = positionedNodesRef.current;
      if (!nodes.length || d.w <= 80 || d.h <= 80) return;
      setView(fitViewTransform(nodes, d.w, d.h, VIEW_PAD));
    }, 320);
    return () => window.clearTimeout(t);
  }, [dims.w, dims.h]);

  const nodePos = useMemo(
    () => new Map(positionedNodes.map((n) => [n.id, n])),
    [positionedNodes],
  );

  const depthById = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of positionedNodes) {
      m.set(
        n.id,
        depthScaleForNode(n, sizeMode, rankBounds.min, rankBounds.max),
      );
    }
    return m;
  }, [positionedNodes, sizeMode, rankBounds]);

  const bgStars = useMemo(
    () =>
      seededStars(
        dims.w,
        dims.h,
        Math.min(260, Math.max(80, Math.floor((dims.w * dims.h) / 3800))),
        7781,
      ),
    [dims.w, dims.h],
  );

  /** 较远（尺度小）的连线先画，近处亮线叠在上面 */
  const constellationLinkOrder = useMemo(() => {
    return [...layoutGraph.links].sort((l1, l2) => {
      const s1 =
        (depthById.get(l1.source) ?? 1) + (depthById.get(l1.target) ?? 1);
      const s2 =
        (depthById.get(l2.source) ?? 1) + (depthById.get(l2.target) ?? 1);
      return s1 - s2;
    });
  }, [layoutGraph.links, depthById]);

  const constellationNodeOrder = useMemo(() => {
    return [...positionedNodes].sort(
      (a, b) =>
        (depthById.get(a.id) ?? 1) - (depthById.get(b.id) ?? 1),
    );
  }, [positionedNodes, depthById]);

  const qLower = query.trim().toLowerCase();
  const searchActive = qLower.length > 0;

  const matchesQuery = useCallback(
    (n: Pick<KGNodeData, "id" | "name">) =>
      !searchActive ||
      n.name.toLowerCase().includes(qLower) ||
      n.id.toLowerCase().includes(qLower),
    [qLower, searchActive],
  );

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const apply = () => {
      const cr = el.getBoundingClientRect();
      const w = Math.max(120, Math.floor(cr.width));
      const h = Math.max(420, Math.floor(cr.height));
      setDims({ w, h });
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    // 绑定到 wrapRef（始终渲染）而非 svgRef（条件渲染，首次挂载时可能为 null）
    const el = wrapRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      let factor: number;
      if (e.ctrlKey) {
        // macOS 触控板捏合手势：Chrome/Firefox 将其映射为 wheel + ctrlKey=true
        // deltaY 值很小（约 ±1~5），用 0.97 底数获得自然手感
        factor = Math.pow(0.97, e.deltaY);
      } else {
        // 普通鼠标滚轮 / 触控板双指滚动
        factor = Math.pow(0.999, e.deltaY);
      }

      setView((v) => {
        const gx = (mx - v.tx) / v.s;
        const gy = (my - v.ty) / v.s;
        const ns = Math.min(Math.max(v.s * factor, 0.02), 40);
        return { s: ns, tx: mx - gx * ns, ty: my - gy * ns };
      });
    };

    // Safari 特有的手势事件（GestureEvent）
    let safariGestureScale = 1;
    let safariGestureMx = 0;
    let safariGestureMy = 0;
    const handleGestureStart = (e: Event) => {
      e.preventDefault();
      safariGestureScale = viewRef.current.s;
      const ge = e as unknown as { clientX: number; clientY: number };
      const rect = el.getBoundingClientRect();
      safariGestureMx = ge.clientX - rect.left;
      safariGestureMy = ge.clientY - rect.top;
    };
    const handleGestureChange = (e: Event) => {
      e.preventDefault();
      const ge = e as unknown as { scale: number };
      const ns = Math.min(Math.max(safariGestureScale * ge.scale, 0.02), 40);
      const v = viewRef.current;
      const gx = (safariGestureMx - v.tx) / v.s;
      const gy = (safariGestureMy - v.ty) / v.s;
      setView({
        s: ns,
        tx: safariGestureMx - gx * ns,
        ty: safariGestureMy - gy * ns,
      });
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    el.addEventListener("gesturestart", handleGestureStart, { passive: false });
    el.addEventListener("gesturechange", handleGestureChange, {
      passive: false,
    });
    return () => {
      el.removeEventListener("wheel", handleWheel);
      el.removeEventListener("gesturestart", handleGestureStart);
      el.removeEventListener("gesturechange", handleGestureChange);
    };
  }, []);

  const fitFull = useCallback(() => {
    const nodes = positionedNodesRef.current;
    if (!nodes.length) return;
    setView(fitViewTransform(nodes, dims.w, dims.h, VIEW_PAD));
  }, [dims.w, dims.h]);

  const fitSubset = useCallback(
    (ids: Set<string>) => {
      const sub = positionedNodesRef.current.filter((n) => ids.has(n.id));
      if (!sub.length) return;
      setView(fitViewTransform(sub, dims.w, dims.h, VIEW_PAD));
    },
    [dims.w, dims.h],
  );

  const zoomAroundCenter = useCallback((factor: number) => {
    const d = dimsRef.current;
    const cx = d.w / 2;
    const cy = d.h / 2;
    setView((v) => {
      const gx = (cx - v.tx) / v.s;
      const gy = (cy - v.ty) / v.s;
      const ns = Math.min(Math.max(v.s * factor, 0.02), 40);
      return { s: ns, tx: cx - gx * ns, ty: cy - gy * ns };
    });
  }, []);

  const refreshFromBackend = () => {
    void loadGraph();
  };

  const toggleType = (t: EntityType) => {
    setVisibleTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) {
        if (next.size <= 1) return prev;
        next.delete(t);
      } else next.add(t);
      return next;
    });
  };

  const awaitingFirstLoad =
    loadState === "loading" && graphData.nodes.length === 0;
  const emptyFiltered =
    filteredGraph.nodes.length === 0 && graphData.nodes.length > 0;
  const emptyAbsolute =
    filteredGraph.nodes.length === 0 &&
    graphData.nodes.length === 0 &&
    loadState === "done";

  return (
    <div className="flex flex-col gap-4">
      {!usingFallback && loadState === "done" && graphData.nodes.length > 0 && (
        <p className="text-[12px] leading-relaxed text-[color:var(--label-secondary)]">
          节点与连线由当前后端环境动态生成（平台、已注册 Agent、知识库文档、定时任务、已配置
          LLM 等）。图谱以<strong className="font-semibold text-[color:var(--foreground)]">星空星座</strong>
          呈现：背景散点仿夜空恒星，亮星为实体；
          <strong className="font-semibold">名称一律标注</strong>；开启 PageRank
          时重要实体更近更大，「Uniform」模式下深度由节点 id 稳定哈希决定仍保留远近层次。
          连线为<strong className="font-semibold">按边稳定随机三次贝塞尔</strong>
          ，每条关系弧度与松紧不同，更接近真实关联链；可在空白处拖拽连线整体偏移塑形。节点可拖拽 · 空白平移 · 滚轮缩放。
        </p>
      )}
      {usingFallback && (
        <div className="rounded-xl border border-[color:color-mix(in_srgb,#f59e0b_42%,transparent)] bg-[color-mix(in_srgb,#f59e0b_14%,transparent)] px-3 py-2 text-[12px] text-[color:var(--foreground)]">
          无法连接后端
          {loadError ? `（${loadError}）` : ""}
          ，已改为展示本地演示图谱。可稍后点击刷新重试。
        </div>
      )}
      <div className="card-surface flex flex-col gap-3 rounded-2xl px-4 py-3 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--label-secondary)]"
            strokeWidth={2}
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search entities..."
            className="w-full rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] py-2 pl-10 pr-3 text-[13px] text-[color:var(--foreground)] outline-none placeholder:text-[color:var(--label-secondary)] focus:border-[color:var(--accent)] focus:bg-[var(--card-bg)] focus:ring-2 focus:ring-[color:color-mix(in_srgb,var(--accent)_35%,transparent)]"
          />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <select
            value={sizeMode}
            onChange={(e) =>
              setSizeMode(e.target.value as "pagerank" | "uniform")
            }
            className="rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] px-3 py-2 text-[12px] text-[color:var(--foreground)] outline-none focus:border-[color:var(--accent)] focus:ring-2 focus:ring-[color:color-mix(in_srgb,var(--accent)_35%,transparent)]"
          >
            <option value="pagerank">Size: PageRank</option>
            <option value="uniform">Size: Uniform</option>
          </select>
          <button
            type="button"
            title="Reload graph from backend"
            onClick={refreshFromBackend}
            disabled={loadState === "loading"}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] text-[color:var(--label-secondary)] hover:bg-[var(--nav-active-fill)] hover:text-[color:var(--foreground)] disabled:opacity-50"
          >
            <RefreshCw
              className={`h-4 w-4 ${loadState === "loading" ? "animate-spin" : ""}`}
              strokeWidth={2}
            />
          </button>
        </div>
      </div>

      <div
        ref={wrapRef}
        className="relative min-h-[520px] flex-1 overflow-hidden rounded-2xl border border-indigo-950/90 bg-[radial-gradient(ellipse_120%_80%_at_50%_18%,#1e1b4b_0%,#0c1222_42%,#020617_100%)] shadow-[inset_0_0_120px_rgba(15,23,42,0.85)]"
        style={{ minHeight: "min(72vh, 720px)", maxHeight: "min(72vh, 720px)" }}
      >
        {awaitingFirstLoad ? (
          <div className="flex h-[520px] items-center justify-center text-sm text-[color:var(--label-secondary)]">
            <span className="inline-flex items-center gap-2">
              <RefreshCw
                className="h-4 w-4 animate-spin text-[color:var(--accent)]"
                strokeWidth={2}
              />
              正在从后端加载图谱…
            </span>
          </div>
        ) : emptyFiltered ? (
          <div className="flex h-[520px] items-center justify-center text-sm text-[color:var(--label-secondary)]">
            请在图例中至少启用一类实体。
          </div>
        ) : emptyAbsolute ? (
          <div className="flex h-[520px] flex-col items-center justify-center gap-2 px-4 text-center text-sm text-[color:var(--label-secondary)]">
            <span>后端返回空图谱。</span>
            <button
              type="button"
              onClick={refreshFromBackend}
              className="text-[12px] font-semibold text-[color:var(--accent)] hover:underline"
            >
              重新加载
            </button>
          </div>
        ) : dims.w <= 80 ? (
          <div className="flex h-[520px] items-center justify-center text-sm text-[color:var(--label-secondary)]">
            正在计算布局…
          </div>
        ) : (
          <svg
            ref={svgRef}
            role="img"
            aria-label="Knowledge graph constellation view"
            width={dims.w}
            height={dims.h}
            className={`block touch-none bg-transparent ${draggingNodeId || draggingEdgeKey ? "cursor-grabbing" : "cursor-grab active:cursor-grabbing"}`}
            onPointerDown={(e) => {
              const svg = e.currentTarget as SVGSVGElement;
              // 更新触控点缓存
              pointerCacheRef.current.set(e.pointerId, {
                x: e.clientX,
                y: e.clientY,
              });
              const hit = (e.target as Element).closest("[data-graph-node]");
              if (hit) {
                const id = hit.getAttribute("data-node-id");
                if (!id) return;
                const pos = positionsRef.current.get(id);
                if (!pos) return;
                const { gx, gy } = clientToGraphCoords(
                  e.clientX,
                  e.clientY,
                  svg,
                  viewRef.current,
                );
                nodeDragRef.current = {
                  id,
                  pid: e.pointerId,
                  grabDx: gx - pos.x,
                  grabDy: gy - pos.y,
                  startX: e.clientX,
                  startY: e.clientY,
                  moved: false,
                };
                svg.setPointerCapture(e.pointerId);
                setDraggingNodeId(id);
                return;
              }
              const edgeHit = (e.target as Element).closest(
                "[data-graph-edge-hit]",
              );
              if (edgeHit) {
                const ek = edgeHit.getAttribute("data-edge-key");
                if (!ek) return;
                const { gx, gy } = clientToGraphCoords(
                  e.clientX,
                  e.clientY,
                  svg,
                  viewRef.current,
                );
                edgeDragRef.current = {
                  key: ek,
                  pid: e.pointerId,
                  lastGx: gx,
                  lastGy: gy,
                };
                svg.setPointerCapture(e.pointerId);
                setDraggingEdgeKey(ek);
                return;
              }
              // 双指捏合：已有第一根手指时，第二根触发 pinch
              const ptrs = [...pointerCacheRef.current.keys()];
              if (ptrs.length === 2) {
                const [id1, id2] = ptrs;
                const p1 = pointerCacheRef.current.get(id1)!;
                const p2 = pointerCacheRef.current.get(id2)!;
                const dx = p2.x - p1.x;
                const dy = p2.y - p1.y;
                const midX = (p1.x + p2.x) / 2;
                const midY = (p1.y + p2.y) / 2;
                pinchRef.current = {
                  id1,
                  id2,
                  midX,
                  midY,
                  startDist: Math.sqrt(dx * dx + dy * dy) || 1,
                  s0: viewRef.current.s,
                  tx0: viewRef.current.tx,
                  ty0: viewRef.current.ty,
                };
                // 取消正在进行的平移
                panRef.current.pid = null;
                svg.setPointerCapture(e.pointerId);
                return;
              }
              panRef.current = {
                pid: e.pointerId,
                sx: e.clientX,
                sy: e.clientY,
                tx0: viewRef.current.tx,
                ty0: viewRef.current.ty,
                s0: viewRef.current.s,
              };
              svg.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              // 更新触控点位置缓存
              if (pointerCacheRef.current.has(e.pointerId)) {
                pointerCacheRef.current.set(e.pointerId, {
                  x: e.clientX,
                  y: e.clientY,
                });
              }
              // 双指捏合缩放
              const pinch = pinchRef.current;
              if (
                pinch &&
                (pinch.id1 === e.pointerId || pinch.id2 === e.pointerId)
              ) {
                const p1 = pointerCacheRef.current.get(pinch.id1);
                const p2 = pointerCacheRef.current.get(pinch.id2);
                if (p1 && p2) {
                  const dx = p2.x - p1.x;
                  const dy = p2.y - p1.y;
                  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
                  const ratio = dist / pinch.startDist;
                  const ns = Math.min(Math.max(pinch.s0 * ratio, 0.02), 40);
                  const svg = e.currentTarget as SVGSVGElement;
                  const rect = svg.getBoundingClientRect();
                  const mx = pinch.midX - rect.left;
                  const my = pinch.midY - rect.top;
                  const gx = (mx - pinch.tx0) / pinch.s0;
                  const gy = (my - pinch.ty0) / pinch.s0;
                  setView({ s: ns, tx: mx - gx * ns, ty: my - gy * ns });
                }
                return;
              }
              const edg = edgeDragRef.current;
              if (edg.key && edg.pid === e.pointerId) {
                const svg = e.currentTarget as SVGSVGElement;
                const { gx, gy } = clientToGraphCoords(
                  e.clientX,
                  e.clientY,
                  svg,
                  viewRef.current,
                );
                const prev = edgeBendRef.current.get(edg.key) ?? {
                  dx: 0,
                  dy: 0,
                };
                edgeBendRef.current.set(edg.key, {
                  dx: prev.dx + (gx - edg.lastGx),
                  dy: prev.dy + (gy - edg.lastGy),
                });
                edg.lastGx = gx;
                edg.lastGy = gy;
                setEdgeDragTick((t) => t + 1);
                return;
              }
              const nd = nodeDragRef.current;
              if (nd.id && nd.pid === e.pointerId) {
                const svg = e.currentTarget as SVGSVGElement;
                const { gx, gy } = clientToGraphCoords(
                  e.clientX,
                  e.clientY,
                  svg,
                  viewRef.current,
                );
                const nx = gx - nd.grabDx;
                const ny = gy - nd.grabDy;
                positionsRef.current.set(nd.id, { x: nx, y: ny });
                if (
                  Math.abs(e.clientX - nd.startX) > 5 ||
                  Math.abs(e.clientY - nd.startY) > 5
                ) {
                  nd.moved = true;
                }
                setDragTick((t) => t + 1);
                return;
              }
              if (panRef.current.pid !== e.pointerId) return;
              const p = panRef.current;
              setView({
                s: p.s0,
                tx: p.tx0 + (e.clientX - p.sx),
                ty: p.ty0 + (e.clientY - p.sy),
              });
            }}
            onPointerUp={(e) => {
              const svg = e.currentTarget as SVGSVGElement;
              pointerCacheRef.current.delete(e.pointerId);
              // 释放 pinch
              if (
                pinchRef.current &&
                (pinchRef.current.id1 === e.pointerId ||
                  pinchRef.current.id2 === e.pointerId)
              ) {
                pinchRef.current = null;
                try {
                  svg.releasePointerCapture(e.pointerId);
                } catch {
                  /* noop */
                }
                return;
              }
              const edg = edgeDragRef.current;
              if (edg.key && edg.pid === e.pointerId) {
                edgeDragRef.current = {
                  key: null,
                  pid: null,
                  lastGx: 0,
                  lastGy: 0,
                };
                setDraggingEdgeKey(null);
                try {
                  svg.releasePointerCapture(e.pointerId);
                } catch {
                  /* noop */
                }
                return;
              }
              const nd = nodeDragRef.current;
              if (nd.id && nd.pid === e.pointerId) {
                nodeDragRef.current = {
                  id: null,
                  pid: null,
                  grabDx: 0,
                  grabDy: 0,
                  startX: 0,
                  startY: 0,
                  moved: false,
                };
                setDraggingNodeId(null);
                try {
                  svg.releasePointerCapture(e.pointerId);
                } catch {
                  /* noop */
                }
                if (!nd.moved && nd.id) {
                  const id = nd.id;
                  const now = Date.now();
                  const prev = lastTapRef.current;
                  if (prev && prev.id === id && now - prev.at < 380) {
                    lastTapRef.current = null;
                    const nb = neighborFilter(id, layoutGraph.links);
                    fitSubset(nb);
                  } else {
                    lastTapRef.current = { id, at: now };
                    setSelectedId((p) => (p === id ? null : id));
                  }
                }
                return;
              }
              // 释放 pinch
              if (
                pinchRef.current &&
                (pinchRef.current.id1 === e.pointerId ||
                  pinchRef.current.id2 === e.pointerId)
              ) {
                pinchRef.current = null;
              }
              pointerCacheRef.current.delete(e.pointerId);
              if (panRef.current.pid === e.pointerId) {
                panRef.current.pid = null;
                try {
                  svg.releasePointerCapture(e.pointerId);
                } catch {
                  /* noop */
                }
              }
            }}
            onPointerCancel={(e) => {
              const svg = e.currentTarget as SVGSVGElement;
              pinchRef.current = null;
              pointerCacheRef.current.delete(e.pointerId);
              edgeDragRef.current = {
                key: null,
                pid: null,
                lastGx: 0,
                lastGy: 0,
              };
              setDraggingEdgeKey(null);
              nodeDragRef.current = {
                id: null,
                pid: null,
                grabDx: 0,
                grabDy: 0,
                startX: 0,
                startY: 0,
                moved: false,
              };
              setDraggingNodeId(null);
              panRef.current.pid = null;
              try {
                svg.releasePointerCapture(e.pointerId);
              } catch {
                /* noop */
              }
            }}
          >
            <title>知识图谱 · 星空星座视图</title>
            <defs>
              <filter
                id="kg-star-glow"
                x="-80%"
                y="-80%"
                width="260%"
                height="260%"
              >
                <feGaussianBlur in="SourceGraphic" stdDeviation="1.1" result="b" />
                <feMerge>
                  <feMergeNode in="b" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <g pointerEvents="none">
              {bgStars.map((st, i) => (
                <circle
                  key={`sky-${i}`}
                  cx={st.x}
                  cy={st.y}
                  r={st.r}
                  fill="#f8fafc"
                  opacity={st.o}
                />
              ))}
            </g>
            <g transform={`translate(${view.tx},${view.ty}) scale(${view.s})`}>
              {constellationLinkOrder.map((l, i) => {
                const a = nodePos.get(l.source);
                const b = nodePos.get(l.target);
                if (!a || !b) return null;
                const sa = depthById.get(a.id) ?? 1;
                const sb = depthById.get(b.id) ?? 1;
                const trim = chordTrimmedEndpoints(
                  a.x,
                  a.y,
                  a.r * sa,
                  b.x,
                  b.y,
                  b.r * sb,
                );
                const ax = trim.ok ? trim.x1 : a.x;
                const ay = trim.ok ? trim.y1 : a.y;
                const bx = trim.ok ? trim.x2 : b.x;
                const by = trim.ok ? trim.y2 : b.y;
                const edgeKey = stableUndirectedEdgeKey(l.source, l.target);
                void edgeDragTick;
                const bend = edgeBendRef.current.get(edgeKey) ?? {
                  dx: 0,
                  dy: 0,
                };
                const seed = linkPathSeed(l.source, l.target, i);
                const dPath = synapsePathWithBend(
                  ax,
                  ay,
                  bx,
                  by,
                  seed,
                  bend.dx,
                  bend.dy,
                );
                const cA = colorForType(a.type);
                const cB = colorForType(b.type);
                const lineRgb = mixEdgeRgb(cA, cB, 0.55);
                const avgDepth = (sa + sb) / 2;
                const strokeW = 0.48 + 1.15 * avgDepth;
                const strokeOp = 0.18 + 0.42 * avgDepth;

                return (
                  <g key={edgeKey}>
                    <path
                      d={dPath}
                      fill="none"
                      stroke={lineRgb}
                      strokeWidth={strokeW}
                      strokeLinecap="round"
                      opacity={strokeOp}
                      style={{ pointerEvents: "none" }}
                    />
                    <path
                      data-graph-edge-hit
                      data-edge-key={edgeKey}
                      d={dPath}
                      fill="none"
                      stroke="transparent"
                      strokeWidth={16}
                      strokeLinecap="round"
                      style={{
                        cursor:
                          draggingEdgeKey === edgeKey ? "grabbing" : "grab",
                      }}
                    />
                  </g>
                );
              })}
              {constellationNodeOrder.map((n) => {
                const id = String(n.id);
                const base = colorForType(n.type);
                let fill = base;
                if (selectedId === id) fill = "#38bdf8";
                else if (!matchesQuery(n)) fill = "rgba(148,163,184,0.42)";
                else if (hoveredId === id) fill = "#7dd3fc";

                const ds = depthById.get(id) ?? 1;
                const label =
                  n.name.length > 40 ? `${n.name.slice(0, 38)}…` : n.name;

                const hot =
                  selectedId === id ||
                  hoveredId === id ||
                  draggingNodeId === id;

                return (
                  <g
                    key={id}
                    transform={`translate(${n.x},${n.y}) scale(${ds}) translate(${-n.x},${-n.y})`}
                  >
                    <circle
                      cx={n.x}
                      cy={n.y}
                      r={n.r + (hot ? 10 : 8)}
                      fill={base}
                      opacity={hot ? 0.28 : 0.14}
                      pointerEvents="none"
                    />
                    <circle
                      cx={n.x}
                      cy={n.y}
                      r={Math.max(1.8, n.r * 0.38)}
                      fill="#fffbeb"
                      opacity={0.95}
                      filter="url(#kg-star-glow)"
                      pointerEvents="none"
                    />
                    <circle
                      data-graph-node
                      data-node-id={id}
                      cx={n.x}
                      cy={n.y}
                      r={n.r}
                      fill={fill}
                      stroke={
                        selectedId === id
                          ? "#bae6fd"
                          : hoveredId === id
                            ? "#e0f2fe"
                            : "rgba(226,232,240,0.42)"
                      }
                      strokeWidth={
                        selectedId === id || hoveredId === id ? 2 : 1.15
                      }
                      className={`transition-[stroke-width] duration-150 ${draggingNodeId === id ? "cursor-grabbing" : "cursor-grab"}`}
                      onPointerEnter={() => setHoveredId(id)}
                      onPointerLeave={() =>
                        setHoveredId((h) => (h === id ? null : h))
                      }
                    >
                      <title>{n.name}</title>
                    </circle>
                    <text
                      x={n.x}
                      y={n.y + n.r + 12}
                      textAnchor="middle"
                      fontSize={11}
                      fill="rgba(248,250,252,0.96)"
                      stroke="rgba(2,6,23,0.88)"
                      strokeWidth={3.4}
                      paintOrder="stroke fill"
                      pointerEvents="none"
                      style={{
                        fontFamily: "ui-sans-serif, system-ui",
                      }}
                    >
                      {label}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
        )}

        <div className="popover-vibrant pointer-events-auto absolute top-4 left-4 z-10 max-h-[52vh] w-[220px] overflow-y-auto rounded-xl p-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--label-secondary)]">
            Entity types
          </p>
          <ul className="space-y-1">
            {ENTITY_LEGEND.map(({ type, label, color }) => {
              const on = visibleTypes.has(type);
              return (
                <li key={type}>
                  <button
                    type="button"
                    onClick={() => toggleType(type)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors ${on ? "bg-[var(--nav-active-fill)] text-[color:var(--foreground)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_28%,transparent)]" : "text-[color:var(--label-secondary)] opacity-80 hover:bg-[var(--nav-active-fill)] hover:opacity-100"}`}
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full ring-2 ring-[color:var(--separator-subtle)]"
                      style={{ backgroundColor: color }}
                    />
                    <span className="flex-1 truncate">{label}</span>
                    <span className="tabular-nums text-[color:var(--label-secondary)]">
                      {counts[type]}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            onClick={fitFull}
            className="mt-3 w-full rounded-lg border border-[color:color-mix(in_srgb,var(--accent)_40%,transparent)] bg-[var(--nav-active-fill)] py-2 text-[12px] font-semibold text-[color:var(--accent)] hover:bg-[color-mix(in_srgb,var(--accent)_14%,transparent)]"
          >
            Browse all
          </button>
        </div>

        <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 max-w-[95%] -translate-x-1/2 rounded-full border border-indigo-900/60 bg-slate-950/88 px-4 py-2 text-center text-[10px] text-slate-400 shadow-lg backdrop-blur-sm">
          星座视图 · 不规则种子 + 力导向松弛布局 · PageRank/均匀模式控制近大远小 · 有机贝塞尔关系链（可拖拽塑形）·
          拖拽节点 · 单击 / 双击邻居聚焦 · 空白平移 · 滚轮缩放
        </div>
      </div>
    </div>
  );
}
