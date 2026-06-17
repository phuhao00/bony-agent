import { NextRequest, NextResponse } from "next/server";
import { getBackendBaseUrl } from "@/lib/server/backend-proxy";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const base = getBackendBaseUrl();
    const res = await fetch(`${base}/claude-code/permission`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "permission failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
