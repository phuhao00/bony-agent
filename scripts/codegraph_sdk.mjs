#!/usr/bin/env node
/**
 * CodeGraph SDK bridge — uses vendored vendor/codegraph or Electron bundle.
 *
 *   node scripts/codegraph_sdk.mjs search <projectRoot> <query> [limit]
 *   node scripts/codegraph_sdk.mjs graph <projectRoot> <json-payload>
 *
 * Resolution: CODEGRAPH_HOME → vendor/codegraph → electron/resources/codegraph
 */

import { pathToFileURL, fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { existsSync } from "node:fs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function resolveCodeGraphHome() {
  const candidates = [
    process.env.CODEGRAPH_HOME,
    resolve(REPO_ROOT, "vendor/codegraph"),
    resolve(REPO_ROOT, "electron/resources/codegraph"),
    resolve(REPO_ROOT, "codegraph"),
  ].filter(Boolean);
  for (const home of candidates) {
    if (existsSync(resolve(home, "dist/index.js"))) return home;
  }
  return candidates[0] || resolve(REPO_ROOT, "vendor/codegraph");
}

const CODEGRAPH_HOME = resolveCodeGraphHome();

async function loadCodeGraph() {
  const indexPath = resolve(CODEGRAPH_HOME, "dist/index.js");
  if (!existsSync(indexPath)) {
    throw new Error(
      `CodeGraph SDK not built at ${indexPath}. Run: cd ${CODEGRAPH_HOME} && npm run build`,
    );
  }
  const mod = await import(pathToFileURL(indexPath).href);
  const CodeGraph = mod.default?.default ?? mod.default ?? mod.CodeGraph;
  if (!CodeGraph?.openSync) {
    throw new Error(`Could not load CodeGraph from ${indexPath}`);
  }
  return CodeGraph;
}

function nodeToUi(n, { isCenter = false } = {}) {
  return {
    id: n.id,
    kind: n.kind,
    label: n.name,
    name: n.name,
    qualifiedName: n.qualifiedName,
    filePath: n.filePath,
    line: n.startLine,
    isCenter,
  };
}

