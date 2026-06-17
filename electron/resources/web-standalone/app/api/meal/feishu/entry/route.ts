import { getBackendBaseUrl } from "@/lib/server/backend-proxy";
import { parseJsonResponse } from "@/lib/apiJson";
import { errorMessage } from "@/lib/server/errors";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  try {
    const res = await fetch(`${getBackendBaseUrl()}/meal/feishu/entry`, {
      cache: "no-store",
    });
    const data = await parseJsonResponse(res);
    return NextResponse.json(data, { status: res.status });
  } catch (error: unknown) {
    return NextResponse.json({ ok: false, error: errorMessage(error) }, { status: 500 });
  }
}
