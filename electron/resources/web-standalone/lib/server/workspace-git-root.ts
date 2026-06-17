import path from "node:path";

/**
 * 运行 `git` 时的工作副本根目录。
 * 默认可通过 WORKSPACE_GIT_ROOT 覆盖；否则在从 `web/` 启动时为仓库上一级。
 */
export function getWorkspaceGitRoot(): string {
  const env = process.env.WORKSPACE_GIT_ROOT?.trim();
  if (env) return path.resolve(env);
  const cwd = process.cwd();
  if (path.basename(cwd) === "web") return path.resolve(cwd, "..");
  return cwd;
}

/** 请求级覆盖：选中项目的真实路径优先于环境默认。 */
export function resolveWorkspaceRoot(override?: string | null): string {
  const raw = override?.trim();
  if (raw) return path.resolve(raw);
  return getWorkspaceGitRoot();
}
