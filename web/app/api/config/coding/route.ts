import { NextRequest, NextResponse } from "next/server";
import { getBackendBaseUrl } from "@/lib/server/backend-proxy";

export async function GET() {
  try {
    const base = getBackendBaseUrl();
    const res = await fetch(`${base}/config/coding`, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed to load coding config";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const base = getBackendBaseUrl();
    const res = await fetch(`${base}/config/coding`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed to save coding config";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
