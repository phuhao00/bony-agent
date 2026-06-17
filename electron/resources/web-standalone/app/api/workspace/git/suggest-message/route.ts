import { NextRequest, NextResponse } from "next/server";
import { fetchBackend } from "@/lib/server/backend-proxy";
import {
  collectGitDiffContext,
  heuristicCommitMessage,
} from "@/lib/server/git-diff";
import { resolveWorkspaceRoot } from "@/lib/server/workspace-git-root";

export async function POST(req: NextRequest) {
  let body: { root?: string; hint?: string };
  try {
    body = (await req.json()) as { root?: string; hint?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const cwd = resolveWorkspaceRoot(body.root);

  try {
    const ctx = await collectGitDiffContext(cwd);
    if (!ctx.committableFiles.length) {
      return NextResponse.json({
        ok: false,
        error: ctx.blockedFiles.length ? "only_blocked_files" : "nothing_to_commit",
        blocked: ctx.blockedFiles,
      }, { status: 400 });
    }

    let message = "";
    let source = "heuristic";

    try {
      const llmRes = await fetchBackend("/tools/git/commit-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branch: ctx.branch,
          changed_files: ctx.committableFiles,
          stat: ctx.stat,
          diff: ctx.diff,
          hint: body.hint || "",
        }),
      });
      if (llmRes.ok) {
        const data = (await llmRes.json()) as { message?: string; source?: string };
        if (data.message?.trim()) {
          message = data.message.trim();
          source = data.source || "llm";
        }
      }
    } catch {
      /* fallback below */
    }

    if (!message) {
      message = heuristicCommitMessage(ctx, body.hint);
      source = "heuristic";
    }

    return NextResponse.json({
      ok: true,
      message,
      source,
      branch: ctx.branch,
      fileCount: ctx.committableFiles.length,
      files: ctx.committableFiles.slice(0, 20),
      blocked: ctx.blockedFiles,
      stat: ctx.stat,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("not a git")) {
      return NextResponse.json({ ok: false, error: "not_a_git_repository" }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
