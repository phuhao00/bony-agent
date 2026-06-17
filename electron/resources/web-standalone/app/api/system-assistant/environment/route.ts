import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function GET(request: NextRequest) {
  const clientPlatform = request.nextUrl.searchParams.get("client_platform");
  const url = clientPlatform
    ? `${BACKEND_URL}/system-assistant/environment?client_platform=${encodeURIComponent(clientPlatform)}`
    : `${BACKEND_URL}/system-assistant/environment`;
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
