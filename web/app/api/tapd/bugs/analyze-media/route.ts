import { getBackendBaseUrl } from "@/lib/server/backend-proxy";
import { errorMessage } from "@/lib/server/errors";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const ct = req.headers.get("content-type") || "";
    if (!ct.includes("multipart/form-data")) {
      return NextResponse.json(
        { ok: false, error: "请使用 multipart/form-data 上传附件" },
        { status: 400 },
      );
    }

    const form = await req.formData();
    const backendUrl = `${getBackendBaseUrl()}/tapd/bugs/analyze-media`;
    const res = await fetch(backendUrl, {
      method: "POST",
      body: form,
    });

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
      { ok: false, error: errorMessage(error, "分析附件失败") },
      { status: 500 },
    );
  }
}
