/** Git 操作安全校验：分支名、提交信息、敏感文件过滤 */

export function assertSafeCommitMessage(message: string): string {
  const t = message.trim();
  if (!t || t.length > 500) throw new Error("invalid_message");
  if (t.startsWith("-")) throw new Error("invalid_message");
  return t;
}

export function assertSafeRemoteName(name: string): string {
  const t = name.trim();
  if (!t || t.length > 100) throw new Error("invalid_remote");
  if (!/^[a-zA-Z0-9._-]+$/.test(t)) throw new Error("invalid_remote");
  return t;
}

const BLOCKED_PATH_RE =
  /(?:^|\/)\.env(?:\.|$)|\.(?:key|pem|p12|cer)$|credentials\.json$|developer_id_private\.key$/i;

export function isBlockedGitPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/").trim();
  if (!normalized) return true;
  return BLOCKED_PATH_RE.test(normalized);
}

export function filterCommittablePaths(paths: string[]): string[] {
  return paths.filter((p) => !isBlockedGitPath(p));
}
