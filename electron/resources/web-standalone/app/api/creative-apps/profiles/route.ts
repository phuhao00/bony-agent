import { fetchBackend } from "@/lib/server/backend-proxy";
import { NextResponse } from "next/server";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

export async function GET() {
  try {
    const res = await fetchBackend("/creative-apps/profiles", { cache: "no-store" }, { timeoutMs: 8000 });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (error: unknown) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 502 });
  }
}
