import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await params;
  const res = await fetch(`${BACKEND_URL}/programmer/tasks/${encodeURIComponent(taskId)}`);
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
