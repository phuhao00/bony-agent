import { NextRequest, NextResponse } from "next/server";

/**
 * Dream Engine 管理 API 代理
 * GET  /api/evolution/dream?action=status  -> GET /evolution/dream/status
 * GET  /api/evolution/dream?action=digest  -> GET /evolution/dream/digest
 * POST /api/evolution/dream?action=run     -> POST /evolution/dream/run
 */
export async function GET(req: NextRequest) {
  const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";
  const action = req.nextUrl.searchParams.get("action") || "status";

  try {
    const res = await fetch(`${BACKEND_URL}/evolution/dream/${action}`, { cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json({ error: body.detail || `Backend ${res.status}` }, { status: res.status });
    }
    return NextResponse.json(body);
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";
  const force = req.nextUrl.searchParams.get("force") === "true";

  try {
    const res = await fetch(`${BACKEND_URL}/evolution/dream/run?force=${force}`, {
      method: "POST",
      cache: "no-store",
    });
    const body = await res.json().catch(() => ({}));
    return NextResponse.json(body, { status: res.ok ? 200 : res.status });
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
