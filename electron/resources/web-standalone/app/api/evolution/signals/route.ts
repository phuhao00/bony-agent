import { NextRequest, NextResponse } from "next/server";

const B = () => process.env.BACKEND_URL || "http://localhost:8000";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const qs = url.searchParams.toString();
    const res = await fetch(`${B()}/evolution/signals${qs ? `?${qs}` : ""}`, {
      cache: "no-store",
    });
    const body = await res
      .json()
      .catch(() => ({ success: false, signals: [] }));
    return NextResponse.json(body, { status: res.ok ? 200 : res.status });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { success: false, error: msg, signals: [] },
      { status: 502 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const res = await fetch(`${B()}/evolution/signals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({ success: false }));
    return NextResponse.json(data, { status: res.ok ? 200 : res.status });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ success: false, error: msg }, { status: 502 });
  }
}
