import { errorMessage } from "@/lib/server/errors";
import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();

    // 转发到后端
    const response = await fetch(`${BACKEND_URL}/upload`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const error = await response.text();
      return NextResponse.json(
        { error: error || "Upload failed" },
        { status: response.status },
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: unknown) {
    console.error("Upload error:", error);
    return NextResponse.json(
      { error: errorMessage(error, "Upload failed") },
      { status: 500 },
    );
  }
}
