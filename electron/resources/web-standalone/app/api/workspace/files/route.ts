import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { resolveWorkspaceRoot } from "@/lib/server/workspace-git-root";

const IGNORE_NAMES = new Set([
  "node_modules",
  ".git",
  ".next",
  "venv",
  ".venv",
  "dist",
  "build",
  "target",
  "__pycache__",
]);

const MAX_ENTRIES = 400;

function safeResolveUnderRoot(rootResolved: string, sub: string): string | null {
  const trimmed = sub.replace(/^[/\\]+|[/\\]+$/g, "").replace(/\0/g, "");
  const candidate = path.resolve(rootResolved, trimmed);
  const rel = path.relative(rootResolved, candidate);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return candidate;
}

export async function GET(req: NextRequest) {
  const rootParam = req.nextUrl.searchParams.get("root");
  const root = path.resolve(resolveWorkspaceRoot(rootParam));
  const raw = req.nextUrl.searchParams.get("path") ?? "";
  const dir = safeResolveUnderRoot(root, raw);
  if (!dir) {
    return NextResponse.json({ error: "invalid_path" }, { status: 400 });
  }

  try {
    const st = await fs.stat(dir);
    if (!st.isDirectory()) {
      return NextResponse.json({ error: "not_a_directory" }, { status: 400 });
    }
    const dirents = await fs.readdir(dir, { withFileTypes: true });
    const mapped = dirents
      .filter((e) => !e.name.startsWith(".") && !IGNORE_NAMES.has(e.name))
      .map((e) => {
        const rel = path.relative(root, path.join(dir, e.name)).replace(/\\/g, "/");
        return {
          name: e.name,
          kind: e.isDirectory() ? ("dir" as const) : ("file" as const),
          relPath: rel || e.name,
        };
      })
      .sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .slice(0, MAX_ENTRIES);

    return NextResponse.json({
      rootAbs: root,
      rootLabel: path.basename(root),
      path: path.relative(root, dir).replace(/\\/g, "/") || "",
      entries: mapped,
      truncated: dirents.filter(
        (e) => !e.name.startsWith(".") && !IGNORE_NAMES.has(e.name),
      ).length > MAX_ENTRIES,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
