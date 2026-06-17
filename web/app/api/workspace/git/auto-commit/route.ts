import { NextRequest, NextResponse } from "next/server";
import { fetchBackend } from "@/lib/server/backend-proxy";
import {
  collectGitDiffContext,
  heuristicCommitMessage,
} from "@/lib/server/git-diff";
import { assertSafeCommitMessage } from "@/lib/server/git-safe";
import { resolveWorkspaceRoot } from "@/lib/server/workspace-git-root";

async function suggestMessage(
  cwd: string,
  hint: string,
  ctx: Awaited<ReturnType<typeof collectGitDiffContext>>,
): Promise<{ message: string; source: string }> {
  try {
    const llmRes = await fetchBackend("/tools/git/commit-message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        branch: ctx.branch,
        changed_files: ctx.committableFiles,
        stat: ctx.stat,
        diff: ctx.diff,
        hint,
      }),
    });
    if (llmRes.ok) {
      const data = (await llmRes.json()) as { message?: string; source?: string };
      if (data.message?.trim()) {
        return { message: data.message.trim(), source: data.source || "llm" };
      }
    }
  } catch {
    /* heuristic */
  }
  return { message: heuristicCommitMessage(ctx, hint), source: "heuristic" };
}

export async function POST(req: NextRequest) {
  let body: { root?: string; hint?: string; push?: boolean; message?: string };
  try {
    body = (await req.json()) as {
      root?: string;
      hint?: string;
      push?: boolean;
      message?: string;
    };
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const cwd = resolveWorkspaceRoot(body.root);
  const origin = req.nextUrl.origin;

  try {
    const ctx = await collectGitDiffContext(cwd);
    if (!ctx.committableFiles.length) {
      return NextResponse.json({
        ok: false,
        error: ctx.blockedFiles.length ? "only_blocked_files" : "nothing_to_commit",
        blocked: ctx.blockedFiles,
      }, { status: 400 });
    }

    let message = body.message?.trim() || "";
    let source = "user";

    if (!message) {
      const suggested = await suggestMessage(cwd, body.hint || "", ctx);
      message = suggested.message;
      source = suggested.source;
    }

    try {
      message = assertSafeCommitMessage(message);
    } catch {
      return NextResponse.json({ ok: false, error: "invalid_message" }, { status: 400 });
    }

    const commitRes = await fetch(`${origin}/api/workspace/git/commit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ root: cwd, message }),
    });
    const commitData = (await commitRes.json()) as {
      ok?: boolean;
      error?: string;
      commit?: string;
      branch?: string;
      stagedCount?: number;
      blocked?: string[];
    };
    if (!commitRes.ok || !commitData.ok) {
      return NextResponse.json(
        { ok: false, error: commitData.error || "commit_failed", message, source },
        { status: 400 },
      );
    }

    let pushData: Record<string, unknown> | null = null;
    if (body.push) {
      const pushRes = await fetch(`${origin}/api/workspace/git/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ root: cwd }),
      });
      pushData = (await pushRes.json()) as Record<string, unknown>;
      if (!pushRes.ok || !pushData.ok) {
        return NextResponse.json({
          ok: false,
          error: pushData.error || "push_failed",
          message,
          source,
          commit: commitData.commit,
          branch: commitData.branch,
          analysis: {
            fileCount: ctx.committableFiles.length,
            files: ctx.committableFiles.slice(0, 15),
            stat: ctx.stat,
          },
        }, { status: 400 });
      }
    }

    return NextResponse.json({
      ok: true,
      message,
      source,
      commit: commitData.commit,
      branch: commitData.branch,
      stagedCount: commitData.stagedCount,
      blocked: commitData.blocked,
      pushed: !!body.push,
      push: pushData,
      analysis: {
        fileCount: ctx.committableFiles.length,
        files: ctx.committableFiles.slice(0, 15),
        stat: ctx.stat,
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
