import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const body = await request.json();
  const res = await fetch(`${BACKEND_URL}/business-partnership/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return NextResponse.json(
      { success: false, error: data.detail || data.error || `后端错误 (${res.status})` },
      { status: res.status },
    );
  }
  return NextResponse.json(data);
}
