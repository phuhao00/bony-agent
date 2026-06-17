import { NextRequest, NextResponse } from "next/server";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const params = new URLSearchParams();
  for (const key of ["symbol", "scope", "hops", "max_nodes", "edge_kinds"]) {
    const val = sp.get(key);
    if (val) params.set(key, val);
  }
  try {
    const res = await fetch(`${API_BASE}/context/codegraph/graph?${params}`, {
      cache: "no-store",
    });
    const data = await res.json();
    if (!res.ok) {
      return NextResponse.json(data, { status: res.status });
    }
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load codegraph graph" },
      { status: 502 },
    );
  }
}
