import { errorMessage } from "@/lib/server/errors";
import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const platform = searchParams.get("platform") || "douyin";

    const response = await fetch(
      `${BACKEND_URL}/tools/moderation/rules?platform=${platform}`,
    );

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: unknown) {
    const msg = errorMessage(error);
    console.error("Get rules error:", error);
    return NextResponse.json(
      { error: msg, result: `获取规则失败: ${msg}` },
      { status: 500 },
    );
  }
}
