import { NextResponse } from "next/server";
import { getBackendBaseUrl } from "@/lib/server/backend-proxy";

export async function GET() {
  try {
    const base = getBackendBaseUrl();
    const res = await fetch(`${base}/claude-code/health`, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "health check failed";
    return NextResponse.json({ ready: false, error: message }, { status: 502 });
  }
}
