import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  try {
    const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";
    const params = new URLSearchParams();
    req.nextUrl.searchParams.forEach((v, k) => params.set(k, v));
    const res = await fetch(`${BACKEND_URL}/evolution/dreams?${params}`, {
      cache: "no-store",
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json(
        { error: body.detail || `Backend ${res.status}`, cards: [], count: 0 },
        { status: res.status },
      );
    }
    return NextResponse.json(body);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg, cards: [], count: 0 }, { status: 502 });
  }
}
