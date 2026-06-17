import { NextRequest, NextResponse } from "next/server";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function POST(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const withIndex = url.searchParams.get("with_index") !== "false";
    const res = await fetch(
      `${API_BASE}/context/codegraph/init?with_index=${withIndex}`,
      { method: "POST", cache: "no-store" },
    );
    const data = await res.json();
    if (!res.ok) {
      return NextResponse.json(data, { status: res.status });
    }
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to initialize codegraph" },
      { status: 502 },
    );
  }
}
