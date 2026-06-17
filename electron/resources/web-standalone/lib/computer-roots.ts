export type ComputerRootEntry =
  | string
  | {
      path?: string;
      root_path?: string;
      label?: string;
      name?: string;
    };

export function computerRootPath(root: ComputerRootEntry): string {
  if (typeof root === "string") return root;
  return root.path || root.root_path || "";
}

export function computerRootLabel(root: ComputerRootEntry): string {
  if (typeof root === "string") return root;
  return root.label || root.name || computerRootPath(root);
}

export function normalizeComputerPath(path: string): string {
  return path.trim().replace(/\/+$/, "");
}

export function isUnderRegisteredRoot(
  targetPath: string,
  roots: ComputerRootEntry[],
): boolean {
  const target = normalizeComputerPath(targetPath);
  if (!target) return false;
  return roots.some((root) => {
    const base = normalizeComputerPath(computerRootPath(root));
    if (!base) return false;
    return target === base || target.startsWith(`${base}/`);
  });
}

export const MY_COMPUTER_SETUP_HINT =
  "请先在 设置 → My Computer 登记目录，再选择已登记路径进行整理。";
