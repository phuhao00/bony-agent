import { errorMessage } from "@/lib/server/errors";
import { fetchBackend } from "@/lib/server/backend-proxy";
import { NextRequest, NextResponse } from "next/server";

const READ_TIMEOUT_MS = 30_000;

export async function GET() {
  try {
    const response = await fetchBackend(
      "/knowledge/categories",
      { cache: "no-store" },
      { timeoutMs: READ_TIMEOUT_MS, retries: 2 },
    );
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error: unknown) {
    console.error("List knowledge categories error:", error);
    return NextResponse.json(
      {
        success: false,
        error: errorMessage(error),
        hint: "Backend 未就绪。请确认 FastAPI :8000 已启动。",
        categories: [],
      },
      { status: 502 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const response = await fetchBackend("/knowledge/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error: unknown) {
    console.error("Create knowledge category error:", error);
    return NextResponse.json(
      { success: false, error: errorMessage(error) },
      { status: 502 },
    );
  }
}