function subgraphToUi(subgraph, { centerIds = new Set(), edgeKind = null } = {}) {
  const nodes = [];
  for (const [id, n] of subgraph.nodes) {
    nodes.push(nodeToUi(n, { isCenter: centerIds.has(id) }));
  }
  const links = [];
  const seen = new Set();
  for (const e of subgraph.edges) {
    if (edgeKind && e.kind !== edgeKind) continue;
    if (e.source === e.target) continue;
    const key = `${e.source}\0${e.target}\0${e.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ source: e.source, target: e.target, relation: e.kind });
  }
  nodes.sort((a, b) => {
    if (a.isCenter !== b.isCenter) return a.isCenter ? -1 : 1;
    return String(a.label).localeCompare(String(b.label));
  });
  return { nodes, links };
}

function pickBestMatch(matches, symbol) {
  if (!matches?.length) return null;
  const exact = matches.find(
    (m) =>
      m.node.name === symbol ||
      m.node.qualifiedName === symbol ||
      m.node.name.endsWith(`.${symbol}`) ||
      m.node.name.endsWith(`::${symbol}`),
  );
  return exact ?? matches[0];
}

function scopePattern(scope) {
  const prefix = (scope || "backend/services").replace(/^\/+/, "").replace(/\/+$/, "");
  return `${prefix}/**`;
}

async function cmdSearch(projectRoot, query, limit = 16) {
  const CodeGraph = await loadCodeGraph();
  const cg = CodeGraph.openSync(projectRoot);
  try {
    const results = cg.searchNodes(query, { limit: Math.min(limit, 32) });
    const out = results.map((r) => ({
      ...nodeToUi(r.node),
      score: r.score,
    }));
    process.stdout.write(JSON.stringify(out));
  } finally {
    cg.destroy?.();
    cg.close?.();
  }
}

async function cmdGraph(projectRoot, payload) {
  const {
    symbol = "",
    scope = "backend/services",
    hops = 1,
    max_nodes: maxNodes = 64,
    edge_kinds: edgeKinds = ["calls"],
  } = payload;

  const edgeKind = edgeKinds[0] || "calls";
  const depth = Math.max(0, Math.min(Number(hops) || 1, 3));
  const limit = Math.max(8, Math.min(Number(maxNodes) || 64, 120));

  const CodeGraph = await loadCodeGraph();
  const cg = CodeGraph.openSync(projectRoot);

  try {
    let subgraph;
    let center = symbol?.trim() || scope;
    const centerIds = new Set();

    if (symbol?.trim()) {
      const matches = cg.searchNodes(symbol.trim(), { limit: 20 });
      const best = pickBestMatch(matches, symbol.trim());
      if (!best) {
        process.stdout.write(
          JSON.stringify({
            nodes: [],
            links: [],
            center,
            error: "no_matching_symbols",
          }),
        );
        return;
      }
      centerIds.add(best.node.id);
      center = best.node.name;

      if (edgeKind === "calls") {
        subgraph = cg.getCallGraph(best.node.id, Math.max(depth, 1));
      } else {
        subgraph = cg.traverse(best.node.id, {
          maxDepth: depth,
          edgeKinds: [edgeKind],
          limit,
          direction: "both",
          includeStart: true,
        });
      }
    } else {
      const pattern = scopePattern(scope);
      const seeds = cg
        .searchNodes(scope.split("/").pop() || "service", {
          limit: limit * 2,
          kinds: ["function", "method", "class"],
          includePatterns: [pattern],
        })
        .slice(0, Math.min(8, limit));

      if (!seeds.length) {
        process.stdout.write(
          JSON.stringify({
            nodes: [],
            links: [],
            center,
            error: "no_matching_symbols",
          }),
        );
        return;
      }

      const mergedNodes = new Map();
      const mergedEdges = [];
      const edgeSeen = new Set();

      for (const seed of seeds) {
        centerIds.add(seed.node.id);
        const sub =
          edgeKind === "calls"
            ? cg.getCallGraph(seed.node.id, 1)
            : cg.traverse(seed.node.id, {
                maxDepth: 1,
                edgeKinds: [edgeKind],
                limit: Math.ceil(limit / seeds.length),
                direction: "both",
                includeStart: true,
              });
        for (const [id, n] of sub.nodes) {
          if (mergedNodes.size < limit) mergedNodes.set(id, n);
        }
        for (const e of sub.edges) {
          const key = `${e.source}->${e.target}:${e.kind}`;
          if (!edgeSeen.has(key)) {
            edgeSeen.add(key);
            mergedEdges.push(e);
          }
        }
      }

      subgraph = { nodes: mergedNodes, edges: mergedEdges, roots: [...centerIds] };
    }

    const { nodes, links } = subgraphToUi(subgraph, { centerIds, edgeKind });
    const prunedNodes = nodes.slice(0, limit);
    const nodeIds = new Set(prunedNodes.map((n) => n.id));
    const prunedLinks = links.filter(
      (l) => nodeIds.has(l.source) && nodeIds.has(l.target),
    );

    process.stdout.write(
      JSON.stringify({
        nodes: prunedNodes,
        links: prunedLinks,
        center,
        edgeKinds: edgeKinds,
        hops: depth,
        nodeCount: prunedNodes.length,
        edgeCount: prunedLinks.length,
        sdk: "native",
      }),
    );
  } finally {
    cg.destroy?.();
    cg.close?.();
  }
}

async function main() {
  const [, , cmd, projectRoot, ...rest] = process.argv;
  if (!cmd || !projectRoot) {
    console.error(
      "usage: codegraph_sdk.mjs search <root> <query> [limit]\n" +
        "       codegraph_sdk.mjs graph <root> '<json>'",
    );
    process.exit(1);
  }

  try {
    if (cmd === "search") {
      const [query, limitStr] = rest;
      await cmdSearch(projectRoot, query || "", Number(limitStr) || 16);
      return;
    }
    if (cmd === "graph") {
      const payload = JSON.parse(rest[0] || "{}");
      await cmdGraph(projectRoot, payload);
      return;
    }
    throw new Error(`unknown command: ${cmd}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(message + "\n");
    process.exit(1);
  }
}

main();
