import { getBackendBaseUrl } from "@/lib/server/backend-proxy";
import { errorMessage } from "@/lib/server/errors";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const res = await fetch(`${getBackendBaseUrl()}/feishu/ops/jenkins/trigger`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: errorMessage(error, "触发构建失败") },
      { status: 500 },
    );
  }
}
