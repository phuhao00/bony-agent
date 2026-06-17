import { getBackendBaseUrl } from "@/lib/server/backend-proxy";
import { errorMessage } from "@/lib/server/errors";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  try {
    const res = await fetch(`${getBackendBaseUrl()}/feishu/votes/templates`, {
      cache: "no-store",
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, templates: [], error: errorMessage(error, "获取投票模版失败") },
      { status: 500 },
    );
  }
}
