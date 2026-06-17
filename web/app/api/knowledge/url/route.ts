import { errorMessage } from "@/lib/server/errors";
import { fetchBackend } from "@/lib/server/backend-proxy";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 120;

const URL_IMPORT_TIMEOUT_MS = 90_000;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const response = await fetchBackend(
      "/knowledge/url",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      { timeoutMs: URL_IMPORT_TIMEOUT_MS, retries: 0 },
    );
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error: unknown) {
    console.error("Knowledge URL import error:", error);
    return NextResponse.json(
      { success: false, error: errorMessage(error) },
      { status: 500 },
    );
  }
}
