import { fetchBackend } from "@/lib/server/backend-proxy";
import { errorMessage } from "@/lib/server/errors";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const path = searchParams.get("path") || "/";
    const res = await fetchBackend(
      `/computer/browse?path=${encodeURIComponent(path)}`,
    );
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: errorMessage(error), success: false },
      { status: 500 },
    );
  }
}
