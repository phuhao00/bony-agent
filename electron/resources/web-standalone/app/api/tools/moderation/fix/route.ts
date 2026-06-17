import { errorMessage } from "@/lib/server/errors";
import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { content, platform } = body;

    const response = await fetch(`${BACKEND_URL}/tools/moderation/fix`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content,
        platform: platform || "douyin",
      }),
    });

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: unknown) {
    const msg = errorMessage(error);
    console.error("Content fix error:", error);
    return NextResponse.json(
      { error: msg, result: `修复失败: ${msg}` },
      { status: 500 },
    );
  }
}
