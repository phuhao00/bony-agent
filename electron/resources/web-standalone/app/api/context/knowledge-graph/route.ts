import { NextResponse } from "next/server";

export async function GET() {
  try {
    const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";
    const res = await fetch(`${BACKEND_URL}/context/knowledge-graph`, {
      cache: "no-store",
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json(
        {
          success: false,
          error: body.detail || body.error || `Backend ${res.status}`,
          nodes: [],
          links: [],
        },
        { status: res.status },
      );
    }
    return NextResponse.json(body);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("context/knowledge-graph proxy:", msg);
    return NextResponse.json(
      { success: false, error: msg, nodes: [], links: [] },
      { status: 502 },
    );
  }
}
