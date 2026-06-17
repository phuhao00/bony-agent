import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://127.0.0.1:8000";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const res = await fetch(`${BACKEND_URL}/api/mcp/servers/${id}/tools`, {
      signal: AbortSignal.timeout(12000),
    });
    const data = await res.json();
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json(
      { success: false, tools: [], error: e.message },
      { status: 500 },
    );
  }
}
