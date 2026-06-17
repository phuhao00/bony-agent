import { errorMessage } from "@/lib/server/errors";
import { fetchBackend } from "@/lib/server/backend-proxy";
import { NextRequest, NextResponse } from "next/server";

/** 纯图片 PDF 逐页 OCR 可能需数分钟 */
export const maxDuration = 600;

const UPLOAD_TIMEOUT_MS = 600_000;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json(
        { success: false, detail: "No file provided" },
        { status: 400 },
      );
    }

    // Forward to backend, including category/tags/description if provided
    const backendFormData = new FormData();
    const fileName = file instanceof File ? file.name : "document";
    backendFormData.append("file", file, fileName);
    const category = formData.get("category");
    const tags = formData.get("tags");
    const description = formData.get("description");
    const autoCategory = formData.get("auto_category");
    if (category) backendFormData.append("category", category as string);
    if (tags) backendFormData.append("tags", tags as string);
    if (description)
      backendFormData.append("description", description as string);
    if (autoCategory === "true")
      backendFormData.append("auto_category", "true");

    const response = await fetchBackend(
      "/knowledge/upload",
      {
        method: "POST",
        body: backendFormData,
      },
      { timeoutMs: UPLOAD_TIMEOUT_MS, retries: 1 },
    );

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error: unknown) {
    console.error("Knowledge upload error:", error);
    return NextResponse.json(
      { success: false, detail: errorMessage(error) },
      { status: 500 },
    );
  }
}
