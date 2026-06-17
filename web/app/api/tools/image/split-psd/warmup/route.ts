import { errorMessage } from "@/lib/server/errors";
import { NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function POST() {
  try {
    const response = await fetch(`${BACKEND_URL}/tools/image/split-psd/warmup`, {
      method: "POST",
    });
    const data = await response.json();
    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }
    return NextResponse.json(data);
  } catch (error: unknown) {
    const msg = errorMessage(error);
    console.error("[image/split-psd/warmup] error:", error);
    return NextResponse.json({ error: msg, detail: msg }, { status: 500 });
  }
}
