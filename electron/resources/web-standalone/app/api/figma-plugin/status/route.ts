import { NextResponse } from "next/server";

export async function GET() {
  try {
    const res = await fetch("http://127.0.0.1:8000/figma-plugin/status", {
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json(
      { connected: false, error: "Backend unreachable" },
      { status: 503 },
    );
  }
}
