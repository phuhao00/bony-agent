import { fetchBackend } from "@/lib/server/backend-proxy";
import { NextRequest, NextResponse } from "next/server";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const res = await fetchBackend(
      `/computer/actions/audit?${searchParams.toString()}`,
    );
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: errorMessage(error), events: [] },
      { status: 500 },
    );
  }
}
