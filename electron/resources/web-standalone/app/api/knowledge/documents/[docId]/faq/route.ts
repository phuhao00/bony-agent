import { errorMessage } from "@/lib/server/errors";
import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ docId: string }> },
) {
  try {
    const { docId } = await params;
    const response = await fetch(
      `${BACKEND_URL}/knowledge/documents/${encodeURIComponent(docId)}/faq`,
      { cache: "no-store" },
    );
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: errorMessage(error) },
      { status: 500 },
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
    const response = await fetch(
      `${BACKEND_URL}/knowledge/documents/${encodeURIComponent(docId)}/faq`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: errorMessage(error) },
      { status: 500 },
    );
  }
}
