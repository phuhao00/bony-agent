import { NextRequest, NextResponse } from "next/server";

const B = () => process.env.BACKEND_URL || "http://localhost:8000";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const res = await fetch(`${B()}/context/memory/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    const body = await res.json().catch(() => ({ success: false }));
    return NextResponse.json(body, { status: res.ok ? 200 : res.status });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ success: false, error: msg }, { status: 502 });
  }
}
