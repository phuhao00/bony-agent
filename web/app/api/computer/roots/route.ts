import { fetchBackend } from "@/lib/server/backend-proxy";
import { NextResponse } from "next/server";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

export async function GET() {
  try {
    const res = await fetchBackend("/computer/roots");
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: errorMessage(error), roots: [] },
      { status: 500 },
    );
  }
}
