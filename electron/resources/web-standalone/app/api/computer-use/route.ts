import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

/** 异步提交：仅等待 task_id 返回 */
const PROXY_TIMEOUT_MS = 15_000;

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), PROXY_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${BACKEND_URL}/computer-use/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
    } finally {
      clearTimeout(t);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json(
        {
          success: false,
          error: data.detail || data.error || `后端错误 (${res.status})`,
        },
        { status: res.status },
      );
    }
    return NextResponse.json(data);
  } catch (e: unknown) {
    const aborted =
      (typeof DOMException !== "undefined" &&
        e instanceof DOMException &&
        e.name === "AbortError") ||
      (e instanceof Error && e.name === "AbortError");
    if (aborted) {
      return NextResponse.json(
        {
          success: false,
          error: `提交超时（>${Math.round(PROXY_TIMEOUT_MS / 1000)}s）。请确认 FastAPI 在 ${BACKEND_URL} 可访问。`,
        },
        { status: 504 },
      );
    }
    const message = e instanceof Error ? e.message : "请求失败";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
