import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NextRequest, NextResponse } from "next/server";
import { assertSafeGitBranch } from "@/lib/server/git-branch-safe";
import { resolveWorkspaceRoot } from "@/lib/server/workspace-git-root";

const execFileAsync = promisify(execFile);

export async function POST(req: NextRequest) {
  let body: { branch?: string; create?: boolean; root?: string };
  try {
    body = (await req.json()) as { branch?: string; create?: boolean; root?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const raw = String(body.branch || "").trim();
  if (!raw) {
    return NextResponse.json({ ok: false, error: "missing_branch" }, { status: 400 });
  }

  let name: string;
  try {
    name = assertSafeGitBranch(raw);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_branch" }, { status: 400 });
  }

  const cwd = resolveWorkspaceRoot(body.root);

  try {
    if (body.create) {
      await execFileAsync("git", ["checkout", "-b", name], { cwd });
    } else {
      await execFileAsync("git", ["checkout", name], { cwd });
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }

  return NextResponse.json({ ok: true, branch: name });
}
