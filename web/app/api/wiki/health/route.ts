import { NextResponse } from "next/server";

const B = () => process.env.BACKEND_URL || "http://localhost:8000";

export async function GET() {
  try {
    const res = await fetch(`${B()}/wiki/health`, { cache: "no-store" });
    const data = await res.json().catch(() => ({ success: false, issues: [] }));
    return NextResponse.json(data, { status: res.ok ? 200 : res.status });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { success: false, error: msg, issues: [] },
      { status: 502 },
    );
  }
}
