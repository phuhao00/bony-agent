import { getBackendBaseUrl } from "@/lib/server/backend-proxy";
import { errorMessage } from "@/lib/server/errors";
import { NextResponse } from "next/server";
import { NextRequest } from "next/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const q = new URLSearchParams();
    const job = sp.get("job_name");
    const num = sp.get("build_number");
    if (job) q.set("job_name", job);
    if (num) q.set("build_number", num);
    const res = await fetch(
      `${getBackendBaseUrl()}/feishu/ops/jenkins/console?${q.toString()}`,
      { cache: "no-store" },
    );
    return NextResponse.json(await res.json(), { status: res.status });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: errorMessage(error, "控制台日志加载失败") },
      { status: 500 },
    );
  }
}
