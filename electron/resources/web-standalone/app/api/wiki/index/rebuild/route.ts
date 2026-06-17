import { NextResponse } from "next/server";

const B = () => process.env.BACKEND_URL || "http://localhost:8000";

export async function POST() {
  try {
    const res = await fetch(`${B()}/wiki/index/rebuild`, {
      method: "POST",
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({ success: false }));
    return NextResponse.json(data, { status: res.ok ? 200 : res.status });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ success: false, error: msg }, { status: 502 });
  }
}
