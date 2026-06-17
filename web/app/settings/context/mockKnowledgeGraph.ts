/** My context · 知识图谱：图例 / PageRank / 演示降级数据（首选后端 `/context/knowledge-graph`） */

export type EntityType =
  | "event"
  | "product"
  | "service"
  | "defined_term"
  | "creative_work"
  | "observation"
  | "action"
  | "organization"
  | "person"
  | "place";

export interface KGNodeData {
  id: string;
  name: string;
  type: EntityType;
  /** PageRank 基准（运行时再缩放） */
  rank: number;
}

export interface KGLinkData {
  source: string;
  target: string;
}

export const ENTITY_LEGEND: {
  type: EntityType;
  label: string;
  color: string;
}[] = [
  { type: "event", label: "Event", color: "#a78bfa" },
  { type: "product", label: "Product", color: "#c4b5fd" },
  { type: "service", label: "Service", color: "#60a5fa" },
  { type: "defined_term", label: "Defined Term", color: "#fbbf24" },
  { type: "creative_work", label: "Creative Work", color: "#2dd4bf" },
  { type: "observation", label: "Observation", color: "#f472b6" },
  { type: "action", label: "Action", color: "#f87171" },
  { type: "organization", label: "Organization", color: "#4ade80" },
  { type: "person", label: "Person", color: "#38bdf8" },
  { type: "place", label: "Place", color: "#818cf8" },
];

const COLOR_BY_TYPE = Object.fromEntries(
  ENTITY_LEGEND.map((e) => [e.type, e.color]),
) as Record<EntityType, string>;

const TARGET_COUNTS: Record<EntityType, number> = {
  event: 24,
  product: 17,
  service: 12,
  defined_term: 9,
  creative_work: 8,
  observation: 7,
  action: 7,
  organization: 5,
  person: 4,
  place: 4,
};

const HUBS: KGNodeData[] = [
  {
    id: "hub-ai-media-agent",
    name: "AI Media Agent",
    type: "product",
    rank: 1,
  },
  {
    id: "hub-multi-agent-registry",
    name: "Multi-Agent Registry (6 Agents)",
    type: "service",
    rank: 1,
  },
  {
    id: "hub-openrouter",
    name: "OpenRouter API",
    type: "service",
    rank: 1,
  },
  {
    id: "hub-xhs",
    name: "Xiaohongshu Platform",
    type: "service",
    rank: 1,
  },
  {
    id: "hub-fastapi",
    name: "FastAPI Backend",
    type: "service",
    rank: 1,
  },
  {
    id: "hub-langgraph",
    name: "LangGraph Planner",
    type: "creative_work",
    rank: 1,
  },
];

function rndPick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function buildSyntheticNodes(): KGNodeData[] {
  const nodes: KGNodeData[] = [...HUBS];
  const hubIds = HUBS.map((h) => h.id);

  (Object.keys(TARGET_COUNTS) as EntityType[]).forEach((type) => {
    const n = TARGET_COUNTS[type];
    for (let i = 0; i < n; i++) {
      const id = `${type}-${i}`;
      nodes.push({
        id,
        name:
          type === "event"
            ? `Publish Job #${4200 + i}`
            : type === "person"
              ? `User_${String.fromCharCode(65 + (i % 26))}`
              : `${ENTITY_LEGEND.find((e) => e.type === type)?.label ?? type} · ${i + 1}`,
        type,
        rank: 0.3 + Math.random() * 0.7,
      });
    }
  });

  nodes.forEach((node) => {
    if (hubIds.includes(node.id)) return;
    const seed =
      node.id.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0) %
      hubIds.length;
    node.rank = 0.2 + ((seed % 7) / 10 + Math.random() * 0.5);
  });

  return nodes;
}

