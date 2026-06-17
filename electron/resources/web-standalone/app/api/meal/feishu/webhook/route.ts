import { getBackendBaseUrl } from "@/lib/server/backend-proxy";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/** 飞书事件/卡片回调代理 → FastAPI /meal/feishu/webhook */
export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const res = await fetch(`${getBackendBaseUrl()}/meal/feishu/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": request.headers.get("content-type") || "application/json",
      },
      body,
      cache: "no-store",
    });
    const text = await res.text();
    if (!text) {
      return new NextResponse(null, { status: res.status });
    }
    try {
      const data = JSON.parse(text);
      return NextResponse.json(data, { status: res.status });
    } catch {
      return new NextResponse(text, { status: res.status });
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "webhook proxy failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
