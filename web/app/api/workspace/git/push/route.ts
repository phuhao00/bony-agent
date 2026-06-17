import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NextRequest, NextResponse } from "next/server";
import { assertSafeRemoteName } from "@/lib/server/git-safe";
import { assertSafeGitBranch } from "@/lib/server/git-branch-safe";
import { resolveWorkspaceRoot } from "@/lib/server/workspace-git-root";

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]) {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout;
}

export async function POST(req: NextRequest) {
  let body: { root?: string; remote?: string; branch?: string };
  try {
    body = (await req.json()) as { root?: string; remote?: string; branch?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const cwd = resolveWorkspaceRoot(body.root);

  let remote = "origin";
  try {
    if (body.remote?.trim()) remote = assertSafeRemoteName(body.remote);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_remote" }, { status: 400 });
  }

  try {
    await git(cwd, ["rev-parse", "--git-dir"]);
  } catch {
    return NextResponse.json({ ok: false, error: "not_a_git_repository" }, { status: 400 });
  }

  try {
    let branch = body.branch?.trim() || "";
    if (branch) {
      branch = assertSafeGitBranch(branch);
    } else {
      branch = (await git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
    }

    let hasUpstream = true;
    try {
      await git(cwd, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
    } catch {
      hasUpstream = false;
    }

    const pushArgs = hasUpstream
      ? ["push", remote, branch]
      : ["push", "-u", remote, branch];

    const out = await git(cwd, pushArgs);

    return NextResponse.json({
      ok: true,
      remote,
      branch,
      output: out.trim(),
      setUpstream: !hasUpstream,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
