import { NextRequest, NextResponse } from "next/server";

const B = () => process.env.BACKEND_URL || "http://localhost:8000";

export async function GET() {
  try {
    const res = await fetch(`${B()}/context/memory`, {
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const body = await res
      .json()
      .catch(() => ({ success: false, memories: [] }));
    return NextResponse.json(body, { status: res.ok ? 200 : res.status });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { success: false, error: msg, memories: [] },
      { status: 502 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const res = await fetch(`${B()}/context/memory/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const data = await res
      .json()
      .catch(() => ({ success: false, results: [] }));
    return NextResponse.json(data, { status: res.ok ? 200 : res.status });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { success: false, error: msg, results: [] },
      { status: 502 },
    );
  }
}
