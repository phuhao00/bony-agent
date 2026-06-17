import { getBackendBaseUrl } from "@/lib/server/backend-proxy";
import { errorMessage } from "@/lib/server/errors";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  try {
    const res = await fetch(`${getBackendBaseUrl()}/feishu/ops/jenkins/config`, {
      cache: "no-store",
    });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: errorMessage(error, "加载 Jenkins 配置失败") },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const res = await fetch(`${getBackendBaseUrl()}/feishu/ops/jenkins/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: errorMessage(error, "保存 Jenkins 配置失败") },
      { status: 500 },
    );
  }
}
