import { errorMessage } from "@/lib/server/errors";
import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ docId: string }> },
) {
  try {
    const { docId } = await params;
    const form = await req.formData();
    const file = form.get("file");
    const mode = String(form.get("mode") || "append");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { success: false, error: "请选择 Excel 文件" },
        { status: 400 },
      );
    }

    const body = new FormData();
    body.append("file", file);
    body.append("mode", mode);

    const response = await fetch(
      `${BACKEND_URL}/knowledge/documents/${encodeURIComponent(docId)}/faq/import`,
      { method: "POST", body },
    );
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: errorMessage(error) },
      { status: 500 },
    );
  }
}
