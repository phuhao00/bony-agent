import { errorMessage } from "@/lib/server/errors";
import { NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function GET() {
  try {
    const response = await fetch(`${BACKEND_URL}/trending/ai`, {
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Backend responded with status: ${response.status}`);
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: unknown) {
    console.error("Failed to fetch AI trending data from backend:", error);
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
