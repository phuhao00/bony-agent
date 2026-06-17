import { errorMessage } from "@/lib/server/errors";
import { fetchBackend } from "@/lib/server/backend-proxy";
import { NextRequest, NextResponse } from "next/server";

const READ_TIMEOUT_MS = 30_000;
const WRITE_TIMEOUT_MS = 180_000;

export const maxDuration = 180;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ docId: string }> },
) {
  try {
    const { docId } = await params;
    const response = await fetchBackend(
      `/knowledge/documents/${encodeURIComponent(docId)}/content`,
      { cache: "no-store" },
      { timeoutMs: READ_TIMEOUT_MS, retries: 1 },
    );
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error: unknown) {
    console.error("Get knowledge document content error:", error);
    return NextResponse.json(
      { success: false, error: errorMessage(error) },
      { status: 502 },
    );
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ docId: string }> },
) {
  try {
    const { docId } = await params;
    const body = await req.json();
    const response = await fetchBackend(
      `/knowledge/documents/${encodeURIComponent(docId)}/content`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      { timeoutMs: WRITE_TIMEOUT_MS, retries: 1 },
    );
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error: unknown) {
    console.error("Update knowledge document content error:", error);
    return NextResponse.json(
      { success: false, error: errorMessage(error) },
      { status: 502 },
    );
  }
}
