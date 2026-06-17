import { NextRequest, NextResponse } from "next/server";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function GET(req: NextRequest) {
  const qs = req.nextUrl.searchParams.toString();
  try {
    const res = await fetch(`${API_BASE}/context/memory/chunks?${qs}`, { cache: "no-store" });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch memory chunks" },
      { status: 502 },
    );
  }
}
