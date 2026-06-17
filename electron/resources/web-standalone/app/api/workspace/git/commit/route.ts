import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NextRequest, NextResponse } from "next/server";
import {
  assertSafeCommitMessage,
  filterCommittablePaths,
  isBlockedGitPath,
} from "@/lib/server/git-safe";
import { gitStatusChangedPaths } from "@/lib/server/git-status-parse";
import { resolveWorkspaceRoot } from "@/lib/server/workspace-git-root";

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]) {
  const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: 4 * 1024 * 1024 });
  return stdout;
}

export async function POST(req: NextRequest) {
  let body: { root?: string; message?: string; paths?: string[] };
  try {
    body = (await req.json()) as { root?: string; message?: string; paths?: string[] };
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  let message: string;
  try {
    message = assertSafeCommitMessage(String(body.message || ""));
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_message" }, { status: 400 });
  }

  const cwd = resolveWorkspaceRoot(body.root);

  try {
    await git(cwd, ["rev-parse", "--git-dir"]);
  } catch {
    return NextResponse.json({ ok: false, error: "not_a_git_repository" }, { status: 400 });
  }

  try {
    const changed = await gitStatusChangedPaths(execFileAsync, cwd);

    const requested = Array.isArray(body.paths)
      ? body.paths.map((p) => String(p).trim()).filter(Boolean)
      : changed;

    const blocked = requested.filter((p) => isBlockedGitPath(p));
    const toStage = filterCommittablePaths(
      requested.length ? requested : changed,
    );

    if (!toStage.length) {
      return NextResponse.json({
        ok: false,
        error: blocked.length ? "only_blocked_files" : "nothing_to_commit",
        blocked,
      }, { status: 400 });
    }

    await execFileAsync("git", ["add", "--", ...toStage], {
      cwd,
      maxBuffer: 4 * 1024 * 1024,
    });

    const commitOut = await git(cwd, ["commit", "-m", message]);
    const { stdout: sha } = await execFileAsync(
      "git",
      ["rev-parse", "--short", "HEAD"],
      { cwd },
    );
    const { stdout: br } = await execFileAsync(
      "git",
      ["rev-parse", "--abbrev-ref", "HEAD"],
      { cwd },
    );

    return NextResponse.json({
      ok: true,
      commit: sha.trim(),
      branch: br.trim(),
      stagedCount: toStage.length,
      blocked,
      summary: commitOut.trim().split("\n")[0] || "committed",
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/nothing to commit|no changes added/i.test(msg)) {
      return NextResponse.json({ ok: false, error: "nothing_to_commit" }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
