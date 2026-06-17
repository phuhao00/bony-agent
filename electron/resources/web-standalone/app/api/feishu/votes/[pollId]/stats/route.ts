import { getBackendBaseUrl } from "@/lib/server/backend-proxy";
import { errorMessage } from "@/lib/server/errors";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ pollId: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  const { pollId } = await context.params;
  try {
    const res = await fetch(`${getBackendBaseUrl()}/feishu/votes/${pollId}/stats`, {
      cache: "no-store",
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: errorMessage(error, "获取投票统计失败") },
      { status: 500 },
    );
  }
}
