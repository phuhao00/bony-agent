import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function GET(request: NextRequest) {
  const category = request.nextUrl.searchParams.get("category");
  const qs = category ? `?category=${encodeURIComponent(category)}` : "";
  const res = await fetch(`${BACKEND_URL}/legal-advisor/recipes${qs}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return NextResponse.json({ recipes: [] }, { status: res.status });
  }
  return NextResponse.json(data);
}
