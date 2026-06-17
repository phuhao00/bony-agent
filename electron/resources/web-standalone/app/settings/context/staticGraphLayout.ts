import type { KGLinkData, KGNodeData } from "./mockKnowledgeGraph";

/** 与 Neo4j Browser 类似：先在固定「图空间」里布局，再通过视图的 pan/zoom 映射到屏幕（不随容器像素反复改节点坐标）。 */
export const NEO_GRAPH_WORLD = 880;

export type LaidOutNode = KGNodeData & {
  x: number;
  y: number;
  r: number;
};

function nodeRadius(n: KGNodeData, sizeMode: "pagerank" | "uniform"): number {
  if (sizeMode === "uniform") return 6;
  const v = Math.max(n.rank ?? 0.001, 0.0005);
  return Math.pow(v * 420, 0.42) + 3;
}

/** 轻微错位：打破完美同心圆带来的「示意图」感，更接近生物网状噪声。 */
function placementWobble(id: string, salt: number): { dx: number; dy: number } {
  let h = salt >>> 0;
  for (let i = 0; i < id.length; i++) {
    h = Math.imul(h ^ id.charCodeAt(i), 0x9e3779b1);
  }
  const u = (h >>> 0) / 4294967296;
  const v = (((h >>> 16) ^ h) >>> 0) / 4294967296;
  const ang = u * Math.PI * 2;
  const mag = 14 + v * 26;
  return {
    dx: Math.cos(ang) * mag,
    dy: Math.sin(ang * 1.37) * mag,
  };
}

/** 确定性 [0,1)，用于按节点 id 撒点，避免双环均分角。 */
function seeded01For(id: string, salt: number): number {
  let h = salt >>> 0;
  for (let i = 0; i < id.length; i++) {
    h = Math.imul(h ^ id.charCodeAt(i), 0x9e3779b1);
  }
  return (h >>> 0) / 4294967296;
}

function degreeMap(
  nodes: KGNodeData[],
  links: KGLinkData[],
): Map<string, number> {
  const d = new Map<string, number>();
  nodes.forEach((n) => d.set(n.id, 0));
  links.forEach((l) => {
    if (d.has(l.source)) d.set(l.source, (d.get(l.source) ?? 0) + 1);
    if (d.has(l.target)) d.set(l.target, (d.get(l.target) ?? 0) + 1);
  });
  return d;
}

/**
 * 有机布局：高度节点略靠近中心，但角位置/半径带哈希抖动；再经轻量力导向（斥力+边弹簧+弱向心）
 * 松弛，避免出现「双完美同心圆」的对称示意图感。
 */
