import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NextRequest, NextResponse } from "next/server";

import {
  assertGitRepository,
  gitRepoErrorMessage,
  resolveGitRepoPaths,
} from "@/lib/server/workspace-git-path";

const execFileAsync = promisify(execFile);

function parseRepoPathsFromQuery(searchParams: URLSearchParams): string[] {
  const multi = searchParams.getAll("repoPath").filter((p) => p.trim());
  if (multi.length > 0) return resolveGitRepoPaths(multi);
  const joined = searchParams.get("repoPaths");
  if (joined?.trim()) return resolveGitRepoPaths(joined);
  return resolveGitRepoPaths(null);
}

export async function GET(req: NextRequest) {
  let repoPaths: string[];
  try {
    repoPaths = parseRepoPathsFromQuery(req.nextUrl.searchParams);
    for (const p of repoPaths) {
      await assertGitRepository(p);
    }
  } catch (e: unknown) {
    const code = e instanceof Error ? e.message : "invalid_repo";
    return NextResponse.json(
      { error: gitRepoErrorMessage(code) },
      { status: 400 },
    );
  }

  try {
    const seen = new Set<string>();
    const authors: { name: string; email: string; label: string }[] = [];
    for (const repoPath of repoPaths) {
      const { stdout } = await execFileAsync(
        "git",
        ["log", "--format=%an <%ae>", "--no-merges"],
        { cwd: repoPath, maxBuffer: 1024 * 1024 * 4 },
      );
      for (const line of stdout.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || seen.has(trimmed)) continue;
        seen.add(trimmed);
        const m = trimmed.match(/^(.+?)\s*<([^>]+)>$/);
        if (m) {
          authors.push({
            name: m[1].trim(),
            email: m[2].trim(),
            label: trimmed,
          });
        }
      }
    }
    authors.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));

    return NextResponse.json({
      repoPath: repoPaths[0],
      repoPaths,
      authors,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
