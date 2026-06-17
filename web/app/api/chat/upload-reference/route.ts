import { NextRequest, NextResponse } from "next/server";
import { getBackendBaseUrl } from "@/lib/server/backend-proxy";

/** 浏览器上传参考图 → 后端落盘 `/uploads`，返回 `public_url` 供 generateVideoFromImage 等工具使用 */
export async function POST(req: NextRequest) {
    try {
        const incoming = await req.formData();
        const file = incoming.get("file");
        if (!file || typeof file === "string") {
            return NextResponse.json(
                { ok: false, error: "缺少 file 字段" },
                { status: 400 },
            );
        }
        const out = new FormData();
        out.append("file", file as Blob, (file as File).name || "reference");

        const base = getBackendBaseUrl();
        const res = await fetch(`${base}/tools/media/upload-reference`, {
            method: "POST",
            body: out,
            signal: AbortSignal.timeout(120_000),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            return NextResponse.json(
                typeof data === "object" && data !== null
                    ? data
                    : { error: res.statusText },
                { status: res.status },
            );
        }
        return NextResponse.json(data);
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
}
