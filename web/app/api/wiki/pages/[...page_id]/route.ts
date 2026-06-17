import { NextRequest, NextResponse } from "next/server";

const B = () => process.env.BACKEND_URL || "http://localhost:8000";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ page_id: string[] }> },
) {
  try {
    const { page_id } = await params;
    const pageId = (page_id || []).map(encodeURIComponent).join("/");
    const res = await fetch(`${B()}/wiki/pages/${pageId}`, {
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({ success: false }));
    return NextResponse.json(data, { status: res.ok ? 200 : res.status });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ success: false, error: msg }, { status: 502 });
  }
}
