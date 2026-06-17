import path from "node:path";
import { NextResponse } from "next/server";
import { resolveWorkspaceRoot } from "@/lib/server/workspace-git-root";

export async function GET() {
  const root = path.resolve(resolveWorkspaceRoot(null));
  return NextResponse.json({
    root,
    label: path.basename(root) || root,
  });
}
