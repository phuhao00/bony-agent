import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

// 发布涉及 Playwright 浏览器操作，最长可能需要 5 分钟
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    // body should match PublishRequest: { platform, content, title, media_urls, options }

    // 5 分钟超时，兼容 Playwright 长耗时操作
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 280_000);

    let response: Response;
    try {
      response = await fetch(`${BACKEND_URL}/tools/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const text = await response.text();
      let detail = text;
      try {
        detail = JSON.parse(text)?.detail || text;
      } catch {}
      return NextResponse.json(
        { success: false, error: detail },
        { status: response.status },
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: any) {
    const isTimeout = error?.name === "AbortError";
    console.error("Publishing error:", error);
    return NextResponse.json(
      {
        success: false,
        error: isTimeout ? "发布超时，请稍后在平台手动检查" : error.message,
      },
      { status: 500 },
    );
  }
}
