import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { filterCommittablePaths, isBlockedGitPath } from "@/lib/server/git-safe";
import { listChangedPathsFromPorcelainZ } from "@/lib/server/git-status-parse";

const execFileAsync = promisify(execFile);

export type GitDiffContext = {
  branch: string;
  changedFiles: string[];
  committableFiles: string[];
  blockedFiles: string[];
  stat: string;
  diff: string;
};

export async function collectGitDiffContext(cwd: string): Promise<GitDiffContext> {
  await execFileAsync("git", ["rev-parse", "--git-dir"], { cwd });

  const { stdout: br } = await execFileAsync(
    "git",
    ["rev-parse", "--abbrev-ref", "HEAD"],
    { cwd },
  );
  const { stdout: statusOut } = await execFileAsync(
    "git",
    ["status", "--porcelain=v1", "-z"],
    { cwd, maxBuffer: 8 * 1024 * 1024, encoding: "utf8" },
  );
  const changedFiles = listChangedPathsFromPorcelainZ(statusOut);

  const committableFiles = filterCommittablePaths(changedFiles);
  const blockedFiles = changedFiles.filter((p) => isBlockedGitPath(p));

  let stat = "";
  let diff = "";
  if (committableFiles.length) {
    const untracked = new Set<string>();
    for (const token of statusOut.split("\0").filter(Boolean)) {
      if (token.startsWith("?? ")) {
        const p = token.slice(3);
        if (p && committableFiles.includes(p)) untracked.add(p);
      }
    }

    try {
      const { stdout: st } = await execFileAsync(
        "git",
        ["diff", "--stat", "HEAD", "--", ...committableFiles.slice(0, 80)],
        { cwd, maxBuffer: 2 * 1024 * 1024 },
      );
      stat = st.trim();
    } catch {
      stat = "";
    }
    if (untracked.size) {
      const lines = [...untracked].slice(0, 30).map((p) => ` ${p} | new file`);
      stat = [stat, ...lines, untracked.size > 30 ? ` … +${untracked.size - 30} new` : ""]
        .filter(Boolean)
        .join("\n");
    }

    try {
      const { stdout: cached } = await execFileAsync(
        "git",
        ["diff", "--cached", "--", ...committableFiles.slice(0, 40)],
        { cwd, maxBuffer: 4 * 1024 * 1024 },
      );
      const { stdout: unstaged } = await execFileAsync(
        "git",
        ["diff", "--", ...committableFiles.slice(0, 40)],
        { cwd, maxBuffer: 4 * 1024 * 1024 },
      );
      diff = [cached.trim(), unstaged.trim()].filter(Boolean).join("\n").slice(0, 12000);
    } catch {
      diff = "";
    }
    if (untracked.size && diff.length < 8000) {
      const newList = [...untracked].slice(0, 20).map((p) => `new file: ${p}`).join("\n");
      diff = [diff, newList].filter(Boolean).join("\n").slice(0, 12000);
    }
  }

  return {
    branch: br.trim(),
    changedFiles,
    committableFiles,
    blockedFiles,
    stat,
    diff,
  };
}

/** 无 LLM 时的规则化提交说明 */
export function heuristicCommitMessage(ctx: GitDiffContext, hint?: string): string {
  const hintText = hint?.trim();
  if (hintText && /^(feat|fix|chore|docs|refactor|test)(\([^)]+\))?:\s/.test(hintText)) {
    return hintText.slice(0, 500);
  }

  const files = ctx.committableFiles;
  if (!files.length) return "chore: sync workspace";

  const prefixes = new Set<string>();
  for (const f of files) {
    const top = f.split("/")[0] || f;
    prefixes.add(top);
  }
  const scope =
    prefixes.size === 1
      ? prefixes.values().next().value
      : [...prefixes].slice(0, 2).join("+");

  const hasFix = files.some((f) => /fix|bug|error/i.test(f)) || /fix|bug/i.test(ctx.diff);
  const hasFeat = files.some((f) =>
    /claude-code|feat|add|new/i.test(f),
  );
  const verb = hasFix ? "fix" : hasFeat ? "feat" : "chore";

  const names = files
    .slice(0, 3)
    .map((f) => f.split("/").pop() || f)
    .join(", ");
  const more = files.length > 3 ? ` (+${files.length - 3})` : "";

  const suffix = hintText ? ` — ${hintText}` : "";
  return `${verb}(${scope}): update ${names}${more}${suffix}`.slice(0, 500);
}
