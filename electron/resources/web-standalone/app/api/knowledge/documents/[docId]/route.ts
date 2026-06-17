import { errorMessage } from "@/lib/server/errors";
import { fetchBackend } from "@/lib/server/backend-proxy";
import { NextRequest, NextResponse } from "next/server";

/** 增量删除索引；保留适度超时以覆盖大文档 fallback rebuild */
const DELETE_TIMEOUT_MS = 60_000;

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ docId: string }> },
) {
  try {
    const { docId } = await params;
    const response = await fetchBackend(
      `/knowledge/documents/${encodeURIComponent(docId)}`,
      { method: "DELETE", cache: "no-store" },
      { timeoutMs: DELETE_TIMEOUT_MS, retries: 1 },
    );
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error: unknown) {
    console.error("Delete knowledge document error:", error);
    return NextResponse.json(
      {
        success: false,
        error: errorMessage(error),
        hint: "删除超时或 Backend 未响应。请确认 FastAPI :8000 已启动。",
      },
      { status: 502 },
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ docId: string }> },
) {
  try {
    const { docId } = await params;
    const body = await req.json();
    const response = await fetchBackend(
      `/knowledge/documents/${encodeURIComponent(docId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      { timeoutMs: 30_000, retries: 1 },
    );
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error: unknown) {
    console.error("Patch knowledge document error:", error);
    return NextResponse.json(
      { success: false, error: errorMessage(error) },
      { status: 502 },
    );
  }
}
