import type { WatermarkMethod } from "@/components/ImageEditWatermarkPanel";

/** Short literal text suitable as OCR watermark target (not a full instruction). */
export function looksLikeWatermarkTarget(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 24) return false;
  if (/[，。！？；：,.!?;:]/.test(t)) return false;
  if ((t.match(/\s/g) || []).length > 3) return false;
  return true;
}

export interface ResolvedWatermarkSubmit {
  mode: WatermarkMethod;
  watermarkText: string;
  prompt: string;
  includeAliases: boolean;
}

/** Map UI state to API payload — auto + short supplement → local text mode. */
export function resolveWatermarkSubmit(
  method: WatermarkMethod,
  targetText: string,
  supplement: string,
  includeAliases: boolean,
): ResolvedWatermarkSubmit {
  const target = targetText.trim();
  const extra = supplement.trim();

  if (method === "text") {
    const text = target || (looksLikeWatermarkTarget(extra) ? extra : "");
    const prompt =
      extra && extra !== text ? extra : "";
    return { mode: "text", watermarkText: text, prompt, includeAliases };
  }

  if (method === "area") {
    return { mode: "area", watermarkText: target, prompt: extra, includeAliases: false };
  }

  // auto: explicit target field wins; else treat short supplement as target text
  const candidate = target || (looksLikeWatermarkTarget(extra) ? extra : "");
  if (candidate) {
    return {
      mode: "text",
      watermarkText: candidate,
      prompt: extra && extra !== candidate ? extra : "",
      includeAliases,
    };
  }

  return { mode: "auto", watermarkText: "", prompt: extra, includeAliases: false };
}
