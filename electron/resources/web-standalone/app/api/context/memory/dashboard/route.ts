import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  try {
    const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";
    const hitsLimit = req.nextUrl.searchParams.get("hits_limit") || "200";
    const signalsLimit = req.nextUrl.searchParams.get("signals_limit") || "1000";
    const res = await fetch(
      `${BACKEND_URL}/context/memory/dashboard?hits_limit=${hitsLimit}&signals_limit=${signalsLimit}`,
      { cache: "no-store", signal: AbortSignal.timeout(20_000) },
    );
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json(
        { success: false, error: body.detail || `Backend ${res.status}` },
        { status: res.status },
      );
    }
    return NextResponse.json(body);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ success: false, error: msg }, { status: 502 });
  }
}
