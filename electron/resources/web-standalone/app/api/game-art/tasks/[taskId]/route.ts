import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await params;
  const res = await fetch(`${BACKEND_URL}/game-art/tasks/${encodeURIComponent(taskId)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return NextResponse.json(
      { success: false, error: data.detail || `后端错误 (${res.status})` },
      { status: res.status },
    );
  }
  return NextResponse.json(data);
}
