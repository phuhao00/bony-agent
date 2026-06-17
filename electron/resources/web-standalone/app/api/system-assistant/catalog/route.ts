import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("query");
  const category = request.nextUrl.searchParams.get("category");
  const params = new URLSearchParams();
  if (q) params.set("query", q);
  if (category) params.set("category", category);
  const qs = params.toString();
  const res = await fetch(
    `${BACKEND_URL}/system-assistant/catalog${qs ? `?${qs}` : ""}`,
    { cache: "no-store" },
  );
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const res = await fetch(`${BACKEND_URL}/system-assistant/catalog`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