function buildLinks(nodes: KGNodeData[]): KGLinkData[] {
  const links: KGLinkData[] = [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const hubIds = HUBS.map((h) => h.id);
  const nonHub = nodes.filter((n) => !hubIds.includes(n.id));

  nonHub.forEach((n) => {
    const hub =
      n.type === "service" || n.type === "product"
        ? rndPick(HUBS.filter((h) => h.type === "service" || h.type === "product"))
        : rndPick(HUBS);
    links.push({ source: n.id, target: hub.id });
    if (Math.random() < 0.28) {
      const h2 = rndPick(HUBS);
      if (h2.id !== hub.id) links.push({ source: n.id, target: h2.id });
    }
  });

  for (let i = 0; i < hubIds.length; i++) {
    for (let j = i + 1; j < hubIds.length; j++) {
      if (Math.random() < 0.55) {
        links.push({ source: hubIds[i]!, target: hubIds[j]! });
      }
    }
  }

  for (let k = 0; k < nodes.length * 1.2; k++) {
    const a = rndPick(nodes);
    const b = rndPick(nodes);
    if (a.id !== b.id && Math.random() < 0.06) {
      const key = `${a.id}->${b.id}`;
      const rev = `${b.id}->${a.id}`;
      if (
        !links.some(
          (l) => `${l.source}->${l.target}` === key || `${l.source}->${l.target}` === rev,
        )
      ) {
        links.push({ source: a.id, target: b.id });
      }
    }
  }

  const seen = new Set<string>();
  return links.filter((l) => {
    const k = `${l.source}->${l.target}`;
    if (seen.has(k)) return false;
    if (!byId.has(l.source as string) || !byId.has(l.target as string))
      return false;
    seen.add(k);
    return true;
  });
}

function neighborsUndirected(
  nodeIds: string[],
  links: KGLinkData[],
): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  nodeIds.forEach((id) => m.set(id, new Set()));
  links.forEach(({ source: s, target: t }) => {
    m.get(s)?.add(t);
    m.get(t)?.add(s);
  });
  return m;
}

/** 极简 PageRank（无向） */
export function computePageRank(
  nodeIds: string[],
  links: KGLinkData[],
  iterations = 22,
): Map<string, number> {
  const neigh = neighborsUndirected(nodeIds, links);
  const N = nodeIds.length || 1;
  let rank = new Map(nodeIds.map((id) => [id, 1 / N]));
  const d = 0.88;

  for (let it = 0; it < iterations; it++) {
    const next = new Map<string, number>();
    nodeIds.forEach((id) => next.set(id, 0));
    let dangling = 0;
    nodeIds.forEach((id) => {
      const outs = [...neigh.get(id)!];
      const deg = outs.length;
      const ri = rank.get(id)!;
      if (!deg) {
        dangling += ri;
        return;
      }
      const give = (d * ri) / deg;
      outs.forEach((j) => next.set(j, (next.get(j) ?? 0) + give));
    });
    const leak = ((1 - d) + (d * dangling)) / N;
    nodeIds.forEach((id) => next.set(id, (next.get(id) ?? 0) + leak));
    let sum = 0;
    next.forEach((v) => {
      sum += v;
    });
    next.forEach((v, id) => next.set(id, v / sum));
    rank = next;
  }
  return rank;
}

const SEED_NODES = buildSyntheticNodes();
const SEED_LINKS = buildLinks(SEED_NODES);
const SEED_RANK = computePageRank(
  SEED_NODES.map((n) => n.id),
  SEED_LINKS,
);

/** 导出静态图谱（刷新页面可重新随机布线） */
export const KNOWLEDGE_GRAPH_SEED = {
  nodes: SEED_NODES.map((n) => ({
    ...n,
    rank: SEED_RANK.get(n.id) ?? n.rank,
  })),
  links: SEED_LINKS,
};

export function legendCounts(nodes: KGNodeData[]): Record<EntityType, number> {
  const c = {} as Record<EntityType, number>;
  ENTITY_LEGEND.forEach(({ type }) => {
    c[type] = 0;
  });
  nodes.forEach((n) => {
    c[n.type] = (c[n.type] ?? 0) + 1;
  });
  return c;
}

export function colorForType(type: EntityType): string {
  return COLOR_BY_TYPE[type] ?? "#94a3b8";
}

const KNOWN_TYPES = new Set<EntityType>(ENTITY_LEGEND.map((e) => e.type));

/** 将后端或其它来源的 type 字符串规范为前端图例支持的 EntityType */
export function normalizeEntityType(raw: string): EntityType {
  const x = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_") as EntityType;
  if (KNOWN_TYPES.has(x)) return x;
  return "defined_term";
}
