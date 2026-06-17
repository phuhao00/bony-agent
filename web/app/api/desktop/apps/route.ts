import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q") || "";
  const limit = request.nextUrl.searchParams.get("limit") || "50";
  const url = `${BACKEND_URL}/desktop/apps?q=${encodeURIComponent(q)}&limit=${encodeURIComponent(limit)}`;
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
