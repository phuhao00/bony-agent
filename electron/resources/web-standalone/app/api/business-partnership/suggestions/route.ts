import { NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function GET() {
  const res = await fetch(`${BACKEND_URL}/business-partnership/suggestions`);
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
