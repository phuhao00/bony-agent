import { errorMessage } from "@/lib/server/errors";
import { fetchBackend } from "@/lib/server/backend-proxy";
import { NextRequest, NextResponse } from "next/server";

/** 后端繁忙（如 PDF OCR 导入）时，读接口仍应快速响应；略放宽超时以覆盖冷启动 */
const READ_TIMEOUT_MS = 30_000;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const category = searchParams.get("category");
    const path = category
      ? `/knowledge/documents?category=${encodeURIComponent(category)}`
      : "/knowledge/documents";
    const response = await fetchBackend(
      path,
      { cache: "no-store" },
      { timeoutMs: READ_TIMEOUT_MS, retries: 2 },
    );
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error: unknown) {
    console.error("List knowledge documents error:", error);
    return NextResponse.json(
      {
        success: false,
        error: errorMessage(error),
        hint: "Backend 未就绪。请确认 FastAPI :8000 已启动（./start_local.sh 或 Electron）。",
        documents: [],
      },
      { status: 502 },
    );
  }
}
