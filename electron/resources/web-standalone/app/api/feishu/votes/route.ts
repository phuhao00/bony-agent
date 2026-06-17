import { getBackendBaseUrl } from "@/lib/server/backend-proxy";
import { errorMessage } from "@/lib/server/errors";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const qs = request.nextUrl.searchParams.toString();
    const url = `${getBackendBaseUrl()}/feishu/votes${qs ? `?${qs}` : ""}`;
    const res = await fetch(url, { cache: "no-store" });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, polls: [], error: errorMessage(error, "获取投票列表失败") },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const res = await fetch(`${getBackendBaseUrl()}/feishu/votes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: errorMessage(error, "创建投票失败") },
      { status: 500 },
    );
  }
}
