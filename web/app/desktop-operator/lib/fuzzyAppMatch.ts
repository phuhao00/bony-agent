import type { DesktopApp } from "../hooks/useDesktopOperatorRunner";

function subsequenceMatch(hay: string, needle: string): boolean {
  let i = 0;
  for (const ch of needle) {
    i = hay.indexOf(ch, i);
    if (i === -1) return false;
    i += 1;
  }
  return true;
}

export function scoreAppMatch(query: string, app: DesktopApp): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  const name = (app.name || "").toLowerCase();
  const id = (app.id || "").toLowerCase();
  const path = (app.executable_path || "").toLowerCase();
  const hay = `${name} ${id} ${path}`;

  if (q === name || q === id) return 100;
  if (name.startsWith(q) || id.startsWith(q)) return 90;
  if (name.includes(q) || id.includes(q)) return 80;

  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length > 1 && tokens.every((token) => hay.includes(token))) {
    return 70;
  }

  if (subsequenceMatch(name, q) || subsequenceMatch(id, q)) return 55;
  if (hay.includes(q)) return 40;
  return 0;
}

export function filterAppsFuzzy(apps: DesktopApp[], query: string, limit = 80): DesktopApp[] {
  const q = query.trim();
  if (!q) return apps.slice(0, limit);
  return apps
    .map((app) => ({ app, score: scoreAppMatch(q, app) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.app.name.localeCompare(b.app.name))
    .slice(0, limit)
    .map((item) => item.app);
}
