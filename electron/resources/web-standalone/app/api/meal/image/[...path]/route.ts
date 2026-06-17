import { getBackendBaseUrl } from "@/lib/server/backend-proxy";
import { errorMessage } from "@/lib/server/errors";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    const { path } = await params;
    const rel = (path || []).map(encodeURIComponent).join("/");
    const res = await fetch(`${getBackendBaseUrl()}/uploads/meal/${rel}`, {
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json({ error: "not found" }, { status: res.status });
    }
    const buf = await res.arrayBuffer();
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": res.headers.get("content-type") || "image/jpeg",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: errorMessage(error, "加载图片失败") },
      { status: 500 },
    );
  }
}
