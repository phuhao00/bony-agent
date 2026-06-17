import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { topic, platform, content_type, target_audience, additional_info } =
      body;

    const response = await fetch(`${BACKEND_URL}/tools/copywriting`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic,
        platform: platform || "xiaohongshu",
        content_type: content_type || "种草推荐",
        target_audience: target_audience || "年轻用户",
        additional_info: additional_info || "",
      }),
    });

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: any) {
    console.error("Copywriting generation error:", error);
    return NextResponse.json(
      { error: error.message, result: `生成失败: ${error.message}` },
      { status: 500 },
    );
  }
}
