import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { topic, platform, summary, count } = body;

    const response = await fetch(`${BACKEND_URL}/tools/titles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic,
        platform: platform || "xiaohongshu",
        summary: summary || "",
        count: count || 5,
      }),
    });

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: any) {
    console.error("Title generation error:", error);
    return NextResponse.json(
      { error: error.message, result: `生成失败: ${error.message}` },
      { status: 500 },
    );
  }
}
