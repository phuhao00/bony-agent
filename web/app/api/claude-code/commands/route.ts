import { NextRequest, NextResponse } from "next/server";
import { getBackendBaseUrl } from "@/lib/server/backend-proxy";

export async function GET(req: NextRequest) {
  try {
    const workspaceRoot = req.nextUrl.searchParams.get("workspace_root") || "";
    const base = getBackendBaseUrl().replace(/\/$/, "");
    const url = new URL(`${base}/claude-code/commands`);
    if (workspaceRoot) url.searchParams.set("workspace_root", workspaceRoot);
    const res = await fetch(url.toString(), { cache: "no-store" });
    const data = await res.json().catch(() => ({ commands: [] }));
    return NextResponse.json(data, { status: res.status });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "commands fetch failed";
    return NextResponse.json({ commands: [], error: message }, { status: 502 });
  }
}
