import { getBackendBaseUrl } from "@/lib/server/backend-proxy";
import { errorMessage } from "@/lib/server/errors";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const qs = req.nextUrl.search;
    const res = await fetch(`${getBackendBaseUrl()}/meal/export${qs}`, {
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: await res.text() },
        { status: res.status },
      );
    }
    const buf = await res.arrayBuffer();
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type":
          res.headers.get("content-type") ||
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition":
          res.headers.get("content-disposition") ||
          'attachment; filename="meal.xlsx"',
      },
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: errorMessage(error, "导出失败") },
      { status: 500 },
    );
  }
}
