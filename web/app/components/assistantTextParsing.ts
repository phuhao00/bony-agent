/** Lightweight parsers for agent result panels — no API changes. */

export type RiskLevel = "high" | "medium" | "low" | "unknown";

export function inferRiskLevel(text: string): RiskLevel {
  const t = text.toLowerCase();
  if (/高风险|严重风险|high risk|critical/.test(t)) return "high";
  if (/中风险|中等风险|medium risk|moderate/.test(t)) return "medium";
  if (/低风险|low risk|可控/.test(t)) return "low";
  return "unknown";
}

export function extractHexColors(text: string, limit = 8): string[] {
  const matches = text.match(/#(?:[0-9a-fA-F]{3}){1,2}\b/g) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of matches) {
    const norm = m.length === 4
      ? `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}`
      : m.toLowerCase();
    if (!seen.has(norm)) {
      seen.add(norm);
      out.push(norm);
      if (out.length >= limit) break;
    }
  }
  return out;
}

/** Split markdown-ish report into variant blocks for carousel display. */
export function extractCreativeVariants(text: string, limit = 6): string[] {
  const sections = text.split(/\n(?=#{1,3}\s)/);
  const variants: string[] = [];
  for (const block of sections) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    if (/创意|文案|变体|方案|标题|copy|creative/i.test(trimmed.slice(0, 80))) {
      variants.push(trimmed);
    }
  }
  if (variants.length === 0) {
    const lines = text.split("\n").filter((l) => /^(\d+[\.\)、]|[-*])\s+/.test(l.trim()));
    for (const line of lines.slice(0, limit)) {
      variants.push(line.trim());
    }
  }
  return variants.slice(0, limit);
}

export function extractReportFromResult(
  task: { result?: { report?: string }; status?: string; message?: string } | null,
  lastResult: unknown,
): string {
  const fromTask = task?.result?.report;
  if (typeof fromTask === "string" && fromTask.trim()) return fromTask;
  const fromLast = (lastResult as { result?: { report?: string } })?.result?.report;
  return typeof fromLast === "string" ? fromLast : "";
}
