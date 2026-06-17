import { NextRequest, NextResponse } from "next/server";
import { fetchBackend, getBackendBaseUrl } from "@/lib/server/backend-proxy";

const POST_ACTIONS = new Set([
  "login",
  "logout",
  "change-password",
  "register",
]);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ action: string }> },
) {
  const { action } = await params;
  if (action !== "me") {
    return NextResponse.json({ detail: "Not found" }, { status: 404 });
  }
  try {
    const res = await fetchBackend("/auth/me", {
      method: "GET",
      headers: {
        Authorization: request.headers.get("authorization") || "",
        Accept: "application/json",
      },
    }, { retries: 4, timeoutMs: 15000 });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Backend unreachable";
    console.error("[api/auth/me] proxy error:", msg);
    return NextResponse.json(
      {
        detail:
          `无法连接后端 (${getBackendBaseUrl()})。请在本机终端执行 ./start_local.sh，或单独启动：cd backend && python -m uvicorn main:app --host 0.0.0.0 --port 8000`,
      },
      { status: 502 },
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ action: string }> },
) {
  const { action } = await params;
  if (!POST_ACTIONS.has(action)) {
    return NextResponse.json({ detail: "Not found" }, { status: 404 });
  }
  try {
    const body = await request.text();
    const headers: Record<string, string> = {
      "Content-Type": request.headers.get("content-type") || "application/json",
    };
    const auth = request.headers.get("authorization");
    if (auth) headers.Authorization = auth;

    const res = await fetchBackend(`/auth/${action}`, {
      method: "POST",
      headers,
      body: body || undefined,
    }, { retries: 4, timeoutMs: 30000 });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Backend unreachable";
    console.error(`[api/auth/${action}] proxy error:`, msg);
    return NextResponse.json(
      {
        detail:
          `无法连接后端 (${getBackendBaseUrl()})。请在本机终端执行 ./start_local.sh，或单独启动：cd backend && python -m uvicorn main:app --host 0.0.0.0 --port 8000`,
      },
      { status: 502 },
    );
  }
}
