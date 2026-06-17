import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NextRequest, NextResponse } from "next/server";
import { resolveWorkspaceRoot } from "@/lib/server/workspace-git-root";

const execFileAsync = promisify(execFile);

export async function GET(req: NextRequest) {
  const cwd = resolveWorkspaceRoot(req.nextUrl.searchParams.get("root"));
  const q = (req.nextUrl.searchParams.get("q") || "").trim().toLowerCase();

  try {
    const { stdout } = await execFileAsync(
      "git",
      [
        "for-each-ref",
        "--sort=-committerdate",
        "--format=%(refname:short)",
        "refs/heads/",
      ],
      { cwd },
    );
    let list = stdout
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);

    if (q) list = list.filter((b) => b.toLowerCase().includes(q));

    return NextResponse.json({ branches: list });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ branches: [], error: msg }, { status: 500 });
  }
}
