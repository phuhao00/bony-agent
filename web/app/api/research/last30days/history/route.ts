import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://127.0.0.1:8000";

export async function GET(request: NextRequest) {
  try {
    const limit = request.nextUrl.searchParams.get("limit") || "10";
    const res = await fetch(
      `${BACKEND_URL}/research/last30days/history?limit=${encodeURIComponent(limit)}`,
      { cache: "no-store" },
    );
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "请求失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
