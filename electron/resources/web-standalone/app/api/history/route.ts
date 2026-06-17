import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const recordType = searchParams.get("record_type");
    const limit = searchParams.get("limit") || "50";
    const qs = new URLSearchParams({ limit });
    if (recordType) qs.set("record_type", recordType);
    const response = await fetch(`${BACKEND_URL}/history?${qs.toString()}`);
    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: unknown) {
    console.error("Fetch history error:", error);
    // 返回空列表而不是错误，避免页面崩溃
    return NextResponse.json({ items: [] });
  }
}
