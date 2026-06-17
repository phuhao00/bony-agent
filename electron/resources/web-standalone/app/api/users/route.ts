import { NextRequest, NextResponse } from "next/server";
import { fetchBackend, getBackendBaseUrl } from "@/lib/server/backend-proxy";

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const skip = url.searchParams.get("skip") ?? "0";
    const limit = url.searchParams.get("limit") ?? "50";
    const res = await fetchBackend(
      `/users?skip=${encodeURIComponent(skip)}&limit=${encodeURIComponent(limit)}`,
      {
        headers: {
          Authorization: request.headers.get("authorization") || "",
          Accept: "application/json",
        },
      },
      { retries: 4, timeoutMs: 30000 },
    );
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Backend unreachable";
    console.error("[api/users] proxy error:", msg);
    return NextResponse.json(
      {
        detail:
          `无法连接后端 (${getBackendBaseUrl()})。请启动后端：./start_local.sh 或 cd backend && python -m uvicorn main:app --host 0.0.0.0 --port 8000`,
      },
      { status: 502 },
    );
  }
}
