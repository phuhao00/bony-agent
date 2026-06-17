import { NextRequest, NextResponse } from "next/server";

const B = () => process.env.BACKEND_URL || "http://localhost:8000";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const qs = url.searchParams.toString();
    const res = await fetch(
      `${B()}/evolution/memory-usage/hits${qs ? `?${qs}` : ""}`,
      { cache: "no-store" },
    );
    const body = await res.json().catch(() => ({ success: false, hits: [] }));
    return NextResponse.json(body, { status: res.ok ? 200 : res.status });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { success: false, error: msg, hits: [] },
      { status: 502 },
    );
  }
}
