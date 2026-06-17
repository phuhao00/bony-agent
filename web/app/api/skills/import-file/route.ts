import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://127.0.0.1:8000";

// POST /api/skills/import-file  — multipart SKILL.md upload
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const res = await fetch(`${BACKEND_URL}/api/skills/import-file`, {
      method: "POST",
      body: formData,
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e: any) {
    return NextResponse.json(
      { success: false, error: e.message },
      { status: 500 },
    );
  }
}
