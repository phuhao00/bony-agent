import { NextRequest, NextResponse } from "next/server";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  const limit = req.nextUrl.searchParams.get("limit") ?? "16";
  try {
    const res = await fetch(
      `${API_BASE}/context/codegraph/search?q=${encodeURIComponent(q)}&limit=${encodeURIComponent(limit)}`,
      { cache: "no-store" },
    );
    const data = await res.json();
    if (!res.ok) {
      return NextResponse.json(data, { status: res.status });
    }
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to search codegraph" },
      { status: 502 },
    );
  }
}
