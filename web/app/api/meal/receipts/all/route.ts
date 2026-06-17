import { getBackendBaseUrl } from "@/lib/server/backend-proxy";
import { errorMessage } from "@/lib/server/errors";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const qs = req.nextUrl.search;
    const res = await fetch(`${getBackendBaseUrl()}/meal/receipts/all${qs}`, {
      cache: "no-store",
    });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: errorMessage(error, "加载失败") },
      { status: 500 },
    );
  }
}