export function layoutKnowledgeGraphStatic(
  nodesIn: KGNodeData[],
  linksIn: KGLinkData[],
  sizeMode: "pagerank" | "uniform",
  layoutSalt: number,
): LaidOutNode[] {
  const w = NEO_GRAPH_WORLD;
  const h = NEO_GRAPH_WORLD;
  const cx = w / 2;
  const cy = h / 2;

  if (nodesIn.length === 0) return [];

  if (nodesIn.length === 1) {
    const n = nodesIn[0]!;
    return [{ ...n, x: cx, y: cy, r: nodeRadius(n, sizeMode) }];
  }

  const deg = degreeMap(nodesIn, linksIn);
  const byHub = [...nodesIn].sort((a, b) => {
    const db = deg.get(b.id) ?? 0;
    const da = deg.get(a.id) ?? 0;
    if (db !== da) return db - da;
    return a.id.localeCompare(b.id);
  });

  const hubRank = new Map<string, number>();
  byHub.forEach((node, idx) => hubRank.set(node.id, idx));

  const nCount = nodesIn.length;
  const radii = nodesIn.map((node) => nodeRadius(node, sizeMode));

  const idToIdx = new Map<string, number>();
  nodesIn.forEach((node, i) => idToIdx.set(node.id, i));

  type Pt = { x: number; y: number };
  const pos: Pt[] = nodesIn.map((node) => {
    const rankIdx = hubRank.get(node.id) ?? 0;
    const hubFrac = nCount <= 1 ? 0 : rankIdx / Math.max(nCount - 1, 1);
    const u = seeded01For(node.id, layoutSalt + rankIdx * 7919);
    const v = seeded01For(node.id, layoutSalt * 2654435761 + rankIdx * 9737333);
    const theta =
      u * Math.PI * 2 +
      layoutSalt * 0.21 +
      v * 2.4 +
      Math.sin(rankIdx * 1.618 + layoutSalt) * 0.55;
    const radial =
      48 +
      hubFrac * hubFrac * 300 +
      (v - 0.5) * 125 +
      Math.sin(theta * 2.7 + rankIdx * 0.31) * 38;
    const wb = placementWobble(node.id, layoutSalt * 131 + rankIdx * 17);
    const oval = 1 + (seeded01For(node.id, layoutSalt + 404) - 0.5) * 0.14;
    return {
      x: cx + Math.cos(theta) * radial + wb.dx * 1.35,
      y:
        cy + Math.sin(theta * (1.05 + 0.07 * u)) * radial * oval + wb.dy * 1.35,
    };
  });

  const linkPairKeys = new Set<string>();
  const linkPairs: { i: number; j: number }[] = [];
  for (const link of linksIn) {
    const ia = idToIdx.get(link.source);
    const ib = idToIdx.get(link.target);
    if (ia === undefined || ib === undefined || ia === ib) continue;
    const lo = Math.min(ia, ib);
    const hi = Math.max(ia, ib);
    const key = `${lo}\0${hi}`;
    if (linkPairKeys.has(key)) continue;
    linkPairKeys.add(key);
    linkPairs.push({ i: lo, j: hi });
  }

  const iterations = Math.min(96, 38 + nCount * 3);
  for (let iter = 0; iter < iterations; iter++) {
    const fx = new Float64Array(nCount);
    const fy = new Float64Array(nCount);
    const damp = 0.52 + 0.46 * Math.exp(-iter / (iterations * 0.42));
    const kRep = (720 + nCount * 155) * (0.55 + 0.45 * (1 - iter / iterations));

    for (let i = 0; i < nCount; i++) {
      for (let j = i + 1; j < nCount; j++) {
        const dx = pos[j].x - pos[i].x;
        const dy = pos[j].y - pos[i].y;
        let distSq = dx * dx + dy * dy;
        if (distSq < 1e-8) distSq = 1e-8;
        const dist = Math.sqrt(distSq);
        const rij = radii[i] + radii[j] + 16;
        let rep = kRep / distSq;
        if (dist < rij) rep *= 2.15;
        const fmag = rep * damp * 0.019;
        const ux = dx / dist;
        const uy = dy / dist;
        fx[i] -= ux * fmag;
        fy[i] -= uy * fmag;
        fx[j] += ux * fmag;
        fy[j] += uy * fmag;
      }
    }

    const idealLen = 86 + Math.min(58, nCount * 1.05);
    const kSpring = 0.048 * damp;
    for (const { i, j } of linkPairs) {
      const dx = pos[j].x - pos[i].x;
      const dy = pos[j].y - pos[i].y;
      const dist = Math.hypot(dx, dy) || 1e-8;
      const displacement = dist - idealLen;
      const f = kSpring * displacement;
      const ux = dx / dist;
      const uy = dy / dist;
      fx[i] += ux * f;
      fy[i] += uy * f;
      fx[j] -= ux * f;
      fy[j] -= uy * f;
    }

    const kCenter = 0.0035 * damp;
    for (let i = 0; i < nCount; i++) {
      fx[i] -= kCenter * (pos[i].x - cx);
      fy[i] -= kCenter * (pos[i].y - cy);
    }

    for (let i = 0; i < nCount; i++) {
      pos[i].x += fx[i];
      pos[i].y += fy[i];
    }
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < nCount; i++) {
    const rr = radii[i];
    minX = Math.min(minX, pos[i].x - rr);
    maxX = Math.max(maxX, pos[i].x + rr);
    minY = Math.min(minY, pos[i].y - rr);
    maxY = Math.max(maxY, pos[i].y + rr);
  }
  const bw = Math.max(maxX - minX, 1);
  const bh = Math.max(maxY - minY, 1);
  const margin = 52;
  const scale = Math.min((w - 2 * margin) / bw, (h - 2 * margin) / bh, 1.38);
  const tcx = (minX + maxX) / 2;
  const tcy = (minY + maxY) / 2;

  return nodesIn.map((node, i) => ({
    ...node,
    x: cx + (pos[i].x - tcx) * scale,
    y: cy + (pos[i].y - tcy) * scale,
    r: radii[i],
  }));
}

/** 类 Neo4j Browser 的弯曲关系（二次贝塞尔），spreadIndex 用于多关系错开弧度。 */
export function neoRelationshipPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  spreadIndex: number,
): string {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const bend = 12 + (spreadIndex % 8) * 3.5;
  const ox = (-dy / len) * bend;
  const oy = (dx / len) * bend;
  const qx = mx + ox;
  const qy = my + oy;
  return `M ${x1} ${y1} Q ${qx} ${qy} ${x2} ${y2}`;
}

/** 稳定哈希：用于每条边的曲线种子（同源同索引则路径不变）。 */
export function linkPathSeed(
  source: string,
  target: string,
  index: number,
): number {
  let h = Math.imul(index + 1, 374761393);
  for (let i = 0; i < source.length; i++) {
    h = Math.imul(h ^ source.charCodeAt(i), 2654435761);
  }
  for (let i = 0; i < target.length; i++) {
    h = Math.imul(h ^ target.charCodeAt(i), 1597334677);
  }
  return h >>> 0;
}

/** 将线段两端缩进到节点圆周内，避免连线扎进圆心。 */
export function chordTrimmedEndpoints(
  x1: number,
  y1: number,
  r1: number,
  x2: number,
  y2: number,
  r2: number,
): { x1: number; y1: number; x2: number; y2: number; ok: boolean } {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return { x1, y1, x2, y2, ok: false };
  const ux = dx / len;
  const uy = dy / len;
  const need = r1 + r2 + 1;
  if (len <= need + 2) return { x1, y1, x2, y2, ok: false };
  return {
    x1: x1 + ux * Math.min(r1 + 0.5, len * 0.48),
    y1: y1 + uy * Math.min(r1 + 0.5, len * 0.48),
    x2: x2 - ux * Math.min(r2 + 0.5, len * 0.48),
    y2: y2 - uy * Math.min(r2 + 0.5, len * 0.48),
    ok: true,
  };
}

