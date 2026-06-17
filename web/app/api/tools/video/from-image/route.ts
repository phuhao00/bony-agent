import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

// 视频生成耗时较长，设置最大执行时间为 300 秒
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { image_url, prompt } = body;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 290_000); // 290s

    const response = await fetch(`${BACKEND_URL}/tools/video/from-image`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_url, prompt }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: any) {
    console.error("Image to video error:", error);
    const msg = error?.cause?.message ?? error.message;
    return NextResponse.json(
      { error: msg, result: `生成失败: ${msg}` },
      { status: 500 },
    );
  }
}
