import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { tool, params } = body;

    if (!tool) {
      return NextResponse.json(
        { error: "缺少 tool 参数" },
        { status: 400 },
      );
    }

    // 映射到后端 /tools/video/opencut/{tool} 或统一 /tools/video/opencut 端点
    const response = await fetch(`${BACKEND_URL}/tools/video/opencut/${tool}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params || {}),
    });

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: any) {
    console.error("OpenCut tool error:", error);
    return NextResponse.json(
      { error: error.message, result: `OpenCut 剪辑失败: ${error.message}` },
      { status: 500 },
    );
  }
}
