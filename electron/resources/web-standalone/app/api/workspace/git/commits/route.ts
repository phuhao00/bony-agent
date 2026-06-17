import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NextRequest, NextResponse } from "next/server";

import {
  assertGitRepository,
  gitRepoErrorMessage,
  resolveGitRepoPaths,
} from "@/lib/server/workspace-git-path";

const execFileAsync = promisify(execFile);

const FIELD_SEP = "\x1f";
const RECORD_SEP = "\x1e";
const DEFAULT_MAX = 500;
const HARD_MAX = 2000;

export type GitCommitRecord = {
  hash: string;
  shortHash: string;
  authorName: string;
  authorEmail: string;
  date: string;
  subject: string;
  repoPath?: string;
};

function parseSinceUntil(searchParams: URLSearchParams): {
  since?: string;
  until?: string;
} {
  const since = searchParams.get("since")?.trim() || undefined;
  const until = searchParams.get("until")?.trim() || undefined;
  return { since, until };
}

function parseMaxCount(raw: string | null): number {
  const n = parseInt(raw || String(DEFAULT_MAX), 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX;
  return Math.min(n, HARD_MAX);
}

function parseRepoPathsFromQuery(searchParams: URLSearchParams): string[] {
  const multi = searchParams.getAll("repoPath").filter((p) => p.trim());
  if (multi.length > 0) return resolveGitRepoPaths(multi);
  const joined = searchParams.get("repoPaths");
  if (joined?.trim()) return resolveGitRepoPaths(joined);
  return resolveGitRepoPaths(null);
}

async function fetchCommitsFromRepo(
  repoPath: string,
  author: string,
  since: string | undefined,
  until: string | undefined,
  maxCount: number,
): Promise<GitCommitRecord[]> {
  const authorPattern = author.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const args = [
    "log",
    `--author=${authorPattern}`,
    `--max-count=${maxCount}`,
    "--no-merges",
    `--pretty=format:%H${FIELD_SEP}%h${FIELD_SEP}%an${FIELD_SEP}%ae${FIELD_SEP}%aI${FIELD_SEP}%s${RECORD_SEP}`,
  ];
  if (since) args.push(`--since=${since}`);
  if (until) args.push(`--until=${until}`);

  const { stdout } = await execFileAsync("git", args, {
    cwd: repoPath,
    maxBuffer: 1024 * 1024 * 8,
  });
  return parseGitLogStdout(stdout, repoPath);
}

function parseGitLogStdout(stdout: string, repoPath: string): GitCommitRecord[] {
  return stdout
    .split(RECORD_SEP)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [hash, shortHash, authorName, authorEmail, date, subject] =
        line.split(FIELD_SEP);
      return {
        hash: hash || "",
        shortHash: shortHash || "",
        authorName: authorName || "",
        authorEmail: authorEmail || "",
        date: date || "",
        subject: subject || "",
        repoPath,
      };
    });
}

/** When --author regex returns nothing, fall back to name/email case-insensitive match. */
async function fetchCommitsWithAuthorFallback(
  repoPath: string,
  author: string,
  since: string | undefined,
  until: string | undefined,
  maxCount: number,
): Promise<GitCommitRecord[]> {
  const direct = await fetchCommitsFromRepo(
    repoPath,
    author,
    since,
    until,
    maxCount,
  );
  if (direct.length > 0) return direct;

  const needle = author.trim().toLowerCase();
  if (!needle) return direct;

  const args = [
    "log",
    `--max-count=${Math.min(maxCount * 3, HARD_MAX)}`,
    "--no-merges",
    `--pretty=format:%H${FIELD_SEP}%h${FIELD_SEP}%an${FIELD_SEP}%ae${FIELD_SEP}%aI${FIELD_SEP}%s${RECORD_SEP}`,
  ];
  if (since) args.push(`--since=${since}`);
  if (until) args.push(`--until=${until}`);

  const { stdout } = await execFileAsync("git", args, {
    cwd: repoPath,
    maxBuffer: 1024 * 1024 * 8,
  });
  return parseGitLogStdout(stdout, repoPath)
    .filter((c) => {
      const name = c.authorName.toLowerCase();
      const email = c.authorEmail.toLowerCase();
      return name.includes(needle) || email.includes(needle);
    })
    .slice(0, maxCount);
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const author = searchParams.get("author")?.trim();
  if (!author) {
    return NextResponse.json({ error: "author_required" }, { status: 400 });
  }

  let repoPaths: string[];
  try {
    repoPaths = parseRepoPathsFromQuery(searchParams);
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

  const { since, until } = parseSinceUntil(searchParams);
  const maxCount = parseMaxCount(searchParams.get("maxCount"));
  const perRepoMax = Math.min(
    HARD_MAX,
    Math.max(50, Math.ceil(maxCount / repoPaths.length)),
  );

  try {
    const seenHash = new Set<string>();
    const merged: GitCommitRecord[] = [];
    for (const repoPath of repoPaths) {
      const batch = await fetchCommitsWithAuthorFallback(
        repoPath,
        author,
        since,
        until,
        perRepoMax,
      );
      for (const commit of batch) {
        if (seenHash.has(commit.hash)) continue;
        seenHash.add(commit.hash);
        merged.push(commit);
      }
    }
    merged.sort((a, b) => b.date.localeCompare(a.date));
    const commits = merged.slice(0, maxCount);

    return NextResponse.json({
      repoPath: repoPaths[0],
      repoPaths,
      author,
      since: since ?? null,
      until: until ?? null,
      total: commits.length,
      commits,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
