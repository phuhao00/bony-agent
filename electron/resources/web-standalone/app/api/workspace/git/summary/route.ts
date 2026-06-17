import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { resolveWorkspaceRoot } from "@/lib/server/workspace-git-root";

const execFileAsync = promisify(execFile);

export async function GET(req: NextRequest) {
  const rootParam = req.nextUrl.searchParams.get("root");
  const cwd = resolveWorkspaceRoot(rootParam);
  try {
    await execFileAsync("git", ["rev-parse", "--git-dir"], { cwd });
  } catch {
    return NextResponse.json({
      gitAvailable: false,
      rootPath: cwd,
      projectLabel: path.basename(cwd),
      branch: null,
      dirtyCount: 0,
      error: "not_a_git_repository",
    });
  }

  try {
    const { stdout: br } = await execFileAsync(
      "git",
      ["rev-parse", "--abbrev-ref", "HEAD"],
      { cwd },
    );
    const branch = br.trim() || "(detached)";
    const { stdout: st } = await execFileAsync(
      "git",
      ["status", "--porcelain"],
      { cwd },
    );
    const dirtyCount = st.trim()
      ? st.trim().split("\n").filter(Boolean).length
      : 0;
    const { stdout: sha } = await execFileAsync(
      "git",
      ["rev-parse", "--short", "HEAD"],
      { cwd },
    );

    return NextResponse.json({
      gitAvailable: true,
      rootPath: cwd,
      projectLabel: path.basename(cwd),
      branch,
      dirtyCount,
      headShort: sha.trim(),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { gitAvailable: false, rootPath: cwd, error: msg },
      { status: 500 },
    );
  }
}
