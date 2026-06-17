import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://127.0.0.1:8000";

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const res = await fetch(
      `${BACKEND_URL}/tasks/${encodeURIComponent(id)}/cancel`,
      {
        method: "POST",
        signal: AbortSignal.timeout(8000),
      },
    );
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "请求失败";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
