import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://127.0.0.1:8000";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ task_id: string }> },
) {
  try {
    const { task_id: taskId } = await context.params;
    const body = await request.json().catch(() => ({}));
    const res = await fetch(
      `${BACKEND_URL}/media-pipeline/${encodeURIComponent(taskId)}/gate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
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
