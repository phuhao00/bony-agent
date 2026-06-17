import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://127.0.0.1:8000";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ presetId: string }> },
) {
  try {
    const { presetId } = await ctx.params;
    const res = await fetch(
      `${BACKEND_URL}/api/mcp/presets/${encodeURIComponent(presetId)}/install`,
      { method: "POST", signal: AbortSignal.timeout(120_000) },
    );
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: msg },
      { status: 500 },
    );
  }
}
