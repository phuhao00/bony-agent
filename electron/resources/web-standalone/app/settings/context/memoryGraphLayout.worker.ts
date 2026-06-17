/// <reference lib="webworker" />

import {
  computeGraphLayout,
  type LayoutLinkInput,
  type LayoutNodeInput,
} from "./memoryGraphLayout";

export type WorkerLayoutRequest = {
  nodes: LayoutNodeInput[];
  links: LayoutLinkInput[];
};

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (event: MessageEvent<WorkerLayoutRequest>) => {
  const { nodes, links } = event.data;
  const result = computeGraphLayout(nodes, links);
  ctx.postMessage(result);
};

export {};
