import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function GET(request: NextRequest) {
  const category = request.nextUrl.searchParams.get("category");
  const qs = category ? `?category=${encodeURIComponent(category)}` : "";
  const res = await fetch(`${BACKEND_URL}/ad-campaign/recipes${qs}`);
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
