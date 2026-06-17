import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { topic, platform, style, duration, industry, additional_info } =
      body;

    // 调用后端工具 API
    const response = await fetch(`${BACKEND_URL}/tools/script`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic,
        platform: platform || "douyin",
        style: style || "口播带货",
        duration: duration || 60,
        industry: industry || "通用",
        additional_info: additional_info || "",
      }),
    });

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: any) {
    console.error("Script generation error:", error);
    return NextResponse.json(
      { error: error.message, result: `生成失败: ${error.message}` },
      { status: 500 },
    );
  }
}
