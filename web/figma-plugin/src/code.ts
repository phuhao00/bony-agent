/// <reference types="@figma/plugin-typings" />

import type { PluginCommand, PluginResponse } from "./types";

interface CommandContext {
  commandId: string;
}

function sendResponse(ctx: CommandContext, response: Omit<PluginResponse, "id">) {
  const full: PluginResponse = { id: ctx.commandId, ...response };
  figma.ui.postMessage(full);
}

async function ensureFont() {
  await figma.loadFontAsync({ family: "Inter", style: "Regular" });
}

function nodeToJson(node: SceneNode | PageNode | DocumentNode) {
  return {
    id: node.id,
    name: node.name,
    type: node.type,
    x: "x" in node ? node.x : undefined,
    y: "y" in node ? node.y : undefined,
    width: "width" in node ? node.width : undefined,
    height: "height" in node ? node.height : undefined,
  };
}

const handlers: Record<string, (ctx: CommandContext, params: Record<string, unknown>) => Promise<void> | void> = {
  ping: (ctx) => sendResponse(ctx, { success: true, result: "pong" }),

  get_status: (ctx) =>
    sendResponse(ctx, {
      success: true,
      result: {
        connected: true,
        file_key: "private" in figma ? (figma as any).fileKey : undefined,
        current_page: figma.currentPage.name,
        selection_count: figma.currentPage.selection.length,
      },
    }),

  create_frame: async (ctx, params) => {
    const frame = figma.createFrame();
    frame.name = String(params.name || "Frame");
    frame.resize(Number(params.width) || 1440, Number(params.height) || 900);
    frame.x = Number(params.x) || 0;
    frame.y = Number(params.y) || 0;
    if (params.fills && Array.isArray(params.fills)) {
      frame.fills = params.fills as Paint[];
    }
    figma.currentPage.appendChild(frame);
    sendResponse(ctx, { success: true, result: nodeToJson(frame) });
  },

  create_rectangle: async (ctx, params) => {
    const rect = figma.createRectangle();
    rect.name = String(params.name || "Rectangle");
    rect.resize(Number(params.width) || 100, Number(params.height) || 100);
    rect.x = Number(params.x) || 0;
    rect.y = Number(params.y) || 0;
    if (params.fills && Array.isArray(params.fills)) {
      rect.fills = params.fills as Paint[];
    }
    if (params.cornerRadius !== undefined) {
      rect.topLeftRadius = Number(params.cornerRadius);
      rect.topRightRadius = Number(params.cornerRadius);
      rect.bottomLeftRadius = Number(params.cornerRadius);
      rect.bottomRightRadius = Number(params.cornerRadius);
    }
    if (params.parentId) {
      const parent = figma.getNodeById(String(params.parentId));
      if (parent && "appendChild" in parent) {
        (parent as FrameNode | GroupNode).appendChild(rect);
      } else {
        figma.currentPage.appendChild(rect);
      }
    } else {
      figma.currentPage.appendChild(rect);
    }
    sendResponse(ctx, { success: true, result: nodeToJson(rect) });
  },

  create_text: async (ctx, params) => {
    await ensureFont();
    const text = figma.createText();
    text.name = String(params.name || "Text");
    text.x = Number(params.x) || 0;
    text.y = Number(params.y) || 0;
    text.fontSize = Number(params.fontSize) || 24;
    text.characters = String(params.content || "");
    if (params.fills && Array.isArray(params.fills)) {
      text.fills = params.fills as Paint[];
    }
    if (params.fontWeight === "bold") {
      text.fontName = { family: "Inter", style: "Bold" };
    }
    if (params.parentId) {
      const parent = figma.getNodeById(String(params.parentId));
      if (parent && "appendChild" in parent) {
        (parent as FrameNode | GroupNode).appendChild(text);
      } else {
        figma.currentPage.appendChild(text);
      }
    } else {
      figma.currentPage.appendChild(text);
    }
    sendResponse(ctx, { success: true, result: nodeToJson(text) });
  },

  list_nodes: (ctx) => {
    const children = figma.currentPage.children.map((node) => ({
      id: node.id,
      name: node.name,
      type: node.type,
      x: "x" in node ? node.x : undefined,
      y: "y" in node ? node.y : undefined,
      width: "width" in node ? node.width : undefined,
      height: "height" in node ? node.height : undefined,
    }));
    sendResponse(ctx, { success: true, result: { page: figma.currentPage.name, count: children.length, nodes: children } });
  },

  delete_node: (ctx, params) => {
    const node = figma.getNodeById(String(params.nodeId));
    if (!node) {
      return sendResponse(ctx, { success: false, error: "Node not found" });
    }
    try {
      node.remove();
      sendResponse(ctx, { success: true, result: { deleted: true, id: params.nodeId } });
    } catch (err: any) {
      sendResponse(ctx, { success: false, error: String(err?.message || err) });
    }
  },

  clear_children: (ctx, params) => {
    const node = figma.getNodeById(String(params.nodeId));
    if (!node || !("children" in node)) {
      return sendResponse(ctx, { success: false, error: "Node not found or has no children" });
    }
    try {
      const container = node as FrameNode | GroupNode;
      while (container.children.length > 0) {
        container.children[0].remove();
      }
      sendResponse(ctx, { success: true, result: { cleared: true, id: node.id } });
    } catch (err: any) {
      sendResponse(ctx, { success: false, error: String(err?.message || err) });
    }
  },

  fill_image: async (ctx, params) => {
    const node = figma.getNodeById(String(params.nodeId));
    if (!node || !("fills" in node)) {
      return sendResponse(ctx, { success: false, error: "Node not found or cannot have image fill" });
    }
    const base64 = String(params.base64 || "");
    if (!base64) {
      return sendResponse(ctx, { success: false, error: "Missing base64 image data" });
    }
    try {
      const binaryString = atob(base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const image = figma.createImage(bytes);
      const scaleMode = (String(params.scaleMode) || "FILL") as "FILL" | "FIT" | "CROP" | "TILE";
      (node as GeometryMixin).fills = [
        { type: "IMAGE", scaleMode, imageHash: image.hash },
      ];
      sendResponse(ctx, { success: true, result: { nodeId: node.id, imageHash: image.hash, scaleMode } });
    } catch (err: any) {
      sendResponse(ctx, { success: false, error: String(err?.message || err) });
    }
  },

  apply_auto_layout: async (ctx, params) => {
    const node = figma.getNodeById(String(params.nodeId));
    if (!node || node.type !== "FRAME") {
      return sendResponse(ctx, { success: false, error: "Node not found or not a frame" });
    }
    const frame = node as FrameNode;
    frame.layoutMode = (String(params.direction) || "VERTICAL") as "VERTICAL" | "HORIZONTAL";
    frame.primaryAxisAlignItems = "MIN";
    frame.counterAxisAlignItems = "MIN";
    frame.itemSpacing = Number(params.itemSpacing) || 16;
    const padding = Number(params.padding) || 24;
    frame.paddingTop = padding;
    frame.paddingRight = padding;
    frame.paddingBottom = padding;
    frame.paddingLeft = padding;
    sendResponse(ctx, { success: true, result: nodeToJson(frame) });
  },

  export_node: async (ctx, params) => {
    const node = figma.getNodeById(String(params.nodeId));
    if (!node || !("exportAsync" in node)) {
      return sendResponse(ctx, { success: false, error: "Node not found or not exportable" });
    }
    const format = String(params.format || "PNG") as "PNG" | "SVG" | "JPG" | "PDF";
    const bytes = await (node as ExportMixin).exportAsync({ format, constraint: { type: "SCALE", value: Number(params.scale) || 1 } });
    const base64 = figma.base64Encode(bytes);
    sendResponse(ctx, { success: true, result: { base64, format } });
  },

  run_code: async (ctx, params) => {
    const code = String(params.code || "");
    try {
      const fn = new Function("figma", "return (async () => {\n" + code + "\n})();");
      const result = await fn(figma);
      sendResponse(ctx, { success: true, result });
    } catch (err: any) {
      sendResponse(ctx, { success: false, error: String(err?.message || err) });
    }
  },
};

function dispatchCommand(command: PluginCommand) {
  const ctx: CommandContext = { commandId: command.id };
  const handler = handlers[command.method];
  if (!handler) {
    return sendResponse(ctx, { success: false, error: `Unknown method: ${command.method}` });
  }
  Promise.resolve(handler(ctx, command.params || {})).catch((err) => {
    sendResponse(ctx, { success: false, error: String(err?.message || err) });
  });
}

figma.showUI(__html__, { width: 320, height: 360, themeColors: true });

figma.ui.onmessage = (msg) => {
  // UI sends raw command object via parent.postMessage({ pluginMessage: command }).
  // Figma unwraps pluginMessage, so msg here is the command/status payload itself.
  if (msg && typeof msg === "object") {
    if (typeof msg.method === "string") {
      dispatchCommand(msg as PluginCommand);
      return;
    }
    if (msg.type === "status") {
      const text = String(msg.text || "");
      if (text === "connected") {
        figma.notify("AI Media Agent bridge connected");
      }
    }
  }
};

figma.notify("AI Media Agent bridge ready");
