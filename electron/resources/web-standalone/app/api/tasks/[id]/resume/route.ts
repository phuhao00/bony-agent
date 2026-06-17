import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://127.0.0.1:8000";
const PROXY_TIMEOUT_MS = 15_000;

export const maxDuration = 30;

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(
        `${BACKEND_URL}/tasks/${encodeURIComponent(id)}/resume`,
        {
          method: "POST",
          signal: controller.signal,
        },
      );
    } finally {
      clearTimeout(timer);
    }
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (e: unknown) {
    const aborted =
      (typeof DOMException !== "undefined" &&
        e instanceof DOMException &&
        e.name === "AbortError") ||
      (e instanceof Error && e.name === "AbortError");
    const message = aborted
      ? `恢复任务提交超时（>${Math.round(PROXY_TIMEOUT_MS / 1000)}s）`
      : e instanceof Error
        ? e.message
        : "请求失败";
    return NextResponse.json(
      { success: false, error: message },
      { status: aborted ? 504 : 500 },
    );
  }
}
