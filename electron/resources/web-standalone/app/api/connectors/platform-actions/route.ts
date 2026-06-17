import { fetchBackend } from "@/lib/server/backend-proxy";
import { NextRequest, NextResponse } from "next/server";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const res = await fetchBackend("/connectors/platform-actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: errorMessage(error), success: false },
      { status: 500 },
    );
  }
}
