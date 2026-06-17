import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { getWorkspaceGitRoot } from "@/lib/server/workspace-git-root";

const execFileAsync = promisify(execFile);

const REPO_PATH_SPLIT = /[\n,;]+/;

/** 从文本解析多个仓库路径（换行、逗号、分号分隔，兼容旧输入）。 */
export function parseRepoPathsInput(input?: string | null): string[] {
  if (!input?.trim()) return [];
  const parts = input
    .split(REPO_PATH_SPLIT)
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set(parts)];
}

/** 解析 Git 仓库路径；空值时使用工作区根目录。 */
export function resolveGitRepoPath(requested?: string | null): string {
  if (!requested?.trim()) {
    return getWorkspaceGitRoot();
  }
  return path.resolve(requested.trim());
}

/** 解析多个仓库路径；空输入时返回工作区根目录。 */
export function resolveGitRepoPaths(
  requested?: string | string[] | null,
): string[] {
  const root = getWorkspaceGitRoot();
  let raw: string[] = [];
  if (Array.isArray(requested)) {
    raw = requested.flatMap((item) => parseRepoPathsInput(item));
  } else if (requested?.trim()) {
    raw = parseRepoPathsInput(requested);
  }
  if (raw.length === 0) return [root];
  const resolved: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const p = resolveGitRepoPath(item);
    if (!seen.has(p)) {
      seen.add(p);
      resolved.push(p);
    }
  }
  return resolved;
}

export function repoDisplayName(repoPath: string): string {
  const parts = repoPath.replace(/\/+$/, "").split(/[/\\]/);
  return parts[parts.length - 1] || repoPath;
}

export async function assertGitRepository(cwd: string): Promise<void> {
  if (!fs.existsSync(cwd)) {
    throw new Error("repo_path_not_found");
  }
  try {
    await execFileAsync("git", ["rev-parse", "--git-dir"], { cwd });
  } catch {
    throw new Error("repo_path_not_git");
  }
}

export function gitRepoErrorMessage(code: string): string {
  switch (code) {
    case "repo_path_not_found":
      return "仓库路径不存在，请检查是否填写正确";
    case "repo_path_not_git":
      return "该路径不是有效的 Git 仓库";
    case "author_required":
      return "请填写提交者";
    default:
      return code;
  }
}
