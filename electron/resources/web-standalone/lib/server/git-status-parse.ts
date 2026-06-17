/** 解析 git status --porcelain 输出中的文件路径 */

const STATUS_PREFIX_RE = /^[ MADRCU?!]{2} /;

/** 去掉 porcelain 非 -z 模式下路径外的引号，并处理 rename `old -> new` */
export function normalizeGitStatusPath(segment: string): string {
  let p = segment.trim();
  const arrow = p.indexOf(" -> ");
  if (arrow !== -1) p = p.slice(arrow + 4).trim();
  if (p.startsWith('"') && p.endsWith('"') && p.length >= 2) {
    p = p.slice(1, -1).replace(/\\(.)/g, (_, c: string) => {
      if (c === "n") return "\n";
      if (c === "t") return "\t";
      if (c === "r") return "\r";
      return c;
    });
  }
  return p;
}

/** `git status --porcelain=v1 -z`：路径不再带引号，rename 为 `R  old\\0new\\0` */
export function listChangedPathsFromPorcelainZ(output: string): string[] {
  const tokens = output.split("\0").filter(Boolean);
  const paths: string[] = [];

  for (let i = 0; i < tokens.length; ) {
    const rec = tokens[i];
    if (rec.length < 3) {
      i += 1;
      continue;
    }
    const xy = rec.slice(0, 2);
    const path = rec.slice(3);
    const isRename = xy.includes("R") || xy.includes("C");

    if (isRename && i + 1 < tokens.length && !STATUS_PREFIX_RE.test(tokens[i + 1])) {
      paths.push(tokens[i + 1]);
      i += 2;
      continue;
    }

    if (path) paths.push(path);
    i += 1;
  }

  return paths;
}

/** 兼容未加 -z 的 porcelain 文本行 */
export function listChangedPathsFromPorcelainLines(output: string): string[] {
  return output
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => normalizeGitStatusPath(line.slice(3)))
    .filter(Boolean);
}

export async function gitStatusChangedPaths(
  execFileAsync: (
    file: string,
    args: string[],
    opts: { cwd: string; maxBuffer?: number; encoding?: BufferEncoding },
  ) => Promise<{ stdout: string }>,
  cwd: string,
): Promise<string[]> {
  const { stdout } = await execFileAsync(
    "git",
    ["status", "--porcelain=v1", "-z"],
    { cwd, maxBuffer: 8 * 1024 * 1024, encoding: "utf8" },
  );
  return listChangedPathsFromPorcelainZ(stdout);
}
