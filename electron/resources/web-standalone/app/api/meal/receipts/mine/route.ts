import { parseJsonResponse } from "@/lib/apiJson";
import { getBackendBaseUrl } from "@/lib/server/backend-proxy";
import { errorMessage } from "@/lib/server/errors";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const qs = new URLSearchParams();
    const token = sp.get("token") || "";
    const name = sp.get("name") || "";
    const month = sp.get("month") || "";
    if (token) qs.set("token", token);
    if (name) qs.set("name", name);
    if (month) qs.set("month", month);
    const res = await fetch(
      `${getBackendBaseUrl()}/meal/receipts/mine?${qs}`,
      { cache: "no-store" },
    );
    const data = await parseJsonResponse(res);
    return NextResponse.json(data, { status: res.status });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: errorMessage(error), records: [] },
      { status: 500 },
    );
  }
}
