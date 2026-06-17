import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  try {
    const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";
    const mode = req.nextUrl.searchParams.get("mode") || "memories";
    const res = await fetch(`${BACKEND_URL}/context/memory-graph?mode=${mode}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json(
        { error: body.detail || `Backend ${res.status}`, nodes: [], links: [] },
        { status: res.status },
      );
    }
    return NextResponse.json(body);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg, nodes: [], links: [] }, { status: 502 });
  }
}
