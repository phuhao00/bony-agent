import { getBackendBaseUrl } from "@/lib/server/backend-proxy";
import { errorMessage } from "@/lib/server/errors";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const ct = req.headers.get("content-type") || "";
    const backendUrl = `${getBackendBaseUrl()}/tapd/bugs/create`;

    let res: Response;
    if (ct.includes("multipart/form-data")) {
      const form = await req.formData();
      res = await fetch(backendUrl, {
        method: "POST",
        body: form,
      });
    } else {
      const body = await req.json();
      res = await fetch(backendUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }

    const text = await res.text();
    if (!text) {
      return NextResponse.json(
        { ok: false, error: `后端无响应 (${res.status})` },
        { status: res.status || 502 },
      );
    }
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      return NextResponse.json(data, { status: res.status });
    } catch {
      const preview = text.slice(0, 200).replace(/\s+/g, " ");
      return NextResponse.json(
        {
          ok: false,
          error: `后端返回非 JSON (${res.status})：${preview}`,
        },
        { status: res.status >= 400 ? res.status : 502 },
      );
    }
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: errorMessage(error, "创建 TAPD 缺陷失败") },
      { status: 500 },
    );
  }
}
