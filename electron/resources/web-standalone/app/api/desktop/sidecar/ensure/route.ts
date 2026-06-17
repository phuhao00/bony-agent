import { fetchBackend } from "@/lib/server/backend-proxy";
import { NextResponse } from "next/server";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

export async function POST() {
  try {
    const res = await fetchBackend(
      "/desktop/sidecar/ensure",
      { method: "POST", cache: "no-store" },
      { timeoutMs: 30000, retries: 2 },
    );
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: errorMessage(error), sidecar_available: false, sidecar_reason: "ensure_failed" },
      { status: 502 },
    );
  }
}
