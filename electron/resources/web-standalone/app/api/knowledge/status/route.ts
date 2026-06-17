import { errorMessage } from "@/lib/server/errors";
import { fetchBackend } from "@/lib/server/backend-proxy";
import { NextResponse } from "next/server";

const READ_TIMEOUT_MS = 30_000;

export async function GET() {
  try {
    const response = await fetchBackend(
      "/knowledge/status",
      { cache: "no-store" },
      { timeoutMs: READ_TIMEOUT_MS, retries: 2 },
    );
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error: unknown) {
    console.error("Knowledge status error:", error);
    return NextResponse.json(
      {
        success: false,
        error: errorMessage(error),
        status: { initialized: false },
      },
      { status: 502 },
    );
  }
}
