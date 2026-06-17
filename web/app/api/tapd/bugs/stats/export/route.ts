import { getBackendBaseUrl } from "@/lib/server/backend-proxy";
import { errorMessage } from "@/lib/server/errors";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const res = await fetch(`${getBackendBaseUrl()}/tapd/bugs/stats/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      const detail =
        typeof err === "object" && err && "detail" in err
          ? String((err as { detail?: string }).detail)
          : res.statusText;
      return NextResponse.json({ ok: false, error: detail }, { status: res.status });
    }

    const blob = await res.blob();
    const filename =
      res.headers.get("X-Export-Filename") ||
      res.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ||
      "tapd-stats-export";

    return new NextResponse(blob, {
      status: 200,
      headers: {
        "Content-Type": res.headers.get("Content-Type") || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Export-Filename": filename,
      },
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: errorMessage(error, "导出统计报告失败") },
      { status: 500 },
    );
  }
}
