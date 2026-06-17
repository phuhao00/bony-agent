import type { RefObject } from "react";
import type { ImageEditCanvasHandle, MaskTool } from "@/components/ImageEditCanvas";

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
}

const BRUSH_MIN = 8;
const BRUSH_MAX = 80;

export interface MaskShortcutHandlers {
  setTool: (tool: MaskTool) => void;
  setBrushSize: (size: number | ((prev: number) => number)) => void;
}

export function handleMaskShortcutKey(
  e: KeyboardEvent,
  canvasRef: RefObject<ImageEditCanvasHandle | null>,
  handlers: MaskShortcutHandlers,
): boolean {
  if (isTypingTarget(e.target)) return false;

  const mod = e.metaKey || e.ctrlKey;
  const key = e.key.toLowerCase();

  if (mod && key === "z" && !e.shiftKey) {
    e.preventDefault();
    canvasRef.current?.undoMask();
    return true;
  }

  if (mod && ((key === "z" && e.shiftKey) || key === "y")) {
    e.preventDefault();
    canvasRef.current?.redoMask();
    return true;
  }

  if (key === "delete" || key === "backspace") {
    if (!mod && !e.altKey) {
      e.preventDefault();
      canvasRef.current?.clearMask();
      return true;
    }
  }

  if (!mod && !e.altKey && key.length === 1) {
    const toolMap: Record<string, MaskTool> = {
      b: "brush",
      r: "rectangle",
      l: "lasso",
      e: "eraser",
    };
    const nextTool = toolMap[key];
    if (nextTool) {
      e.preventDefault();
      handlers.setTool(nextTool);
      return true;
    }
  }

  if (key === "[") {
    e.preventDefault();
    handlers.setBrushSize((s) => Math.max(BRUSH_MIN, s - 4));
    return true;
  }

  if (key === "]") {
    e.preventDefault();
    handlers.setBrushSize((s) => Math.min(BRUSH_MAX, s + 4));
    return true;
  }

  return false;
}

/** Modifier label for shortcut hints (Mac vs others). */
export function shortcutModLabel(): string {
  if (typeof navigator === "undefined") return "Ctrl+";
  if (/Mac|iPhone|iPad/i.test(navigator.userAgent)) return "⌘";
  return "Ctrl+";
}
