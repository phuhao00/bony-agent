import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { file_paths, transition, duration_per_clip } = body;

    const response = await fetch(`${BACKEND_URL}/tools/video/remix`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_paths, transition, duration_per_clip }),
    });

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: any) {
    console.error("Remix error:", error);
    return NextResponse.json(
      { error: error.message, result: `混剪失败: ${error.message}` },
      { status: 500 },
    );
  }
}
