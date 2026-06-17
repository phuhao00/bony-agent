import { NextResponse } from "next/server";

const B = () => process.env.BACKEND_URL || "http://localhost:8000";

export async function GET() {
  try {
    const res = await fetch(`${B()}/connections/summary`, {
      cache: "no-store",
    });
    const body = await res.json().catch(() => ({ success: false }));
    return NextResponse.json(body, { status: res.ok ? 200 : res.status });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      {
        success: false,
        error: msg,
        sections: {
          platforms: [],
          productivity: [],
          local_runtime: [],
          mcp: [],
        },
      },
      { status: 502 },
    );
  }
}
