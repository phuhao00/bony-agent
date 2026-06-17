/** 记忆网图力导向布局（可在 Web Worker 中运行） */

export const VIEWPORT_W = 1100;
export const VIEWPORT_H = 600;

export interface LayoutNodeInput {
  id: string;
  label: string;
  type: string;
  size?: number;
  score?: number;
}

export interface LayoutLinkInput {
  source: string;
  target: string;
  weight?: number;
}

export interface LayoutNodeOutput extends LayoutNodeInput {
  x: number;
  y: number;
}

export interface LayoutResult {
  nodes: LayoutNodeOutput[];
  edges: Array<[number, number]>;
}

export function layoutParams(nodeCount: number): {
  iterations: number;
  maxEdgesPerNode: number;
  useCircular: boolean;
} {
  if (nodeCount > 150) {
    return { iterations: 0, maxEdgesPerNode: 2, useCircular: true };
  }
  if (nodeCount > 80) {
    return { iterations: 80, maxEdgesPerNode: 2, useCircular: false };
  }
  return { iterations: 260, maxEdgesPerNode: 3, useCircular: false };
}

function circularLayout(nodes: LayoutNodeInput[]): LayoutNodeOutput[] {
  const cx = VIEWPORT_W / 2;
  const cy = VIEWPORT_H / 2;
  return nodes.map((n, i) => {
    const angle = (i / Math.max(nodes.length, 1)) * Math.PI * 2;
    const r = 180 + (i % 9) * 14;
    return { ...n, x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r };
  });
}

function relaxLayout(
  nodes: Array<LayoutNodeInput & { x: number; y: number; vx: number; vy: number }>,
  edges: Array<[number, number]>,
  iterations: number,
): void {
  const n = nodes.length;
  const REPULSION = Math.max(3500, n * 80);
  const SPRING_K = 0.018;
  const SPRING_LEN = Math.max(90, 200 - n);
  const CENTER_K = 0.001;
  const FRICTION = 0.82;
  const cx = VIEWPORT_W / 2;
  const cy = VIEWPORT_H / 2;

  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const force = REPULSION / (dist * dist);
        dx = (dx / dist) * force;
        dy = (dy / dist) * force;
        a.vx -= dx;
        a.vy -= dy;
        b.vx += dx;
        b.vy += dy;
      }
    }
    for (const [ai, bi] of edges) {
      const a = nodes[ai];
      const b = nodes[bi];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const force = SPRING_K * (dist - SPRING_LEN);
      dx = (dx / dist) * force;
      dy = (dy / dist) * force;
      a.vx += dx;
      a.vy += dy;
      b.vx -= dx;
      b.vy -= dy;
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

export function computeGraphLayout(
  nodes: LayoutNodeInput[],
  links: LayoutLinkInput[],
): LayoutResult {
  if (nodes.length === 0) {
    return { nodes: [], edges: [] };
  }

  const params = layoutParams(nodes.length);
  if (params.useCircular) {
    return { nodes: circularLayout(nodes), edges: [] };
  }

  const idIndex = new Map<string, number>();
  nodes.forEach((n, i) => idIndex.set(n.id, i));

  const simNodes = nodes.map((n, i) => {
    const angle = (i / nodes.length) * Math.PI * 2;
    const r = 200 + (i % 7) * 12;
    return {
      ...n,
      x: VIEWPORT_W / 2 + Math.cos(angle) * r,
      y: VIEWPORT_H / 2 + Math.sin(angle) * r,
      vx: 0,
      vy: 0,
    };
  });

  const nodeEdgeCount = new Array<number>(nodes.length).fill(0);
  const sortedLinks = [...links].sort((a, b) => (b.weight ?? 1) - (a.weight ?? 1));
  const edgeIndices: Array<[number, number]> = [];

  for (const e of sortedLinks) {
    const a = idIndex.get(e.source);
    const b = idIndex.get(e.target);
    if (a == null || b == null) continue;
    if (
      nodeEdgeCount[a] < params.maxEdgesPerNode &&
      nodeEdgeCount[b] < params.maxEdgesPerNode
    ) {
      edgeIndices.push([a, b]);
      nodeEdgeCount[a]++;
      nodeEdgeCount[b]++;
    }
  }

  relaxLayout(simNodes, edgeIndices, params.iterations);
  return {
    nodes: simNodes.map(({ vx: _vx, vy: _vy, ...rest }) => rest),
    edges: edgeIndices,
  };
}
