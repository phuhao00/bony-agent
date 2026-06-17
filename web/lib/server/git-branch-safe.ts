/** 防止路径穿越与奇怪参数；仅允许常见分支名字符 */
export function assertSafeGitBranch(name: string): string {
  const t = name.trim();
  if (!t || t.length > 200) throw new Error("invalid_branch");
  if (t.includes("..") || t.startsWith("-") || /\s/.test(t))
    throw new Error("invalid_branch");
  if (!/^[a-zA-Z0-9/._-]+$/.test(t)) throw new Error("invalid_branch");
  return t;
}
