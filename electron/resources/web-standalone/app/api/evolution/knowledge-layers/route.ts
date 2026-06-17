import { NextResponse } from "next/server";

const B = () => process.env.BACKEND_URL || "http://localhost:8000";

export async function GET() {
  try {
    const res = await fetch(`${B()}/evolution/knowledge-layers`, {
      cache: "no-store",
    });
    const body = await res
      .json()
      .catch(() => ({ success: false, layers: {}, aliases: {} }));
    return NextResponse.json(body, { status: res.ok ? 200 : res.status });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { success: false, error: msg, layers: {}, aliases: {} },
      { status: 502 },
    );
  }
}
