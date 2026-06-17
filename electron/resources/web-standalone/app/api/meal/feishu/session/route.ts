import { getBackendBaseUrl } from "@/lib/server/backend-proxy";
import { parseJsonResponse } from "@/lib/apiJson";
import { errorMessage } from "@/lib/server/errors";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get("token") || "";
    const code = req.nextUrl.searchParams.get("code") || "";
    const redirectUri = req.nextUrl.searchParams.get("redirect_uri") || "";
    const qs = new URLSearchParams();
    if (code) {
      qs.set("code", code);
      if (redirectUri) qs.set("redirect_uri", redirectUri);
    } else if (token) qs.set("token", token);
    else {
      return NextResponse.json({ ok: false, error: "需要 token 或 code" }, { status: 400 });
    }
    const res = await fetch(`${getBackendBaseUrl()}/meal/feishu/session?${qs}`, {
      cache: "no-store",
    });
    const data = await parseJsonResponse(res);
    return NextResponse.json(data, { status: res.status });
  } catch (error: unknown) {
    return NextResponse.json({ ok: false, error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.text();
    const res = await fetch(`${getBackendBaseUrl()}/meal/feishu/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    const data = await parseJsonResponse(res);
    return NextResponse.json(data, { status: res.status });
  } catch (error: unknown) {
    return NextResponse.json({ ok: false, error: errorMessage(error) }, { status: 500 });
  }
}
