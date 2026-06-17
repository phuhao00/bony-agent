import { getBackendBaseUrl } from "@/lib/server/backend-proxy";
import { errorMessage } from "@/lib/server/errors";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const redirectUri = req.nextUrl.searchParams.get("redirect_uri") || "";
    const qs = redirectUri
      ? `?redirect_uri=${encodeURIComponent(redirectUri)}`
      : "";
    const res = await fetch(
      `${getBackendBaseUrl()}/meal/feishu/oauth-url${qs}`,
      { cache: "no-store" },
    );
    return NextResponse.json(await res.json(), { status: res.status });
  } catch (error: unknown) {
    return NextResponse.json({ ok: false, error: errorMessage(error) }, { status: 500 });
  }
}
