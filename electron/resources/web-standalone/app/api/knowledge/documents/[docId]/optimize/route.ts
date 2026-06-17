import { errorMessage } from "@/lib/server/errors";
import { fetchBackend } from "@/lib/server/backend-proxy";
import { NextRequest, NextResponse } from "next/server";

const TIMEOUT_MS = 180_000;

export const maxDuration = 180;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ docId: string }> },
) {
  try {
    const { docId } = await params;
    const body = await req.json().catch(() => ({}));
    const response = await fetchBackend(
      `/knowledge/documents/${encodeURIComponent(docId)}/optimize`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      { timeoutMs: TIMEOUT_MS, retries: 1 },
    );
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error: unknown) {
    console.error("Optimize knowledge document error:", error);
    return NextResponse.json(
      { success: false, error: errorMessage(error) },
      { status: 502 },
    );
  }
}
