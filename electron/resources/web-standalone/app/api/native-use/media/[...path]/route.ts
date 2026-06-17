import { NextRequest, NextResponse } from "next/server";

const BACKEND = process.env.BACKEND_URL || "http://127.0.0.1:8000";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  const { path } = await ctx.params;
  const rel = (path || []).join("/");
  if (!rel || rel.includes("..")) {
    return NextResponse.json({ error: "invalid path" }, { status: 400 });
  }
  const res = await fetch(`${BACKEND}/native-use/media/${rel}`, { cache: "no-store" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  }
  const buf = await res.arrayBuffer();
  return new NextResponse(buf, {
    status: 200,
    headers: { "Content-Type": res.headers.get("Content-Type") || "image/png" },
  });
}