/** 三次贝塞尔控制点（不含用户拖拽偏移）。 */
export function synapseControlPoints(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  seed: number,
): { c1x: number; c1y: number; c2x: number; c2y: number } {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const ux = dx / len;
  const uy = dy / len;

  const u1 = ((seed * 1103515245 + 12345) >>> 0) / 4294967296;
  const u2 = ((seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const u3 = (((seed >>> 11) ^ seed) >>> 0) / 4294967296;
  const u4 = ((((seed * 2246822519) >>> 0) ^ (seed >>> 17)) >>> 0) / 4294967296;

  /** 随机凹凸向：打破全局同向弧线形成的旋涡对称感 */
  const chirality = (seed & 512) !== 0 ? 1 : -1;

  /** 弧垂与扭转幅度略放大，且两端控制点不对称，避免「批量生成的平行弧线」感 */
  const swayMag = len * (0.13 + u1 * 0.68);
  const twist = (u2 - 0.5) * len * (0.38 + u3 * 0.12);
  const t1 = 0.12 + u3 * 0.29;
  const t2 = Math.min(0.93, Math.max(t1 + 0.1, 0.42 + u4 * 0.46));

  const k1 = 0.68 + u2 * 0.62;
  const k2 = 0.2 + (1 - u2) * 0.66;
  const ox1 = nx * swayMag * k1 * chirality + ux * twist * chirality;
  const oy1 = ny * swayMag * k1 * chirality + uy * twist * chirality;
  const ox2 = nx * swayMag * k2 * chirality - ux * twist * 0.72 * chirality;
  const oy2 = ny * swayMag * k2 * chirality - uy * twist * 0.72 * chirality;

  const c1x = x1 + dx * t1 + ox1;
  const c1y = y1 + dy * t1 + oy1;
  const c2x = x1 + dx * t2 + ox2;
  const c2y = y1 + dy * t2 + oy2;

  return { c1x, c1y, c2x, c2y };
}

/** t∈[0,1] 上三次贝塞尔点（P0,C1,C2,P3）。 */
export function cubicPointAt(
  x1: number,
  y1: number,
  c1x: number,
  c1y: number,
  c2x: number,
  c2y: number,
  x2: number,
  y2: number,
  t: number,
): { x: number; y: number } {
  const u = 1 - t;
  const uu = u * u;
  const tt = t * t;
  const x = u * u * u * x1 + 3 * uu * t * c1x + 3 * u * tt * c2x + tt * t * x2;
  const y = u * u * u * y1 + 3 * uu * t * c1y + 3 * u * tt * c2y + tt * t * y2;
  return { x, y };
}

/**
 * 突触式有机连线：三次贝塞尔 + 确定性摆动；`bendDx/bendDy` 同时推两个控制点，便于拖拽塑性。
 */
export function synapsePathWithBend(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  seed: number,
  bendDx: number,
  bendDy: number,
): string {
  const { c1x, c1y, c2x, c2y } = synapseControlPoints(x1, y1, x2, y2, seed);
  return `M ${x1} ${y1} C ${c1x + bendDx} ${c1y + bendDy} ${c2x + bendDx} ${c2y + bendDy} ${x2} ${y2}`;
}

/** 零偏移时的突触路径（等同 synapsePathWithBend(..., 0, 0)）。 */
export function synapsePath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  seed: number,
): string {
  return synapsePathWithBend(x1, y1, x2, y2, seed, 0, 0);
}

export function bboxOfNodes(nodes: LaidOutNode[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} | null {
  if (!nodes.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x - n.r);
    maxX = Math.max(maxX, n.x + n.r);
    minY = Math.min(minY, n.y - n.r);
    maxY = Math.max(maxY, n.y + n.r);
  }
  return { minX, minY, maxX, maxY };
}

export function fitViewTransform(
  nodes: LaidOutNode[],
  viewW: number,
  viewH: number,
  pad: number,
): { s: number; tx: number; ty: number } {
  if (!nodes.length) return { s: 1, tx: viewW / 2, ty: viewH / 2 };
  const bb = bboxOfNodes(nodes);
  if (!bb) return { s: 1, tx: viewW / 2, ty: viewH / 2 };
  const gw = Math.max(bb.maxX - bb.minX, 1e-6);
  const gh = Math.max(bb.maxY - bb.minY, 1e-6);
  const innerW = Math.max(viewW - 2 * pad, 40);
  const innerH = Math.max(viewH - 2 * pad, 40);
  const s = Math.min(innerW / gw, innerH / gh);
  const bcx = (bb.minX + bb.maxX) / 2;
  const bcy = (bb.minY + bb.maxY) / 2;
  return { s, tx: viewW / 2 - bcx * s, ty: viewH / 2 - bcy * s };
}
