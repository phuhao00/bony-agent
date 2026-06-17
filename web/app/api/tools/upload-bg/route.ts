import { errorMessage } from "@/lib/server/errors";
import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

/**
 * Proxy multipart file uploads to the backend's /tools/media/upload-reference
 * endpoint. Returns { ok, url, filename, path } where `url` is the absolute
 * backend URL the image can be fetched from.
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const backendForm = new FormData();
    backendForm.append("file", file);

    const response = await fetch(
      `${BACKEND_URL}/tools/media/upload-reference`,
      {
        method: "POST",
        body: backendForm,
      },
    );

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json(
        { error: `Backend upload failed: ${text}` },
        { status: response.status },
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: unknown) {
    const msg = errorMessage(error);
    console.error("[upload-bg] error:", error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
